import os, uuid, math, json, hashlib
from datetime import datetime
from io import BytesIO
import numpy as np, pandas as pd
from flask import Flask, render_template, request, jsonify, send_file, session

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "audit-secret-key-change-in-production")
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 1024
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
ALLOWED_EXTENSIONS = {"csv", "xlsx", "xls", "xlsb"}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
projects = {}

def allowed_file(name):
    return "." in name and name.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

def get_project():
    pid = session.get("project_id")
    if not pid or pid not in projects:
        pid = str(uuid.uuid4())
        projects[pid] = {"df": None, "mapping": {}, "sample": pd.DataFrame(), "params": {}, "audit_results": {}, "created": datetime.now().isoformat()}
        session["project_id"] = pid
    return projects[pid]

def parse_amount(series):
    if pd.api.types.is_numeric_dtype(series):
        return pd.to_numeric(series, errors="coerce")
    cleaned = series.astype(str).str.replace(r"[^0-9,.-]", "", regex=True)
    both = cleaned.str.contains(",", na=False) & cleaned.str.contains(r"\.", na=False)
    cleaned.loc[both] = cleaned.loc[both].str.replace(".", "", regex=False).str.replace(",", ".", regex=False)
    comma_only = cleaned.str.contains(",", na=False) & ~cleaned.str.contains(r"\.", na=False)
    cleaned.loc[comma_only] = cleaned.loc[comma_only].str.replace(",", ".", regex=False)
    return pd.to_numeric(cleaned, errors="coerce")

def population_analysis(df, amount_col=None):
    result = {"records": int(len(df)), "columns": list(df.columns), "nulls": {str(k): int(v) for k, v in df.isna().sum().to_dict().items()}, "duplicate_rows": int(df.duplicated().sum())}
    if amount_col and amount_col in df.columns:
        x = parse_amount(df[amount_col]).dropna()
        if len(x):
            q1, q3 = x.quantile(.25), x.quantile(.75)
            iqr = q3 - q1
            lower, upper = q1 - 3*iqr, q3 + 3*iqr
            top = x.nlargest(min(50, len(x)))
            result.update({
                "amount_valid": int(len(x)), "amount_total": float(x.sum()), "mean": float(x.mean()), "median": float(x.median()),
                "min": float(x.min()), "max": float(x.max()), "std": float(x.std(ddof=1)) if len(x)>1 else 0,
                "p10": float(x.quantile(.10)), "p25": float(q1), "p75": float(q3), "p90": float(x.quantile(.90)), "p95": float(x.quantile(.95)), "p99": float(x.quantile(.99)),
                "zeros": int((x==0).sum()), "negatives": int((x<0).sum()), "outliers": int(((x < lower)|(x > upper)).sum()),
                "outlier_lower": float(lower), "outlier_upper": float(upper), "top10_amount": float(x.nlargest(min(10,len(x))).sum()),
                "top20_amount": float(x.nlargest(min(20,len(x))).sum()), "top50_amount": float(top.sum()),
                "top10_pct": float(x.nlargest(min(10,len(x))).sum()/x.sum()*100) if x.sum() else 0,
                "top20_pct": float(x.nlargest(min(20,len(x))).sum()/x.sum()*100) if x.sum() else 0,
                "top50_pct": float(top.sum()/x.sum()*100) if x.sum() else 0
            })
    return result

def sample_size(N, confidence, error, p):
    z_map = {"90":1.645, "95":1.96, "97":2.17, "99":2.576}
    z = z_map.get(str(confidence), 1.96)
    q = 1 - p
    if N <= 0 or error <= 0: return 0, z, q
    n = (z*z*p*q*N) / (error*error*(N-1) + z*z*p*q)
    return int(math.ceil(n)), z, q

def add_selection(base, idx, reason, method, stratum):
    out = base.loc[idx].copy()
    out["_original_index"] = out.index
    out["Motivo de selección"] = reason
    out["M�todo"] = method
    out["Estrato"] = stratum
    return out

def make_sample(df, params):
    id_col = params.get("id_col")
    amount_col = params.get("amount_col")
    method = params.get("method", "random")
    seed = int(params.get("seed") or np.random.randint(1, 2**31-1))
    rng = np.random.default_rng(seed)
    n = int(params.get("n", 0))
    work = df.copy()
    selected = []
    excluded = set()
    if amount_col and amount_col in work.columns:
        work["_amount_numeric"] = parse_amount(work[amount_col]).fillna(0)
    else:
        work["_amount_numeric"] = 0.0
    threshold = float(params.get("significant_threshold") or 0)
    if params.get("include_materiality") and threshold > 0:
        idx = work.index[work["_amount_numeric"].abs() >= threshold]
        if len(idx):
            selected.append(add_selection(work, idx, "Materialidad / Partida significativa", "Revisi�n 100%", "100%"))
            excluded.update(idx.tolist())
    if params.get("include_outliers"):
        x = work.loc[~work.index.isin(excluded), "_amount_numeric"]
        if len(x):
            q1,q3=x.quantile(.25),x.quantile(.75); iqr=q3-q1; upper=q3+3*iqr; lower=q1-3*iqr
            idx = x.index[(x>upper)|(x<lower)]
            if len(idx):
                selected.append(add_selection(work, idx, "Outlier", "Revisi�n 100%", "100%"))
                excluded.update(idx.tolist())
    residual = work.loc[~work.index.isin(excluded)]
    n = min(n, len(residual))
    if n > 0:
        if method == "random":
            idx = rng.choice(residual.index.to_numpy(), size=n, replace=False)
            selected.append(add_selection(work, idx, "Aleatoria", "Aleatorio simple", "Probabil�stico"))
        elif method == "systematic":
            ordered = residual.sort_values(id_col) if id_col in residual.columns else residual
            interval = len(ordered)/n
            start = rng.uniform(0, interval)
            pos = np.floor(start + np.arange(n)*interval).astype(int)
            pos = np.clip(pos, 0, len(ordered)-1)
            idx = ordered.index[pos]
            selected.append(add_selection(work, idx, "Sistem�tica", "Sistem�tico", "Probabil�stico"))
        elif method == "mus":
            positive = residual.loc[residual["_amount_numeric"] > 0].sort_index()
            if len(positive) and positive["_amount_numeric"].sum() > 0:
                interval = positive["_amount_numeric"].sum()/n
                start = rng.uniform(0, interval)
                points = start + np.arange(n)*interval
                cumulative = positive["_amount_numeric"].cumsum().to_numpy()
                locs = np.searchsorted(cumulative, points, side="left")
                idx = positive.index[np.unique(locs)]
                selected.append(add_selection(work, idx, "MUS", "Monetary Unit Sampling / PPS", "Probabil�stico"))
        elif method == "topn":
            idx = residual.nlargest(n, "_amount_numeric").index
            selected.append(add_selection(work, idx, "Top N", "Top N", "Dirigido"))
        elif method == "stratified":
            bins = [-np.inf, residual["_amount_numeric"].quantile(.5), residual["_amount_numeric"].quantile(.9), np.inf]
            residual = residual.copy(); residual["_stratum"] = pd.cut(residual["_amount_numeric"], bins=bins, duplicates="drop")
            picks=[]
            for _,g in residual.groupby("_stratum", observed=True):
                take=min(len(g), max(1, round(n*len(g)/len(residual))))
                picks.extend(rng.choice(g.index.to_numpy(), size=take, replace=False).tolist())
            picks=list(dict.fromkeys(picks))[:n]
            selected.append(add_selection(work, picks, "Estratificada", "Estratificado", "Probabil�stico"))
    if not selected:
        return pd.DataFrame(), seed
    out = pd.concat(selected, ignore_index=False)
    out = out.drop_duplicates(subset=["_original_index"], keep="first")
    return out, seed

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/upload", methods=["POST"])
def upload():
    if "file" not in request.files: return jsonify(error="Seleccione un archivo"), 400
    f=request.files["file"]
    if not f.filename or not allowed_file(f.filename): return jsonify(error="Formato no admitido. Use CSV, XLSX, XLS o XLSB."),400
    name=f.filename; path=os.path.join(UPLOAD_FOLDER, f"{uuid.uuid4()}_{name}"); f.save(path)
    try:
        ext=name.rsplit(".",1)[1].lower()
        if ext=="csv":
            try: df=pd.read_csv(path, low_memory=False)
            except UnicodeDecodeError: df=pd.read_csv(path, low_memory=False, encoding="latin1")
        else: df=pd.read_excel(path, engine="pyxlsb" if ext=="xlsb" else None)
    except Exception as e: return jsonify(error=f"No se pudo leer el archivo: {str(e)}"),400
    p=get_project(); p["df"]=df; p["source_name"]=name
    with open(path,"rb") as h: p["source_hash"]=hashlib.sha256(h.read()).hexdigest()
    return jsonify(rows=int(len(df)), columns=list(df.columns), preview=df.head(10).fillna("").to_dict(orient="records"))

@app.route("/api/analyze", methods=["POST"])
def analyze():
    p=get_project(); data=request.json or {}; df=p.get("df")
    if df is None: return jsonify(error="Cargue primero una poblaci�n"),400
    p["mapping"]={"id_col":data.get("id_col"),"amount_col":data.get("amount_col")}
    return jsonify(population_analysis(df, data.get("amount_col")))

@app.route("/api/calculate-sample", methods=["POST"])
def calculate_sample():
    d=request.json or {}; N=int(d.get("N",0)); conf=d.get("confidence","95"); e=float(d.get("error",.05)); p=float(d.get("p",.5))
    n,z,q=sample_size(N,conf,e,p)
    return jsonify(n=n,z=z,q=q,formula="n=(Z^2*p*q*N) / [e^2*(N-1)+Z^2*p*q]", variables={"N":N,"Z":z,"p":p,"q":q,"e":e})

@app.route("/api/recommend", methods=["POST"])
def recommend():
    p=get_project(); df=p.get("df"); d=request.json or {}; amount=d.get("amount_col")
    if df is None or not amount: return jsonify(error="Defina una columna de importe"),400
    a=population_analysis(df,amount); reasons=[]
    if a.get("top20_pct",0)>=40: reasons.append("Alta concentraci�n monetaria: Top 20 supera 40% del importe.")
    if a.get("outliers",0)>0: reasons.append(f"Se detectaron {a['outliers']} outliers por criterio 3*IQR.")
    threshold=float(d.get("significant_threshold") or 0); significant=0
    if threshold>0: significant=int((parse_amount(df[amount]).abs()>=threshold).sum())
    if significant: reasons.append(f"Hay {significant} partidas sobre el umbral significativo.")
    method="combined" if significant or a.get("top20_pct",0)>=40 else ("stratified" if a.get("std",0)>a.get("mean",1) else "random")
    label={"combined":"Selecci�n combinada: 100% significativas/outliers + MUS residual","stratified":"Muestreo estratificado","random":"Muestreo aleatorio simple"}[method]
    return jsonify(method=method,recommendation=label,reasons=reasons or ["Poblaci�n relativamente homog�nea; un muestreo aleatorio simple resulta apropiado."],analysis=a)

@app.route("/api/generate-sample", methods=["POST"])
def generate_sample():
    project=get_project(); df=project.get("df"); d=request.json or {}
    if df is None: return jsonify(error="Cargue primero una poblaci�n"),400
    sample,seed=make_sample(df,d); project["sample"]=sample; project["params"]=d.copy(); project["params"]["seed"]=seed
    amount=d.get("amount_col"); total=float(parse_amount(df[amount]).sum()) if amount in df else 0
    selected=float(sample.get("_amount_numeric",pd.Series(dtype=float)).sum()) if len(sample) else 0
    return jsonify(rows=int(len(sample)),seed=seed,coverage_amount=(selected/total*100 if total else 0),coverage_count=(len(sample)/len(df)*100 if len(df) else 0),preview=sample.drop(columns=["_amount_numeric"],errors="ignore").head(500).fillna("").to_dict(orient="records"))

@app.route("/api/sample", methods=["GET"])
def sample_data():
    project=get_project(); s=project.get("sample",pd.DataFrame())
    return jsonify(rows=int(len(s)),data=s.drop(columns=["_amount_numeric"],errors="ignore").fillna("").to_dict(orient="records"))

@app.route("/api/results", methods=["POST"])
def save_results():
    project=get_project(); data=request.json or {}; results=data.get("results",[])
    project["audit_results"]={str(x.get("_original_index")):x for x in results}
    return jsonify(saved=len(results))

@app.route("/api/extrapolation", methods=["GET"])
def extrapolation():
    pr=get_project(); sample=pr.get("sample",pd.DataFrame()); df=pr.get("df"); params=pr.get("params",{}); results=pr.get("audit_results",{})
    if df is None or sample.empty: return jsonify(error="No existe muestra generada"),400
    amount=params.get("amount_col"); total=float(parse_amount(df[amount]).sum()) if amount in df else 0
    s=sample.copy(); s["error"]=[float(results.get(str(i),{}).get("difference",0) or 0) for i in s["_original_index"]]
    s["status"]=[results.get(str(i),{}).get("status","") for i in s["_original_index"]]
    hundred=s[s["Estrato"]=="100%"]
    prob=s[s["Estrato"]=="Probabil�stico"]
    real100=float(hundred["error"].abs().sum()); observed_prob=float(prob["error"].abs().sum()); sample_amount=float(prob.get("_amount_numeric",pd.Series(dtype=float)).abs().sum())
    residual_df=df.loc[~df.index.isin(hundred["_original_index"].tolist())] if len(hundred) else df
    residual_total=float(parse_amount(residual_df[amount]).abs().sum()) if amount in residual_df else 0
    rate=observed_prob/sample_amount if sample_amount else 0
    projected=rate*residual_total if len(prob) else None
    total_estimated=real100+(projected or 0)
    exc=int((s["status"].isin(["Excepci�n","Error monetario","Error no monetario"])).sum())
    mat=float(params.get("materiality") or 0); tol=float(params.get("tolerable_error") or 0)
    def traffic(value,limit):
        if not limit:return "sin umbral"
        return "verde" if value/limit<.8 else ("amarillo" if value/limit<=1 else "rojo")
    return jsonify(extrapolable=bool(len(prob)), message=None if len(prob) else "La muestra fue seleccionada mediante criterios dirigidos o no probabil�sticos. Los resultados observados no deben proyectarse estad�sticamente a toda la poblaci�n.", total_population=total, hundred_amount=float(hundred.get("_amount_numeric",pd.Series(dtype=float)).sum()), residual_population=residual_total, observed_100=real100, observed_residual=observed_prob, effectively_identified=real100+observed_prob, error_rate=rate, projected_residual=projected, total_estimated=total_estimated, exceptions=exc, sample_count=len(sample), coverage_count=len(sample)/len(df)*100, coverage_amount=float(s.get("_amount_numeric",pd.Series(dtype=float)).sum())/total*100 if total else 0, materiality=mat,tolerable_error=tol,checks={"observed_vs_materiality":traffic(real100+observed_prob,mat),"projected_vs_materiality":traffic(projected or 0,mat),"total_vs_materiality":traffic(total_estimated,mat),"projected_vs_tolerable":traffic(projected or 0,tol)})

@app.route("/api/export", methods=["GET"])
def export_excel():
    pr=get_project(); df=pr.get("df"); sample=pr.get("sample",pd.DataFrame())
    if df is None:return jsonify(error="Sin poblaci�n"),400
    out=BytesIO()
    with pd.ExcelWriter(out,engine="xlsxwriter") as writer:
        df.to_excel(writer,sheet_name="01_Poblacion_Original",index=False)
        analysis=pd.DataFrame(list(population_analysis(df,pr.get("mapping",{}).get("amount_col")).items()),columns=["Metrica","Valor"]); analysis.to_excel(writer,sheet_name="02_Analisis_Poblacion",index=False)
        pd.DataFrame(list(pr.get("params",{}).items()),columns=["Parametro","Valor"]).to_excel(writer,sheet_name="03_Parametros_Muestreo",index=False)
        sample.drop(columns=["_amount_numeric"],errors="ignore").to_excel(writer,sheet_name="04_Muestra_Seleccionada",index=False)
        rows=[]
        for i,r in pr.get("audit_results",{}).items(): rows.append(r)
        pd.DataFrame(rows).to_excel(writer,sheet_name="05_Resultados_Auditoria",index=False)
        try: ex=extrapolation().get_json(); pd.DataFrame(list(ex.items()),columns=["Metrica","Valor"]).to_excel(writer,sheet_name="06_Extrapolacion",index=False)
        except Exception: pd.DataFrame([{"Estado":"Pendiente de resultados"}]).to_excel(writer,sheet_name="06_Extrapolacion",index=False)
        summary=pd.DataFrame([{"Proyecto":pr.get("source_name",""),"Fecha":datetime.now().isoformat(),"Poblacion":len(df),"Muestra":len(sample),"Hash archivo original":pr.get("source_hash","")}]); summary.to_excel(writer,sheet_name="07_Resumen_Ejecutivo",index=False)
        for ws in writer.sheets.values(): ws.freeze_panes(1,0); ws.set_column(0, min(30,ws.dim_colmax+1), 18)
    out.seek(0)
    return send_file(out,as_attachment=True,download_name="Audit_Sampling_Export.xlsx",mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
