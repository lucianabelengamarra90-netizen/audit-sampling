import os
import uuid
import math
import hashlib
from datetime import datetime
from io import BytesIO

import numpy as np
import pandas as pd

from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    send_file,
    session
)


# ============================================================
# CONFIGURACIÓN
# ============================================================

app = Flask(__name__)

app.secret_key = os.environ.get(
    "SECRET_KEY",
    "audit-secret-key-change-in-production"
)

# Hasta 1 GB
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 1024

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")

ALLOWED_EXTENSIONS = {"csv", "xlsx", "xls", "xlsb"}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Estado en memoria por sesión
projects = {}


# ============================================================
# UTILIDADES
# ============================================================

def allowed_file(name):
    return (
        "." in name
        and name.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def get_project():
    pid = session.get("project_id")

    if not pid or pid not in projects:
        pid = str(uuid.uuid4())

        projects[pid] = {
            "df": None,
            "mapping": {},
            "sample": pd.DataFrame(),
            "params": {},
            "audit_results": {},
            "created": datetime.now().isoformat(),
            "source_name": "",
            "source_hash": ""
        }

        session["project_id"] = pid

    return projects[pid]


def parse_amount(series):
    """
    Convierte importes de Excel/CSV a número.
    Soporta formatos:
    1.234,56
    1234,56
    1,234.56
    1234.56
    $ 1.234,56
    negativos
    """

    if pd.api.types.is_numeric_dtype(series):
        return pd.to_numeric(series, errors="coerce")

    cleaned = (
        series.astype(str)
        .str.strip()
        .str.replace(r"[^0-9,.\-]", "", regex=True)
    )

    # Caso argentino: 1.234,56
    both = (
        cleaned.str.contains(",", na=False)
        & cleaned.str.contains(r"\.", na=False)
    )

    cleaned.loc[both] = (
        cleaned.loc[both]
        .str.replace(".", "", regex=False)
        .str.replace(",", ".", regex=False)
    )

    # Caso: 1234,56
    comma_only = (
        cleaned.str.contains(",", na=False)
        & ~cleaned.str.contains(r"\.", na=False)
    )

    cleaned.loc[comma_only] = (
        cleaned.loc[comma_only]
        .str.replace(",", ".", regex=False)
    )

    return pd.to_numeric(cleaned, errors="coerce")


# ============================================================
# ANÁLISIS DE POBLACIÓN
# ============================================================

def population_analysis(df, amount_col=None):

    result = {
        "records": int(len(df)),
        "columns": [str(c) for c in df.columns],
        "nulls": {
            str(k): int(v)
            for k, v in df.isna().sum().to_dict().items()
        },
        "duplicate_rows": int(df.duplicated().sum())
    }

    if not amount_col or amount_col not in df.columns:
        return result

    x = parse_amount(df[amount_col]).dropna()

    if len(x) == 0:
        result["amount_valid"] = 0
        return result

    q1 = x.quantile(0.25)
    q3 = x.quantile(0.75)
    iqr = q3 - q1

    lower = q1 - 3 * iqr
    upper = q3 + 3 * iqr

    total = float(x.sum())
    absolute_total = float(x.abs().sum())

    top10 = x.abs().nlargest(min(10, len(x)))
    top20 = x.abs().nlargest(min(20, len(x)))
    top50 = x.abs().nlargest(min(50, len(x)))

    result.update({
        "amount_valid": int(len(x)),
        "amount_total": total,
        "amount_absolute_total": absolute_total,

        "mean": float(x.mean()),
        "median": float(x.median()),
        "min": float(x.min()),
        "max": float(x.max()),

        "std": (
            float(x.std(ddof=1))
            if len(x) > 1
            else 0
        ),

        "p10": float(x.quantile(0.10)),
        "p25": float(q1),
        "p75": float(q3),
        "p90": float(x.quantile(0.90)),
        "p95": float(x.quantile(0.95)),
        "p99": float(x.quantile(0.99)),

        "zeros": int((x == 0).sum()),
        "negatives": int((x < 0).sum()),

        "outliers": int(
            ((x < lower) | (x > upper)).sum()
        ),

        "outlier_lower": float(lower),
        "outlier_upper": float(upper),

        "top10_amount": float(top10.sum()),
        "top20_amount": float(top20.sum()),
        "top50_amount": float(top50.sum()),

        "top10_pct": (
            float(top10.sum() / absolute_total * 100)
            if absolute_total
            else 0
        ),

        "top20_pct": (
            float(top20.sum() / absolute_total * 100)
            if absolute_total
            else 0
        ),

        "top50_pct": (
            float(top50.sum() / absolute_total * 100)
            if absolute_total
            else 0
        )
    })

    return result


# ============================================================
# TAMAÑO DE MUESTRA
# ============================================================

def sample_size(N, confidence, error, p):

    z_map = {
        "90": 1.645,
        "95": 1.96,
        "97": 2.17,
        "99": 2.576
    }

    z = z_map.get(str(confidence), 1.96)

    q = 1 - p

    if N <= 0 or error <= 0:
        return 0, z, q

    numerator = z * z * p * q * N

    denominator = (
        error * error * (N - 1)
        + z * z * p * q
    )

    if denominator == 0:
        return 0, z, q

    n = numerator / denominator

    return int(math.ceil(n)), z, q


# ============================================================
# SELECCIÓN DE REGISTROS
# ============================================================

def add_selection(base, idx, reason, method, stratum):

    if len(idx) == 0:
        return pd.DataFrame()

    out = base.loc[idx].copy()

    out["_original_index"] = out.index

    out["Motivo de selección"] = reason
    out["Método"] = method
    out["Estrato"] = stratum

    return out


def make_sample(df, params):

    id_col = params.get("id_col")
    amount_col = params.get("amount_col")

    method = params.get("method", "random")

    seed = int(
        params.get("seed")
        or np.random.randint(1, 2**31 - 1)
    )

    rng = np.random.default_rng(seed)

    requested_n = int(params.get("n", 0))

    work = df.copy()

    selected = []
    excluded = set()

    # --------------------------------------------------------
    # Columna monetaria
    # --------------------------------------------------------

    if amount_col and amount_col in work.columns:

        work["_amount_numeric"] = (
            parse_amount(work[amount_col])
            .fillna(0)
        )

    else:
        work["_amount_numeric"] = 0.0

    # --------------------------------------------------------
    # Partidas significativas
    # --------------------------------------------------------

    threshold = float(
        params.get("significant_threshold") or 0
    )

    if (
        params.get("include_materiality")
        and threshold > 0
    ):

        idx = work.index[
            work["_amount_numeric"].abs() >= threshold
        ]

        if len(idx):

            selected.append(
                add_selection(
                    work,
                    idx,
                    "Materialidad / Partida significativa",
                    "Revisión 100%",
                    "100%"
                )
            )

            excluded.update(idx.tolist())

    # --------------------------------------------------------
    # Outliers
    # --------------------------------------------------------

    if params.get("include_outliers"):

        x = work.loc[
            ~work.index.isin(excluded),
            "_amount_numeric"
        ]

        if len(x):

            q1 = x.quantile(0.25)
            q3 = x.quantile(0.75)

            iqr = q3 - q1

            lower = q1 - 3 * iqr
            upper = q3 + 3 * iqr

            idx = x.index[
                (x < lower)
                | (x > upper)
            ]

            if len(idx):

                selected.append(
                    add_selection(
                        work,
                        idx,
                        "Outlier",
                        "Revisión 100%",
                        "100%"
                    )
                )

                excluded.update(idx.tolist())

    # --------------------------------------------------------
    # Universo residual
    # --------------------------------------------------------

    residual = work.loc[
        ~work.index.isin(excluded)
    ].copy()

    n = min(
        requested_n,
        len(residual)
    )

    # --------------------------------------------------------
    # Muestreo residual
    # --------------------------------------------------------

    if n > 0:

        # ALEATORIO SIMPLE
        if method == "random":

            idx = rng.choice(
                residual.index.to_numpy(),
                size=n,
                replace=False
            )

            selected.append(
                add_selection(
                    work,
                    idx,
                    "Aleatoria",
                    "Aleatorio simple",
                    "Probabilístico"
                )
            )

        # SISTEMÁTICO
        elif method == "systematic":

            if id_col and id_col in residual.columns:
                ordered = residual.sort_values(
                    id_col
                )
            else:
                ordered = residual

            interval = len(ordered) / n

            start = rng.uniform(
                0,
                interval
            )

            positions = np.floor(
                start
                + np.arange(n) * interval
            ).astype(int)

            positions = np.clip(
                positions,
                0,
                len(ordered) - 1
            )

            idx = ordered.index[
                positions
            ]

            selected.append(
                add_selection(
                    work,
                    idx,
                    "Sistemática",
                    "Sistemático",
                    "Probabilístico"
                )
            )

        # MUS / PPS
        elif method == "mus":

            positive = residual.loc[
                residual["_amount_numeric"] > 0
            ].copy()

            if (
                len(positive)
                and positive["_amount_numeric"].sum() > 0
            ):

                total_positive = float(
                    positive["_amount_numeric"].sum()
                )

                interval = total_positive / n

                start = rng.uniform(
                    0,
                    interval
                )

                points = (
                    start
                    + np.arange(n) * interval
                )

                cumulative = (
                    positive["_amount_numeric"]
                    .cumsum()
                    .to_numpy()
                )

                locations = np.searchsorted(
                    cumulative,
                    points,
                    side="left"
                )

                locations = np.clip(
                    locations,
                    0,
                    len(positive) - 1
                )

                idx = positive.index[
                    np.unique(locations)
                ]

                selected.append(
                    add_selection(
                        work,
                        idx,
                        "MUS",
                        "Monetary Unit Sampling / PPS",
                        "Probabilístico"
                    )
                )

        # TOP N
        elif method == "topn":

            idx = (
                residual
                .assign(
                    _abs_amount=
                    residual["_amount_numeric"].abs()
                )
                .nlargest(
                    n,
                    "_abs_amount"
                )
                .index
            )

            selected.append(
                add_selection(
                    work,
                    idx,
                    "Top N",
                    "Top N",
                    "Dirigido"
                )
            )

        # ESTRATIFICADO
        elif method == "stratified":

            values = residual[
                "_amount_numeric"
            ].abs()

            q50 = values.quantile(0.50)
            q90 = values.quantile(0.90)

            if q50 == q90:
                idx = rng.choice(
                    residual.index.to_numpy(),
                    size=n,
                    replace=False
                )

                selected.append(
                    add_selection(
                        work,
                        idx,
                        "Estratificada",
                        "Estratificado",
                        "Probabilístico"
                    )
                )

            else:

                residual["_stratum"] = pd.cut(
                    values,
                    bins=[
                        -np.inf,
                        q50,
                        q90,
                        np.inf
                    ],
                    duplicates="drop"
                )

                picks = []

                grouped = residual.groupby(
                    "_stratum",
                    observed=True
                )

                for _, group in grouped:

                    proportion = (
                        len(group)
                        / len(residual)
                    )

                    take = max(
                        1,
                        round(
                            n * proportion
                        )
                    )

                    take = min(
                        len(group),
                        take
                    )

                    selected_idx = rng.choice(
                        group.index.to_numpy(),
                        size=take,
                        replace=False
                    )

                    picks.extend(
                        selected_idx.tolist()
                    )

                picks = list(
                    dict.fromkeys(picks)
                )

                # Completar si faltan registros
                if len(picks) < n:

                    remaining = residual.index[
                        ~residual.index.isin(picks)
                    ]

                    needed = min(
                        n - len(picks),
                        len(remaining)
                    )

                    if needed > 0:

                        extra = rng.choice(
                            remaining.to_numpy(),
                            size=needed,
                            replace=False
                        )

                        picks.extend(
                            extra.tolist()
                        )

                picks = picks[:n]

                selected.append(
                    add_selection(
                        work,
                        picks,
                        "Estratificada",
                        "Estratificado",
                        "Probabilístico"
                    )
                )

    # --------------------------------------------------------
    # Resultado final
    # --------------------------------------------------------

    if not selected:
        return pd.DataFrame(), seed

    out = pd.concat(
        selected,
        ignore_index=False
    )

    out = out.drop_duplicates(
        subset=["_original_index"],
        keep="first"
    )

    return out, seed


# ============================================================
# PANTALLA PRINCIPAL
# ============================================================

@app.route("/")
def index():
    return render_template("index.html")


# ============================================================
# CARGA DE ARCHIVO
# ============================================================

@app.route(
    "/api/upload",
    methods=["POST"]
)
def upload():

    if "file" not in request.files:
        return jsonify(
            error="Seleccione un archivo"
        ), 400

    f = request.files["file"]

    if (
        not f.filename
        or not allowed_file(f.filename)
    ):

        return jsonify(
            error=(
                "Formato no admitido. "
                "Use CSV, XLSX, XLS o XLSB."
            )
        ), 400

    name = f.filename

    path = os.path.join(
        UPLOAD_FOLDER,
        f"{uuid.uuid4()}_{name}"
    )

    f.save(path)

    try:

        ext = (
            name
            .rsplit(".", 1)[1]
            .lower()
        )

        if ext == "csv":

            try:

                df = pd.read_csv(
                    path,
                    low_memory=False
                )

            except UnicodeDecodeError:

                df = pd.read_csv(
                    path,
                    low_memory=False,
                    encoding="latin1"
                )

        elif ext == "xlsb":

            df = pd.read_excel(
                path,
                engine="pyxlsb"
            )

        else:

            df = pd.read_excel(
                path
            )

    except Exception as e:

        return jsonify(
            error=(
                "No se pudo leer el archivo: "
                + str(e)
            )
        ), 400

    # Limpiar nombres de columnas
    df.columns = [
        str(c).strip()
        for c in df.columns
    ]

    project = get_project()

    project["df"] = df
    project["source_name"] = name
    project["mapping"] = {}
    project["sample"] = pd.DataFrame()
    project["params"] = {}
    project["audit_results"] = {}

    with open(path, "rb") as handle:

        project["source_hash"] = (
            hashlib
            .sha256(handle.read())
            .hexdigest()
        )

    preview = (
        df
        .head(10)
        .fillna("")
        .to_dict(
            orient="records"
        )
    )

    return jsonify(
        rows=int(len(df)),
        columns=[
            str(c)
            for c in df.columns
        ],
        preview=preview
    )


# ============================================================
# ANÁLISIS
# ============================================================

@app.route(
    "/api/analyze",
    methods=["POST"]
)
def analyze():

    project = get_project()

    data = request.json or {}

    df = project.get("df")

    if df is None:

        return jsonify(
            error="Cargue primero una población"
        ), 400

    # Aceptar nombres del frontend actual
    id_col = (
        data.get("id")
        or data.get("id_col")
    )

    amount_col = (
        data.get("amount")
        or data.get("amount_col")
    )

    if not id_col:

        return jsonify(
            error="Debe seleccionar una columna como ID."
        ), 400

    if not amount_col:

        return jsonify(
            error="Debe seleccionar una columna como Importe."
        ), 400

    if id_col not in df.columns:

        return jsonify(
            error=(
                f"La columna ID '{id_col}' "
                "no existe en el archivo."
            )
        ), 400

    if amount_col not in df.columns:

        return jsonify(
            error=(
                f"La columna Importe '{amount_col}' "
                "no existe en el archivo."
            )
        ), 400

    project["mapping"] = {
        "id_col": id_col,
        "amount_col": amount_col
    }

    analysis = population_analysis(
        df,
        amount_col
    )

    return jsonify(analysis)


# ============================================================
# CÁLCULO DE TAMAÑO DE MUESTRA
# ============================================================

@app.route(
    "/api/calculate-sample",
    methods=["POST"]
)
def calculate_sample():

    data = request.json or {}

    try:

        N = int(
            data.get("N", 0)
        )

        confidence = data.get(
            "confidence",
            "95"
        )

        error = float(
            data.get(
                "error",
                0.05
            )
        )

        p = float(
            data.get(
                "p",
                0.5
            )
        )

    except Exception:

        return jsonify(
            error="Parámetros de muestreo inválidos."
        ), 400

    if not 0 <= p <= 1:

        return jsonify(
            error="p debe estar entre 0 y 1."
        ), 400

    n, z, q = sample_size(
        N,
        confidence,
        error,
        p
    )

    return jsonify(
        n=n,
        z=z,
        q=q,
        formula=(
            "n=(Z²*p*q*N) / "
            "[e²*(N-1)+Z²*p*q]"
        ),
        variables={
            "N": N,
            "Z": z,
            "p": p,
            "q": q,
            "e": error
        }
    )


# ============================================================
# RECOMENDACIÓN
# ============================================================

@app.route(
    "/api/recommend",
    methods=["POST"]
)
def recommend():

    project = get_project()

    df = project.get("df")

    data = request.json or {}

    amount_col = (
        data.get("amount_col")
        or project
        .get("mapping", {})
        .get("amount_col")
    )

    if df is None:

        return jsonify(
            error="Cargue primero una población."
        ), 400

    if not amount_col:

        return jsonify(
            error="Defina una columna de importe."
        ), 400

    analysis = population_analysis(
        df,
        amount_col
    )

    reasons = []

    if analysis.get(
        "top20_pct",
        0
    ) >= 40:

        reasons.append(
            "Alta concentración monetaria: "
            "el Top 20 supera el 40% "
            "del importe absoluto de la población."
        )

    if analysis.get(
        "outliers",
        0
    ) > 0:

        reasons.append(
            f"Se detectaron "
            f"{analysis['outliers']} "
            "outliers mediante criterio 3×IQR."
        )

    threshold = float(
        data.get(
            "significant_threshold"
        )
        or 0
    )

    significant = 0

    if threshold > 0:

        amounts = parse_amount(
            df[amount_col]
        )

        significant = int(
            (
                amounts.abs()
                >= threshold
            ).sum()
        )

    if significant:

        reasons.append(
            f"Hay {significant} partidas "
            "que superan el umbral significativo."
        )

    if (
        significant
        or analysis.get(
            "top20_pct",
            0
        ) >= 40
        or analysis.get(
            "outliers",
            0
        ) > 0
    ):

        method = "combined"

        label = (
            "Selección combinada: "
            "revisión 100% de partidas significativas/"
            "outliers + muestra probabilística "
            "del universo residual."
        )

    elif (
        abs(
            analysis.get(
                "std",
                0
            )
        )
        >
        abs(
            analysis.get(
                "mean",
                0
            )
        )
    ):

        method = "stratified"

        label = (
            "Muestreo estratificado."
        )

    else:

        method = "random"

        label = (
            "Muestreo aleatorio simple."
        )

    if not reasons:

        reasons.append(
            "La población no presenta una "
            "concentración o dispersión significativa "
            "según los parámetros analizados."
        )

    return jsonify(
        method=method,
        recommendation=label,
        reasons=reasons,
        analysis=analysis
    )


# ============================================================
# GENERACIÓN DE MUESTRA
# ============================================================

@app.route(
    "/api/generate-sample",
    methods=["POST"]
)
def generate_sample():

    project = get_project()

    df = project.get("df")

    data = request.json or {}

    if df is None:

        return jsonify(
            error="Cargue primero una población."
        ), 400

    # Si por algún motivo frontend no manda columnas,
    # usar el mapeo previamente seleccionado.
    mapping = project.get(
        "mapping",
        {}
    )

    data["id_col"] = (
        data.get("id_col")
        or mapping.get("id_col")
    )

    data["amount_col"] = (
        data.get("amount_col")
        or mapping.get("amount_col")
    )

    if not data.get("id_col"):

        return jsonify(
            error="No se definió la columna ID."
        ), 400

    if not data.get("amount_col"):

        return jsonify(
            error="No se definió la columna Importe."
        ), 400

    sample, seed = make_sample(
        df,
        data
    )

    project["sample"] = sample
    project["params"] = data.copy()
    project["params"]["seed"] = seed

    amount_col = data.get(
        "amount_col"
    )

    population_amount = float(
        parse_amount(
            df[amount_col]
        )
        .abs()
        .sum()
    )

    if len(sample):

        selected_amount = float(
            sample[
                "_amount_numeric"
            ]
            .abs()
            .sum()
        )

    else:

        selected_amount = 0

    coverage_amount = (
        selected_amount
        / population_amount
        * 100
        if population_amount
        else 0
    )

    coverage_count = (
        len(sample)
        / len(df)
        * 100
        if len(df)
        else 0
    )

    # Hasta 500 registros al frontend.
    # La muestra completa queda guardada en backend
    # y se exporta completa.
    preview = (
        sample
        .drop(
            columns=[
                "_amount_numeric",
                "_stratum"
            ],
            errors="ignore"
        )
        .head(500)
        .fillna("")
        .to_dict(
            orient="records"
        )
    )

    return jsonify(
        rows=int(len(sample)),
        seed=seed,
        coverage_amount=coverage_amount,
        coverage_count=coverage_count,
        preview=preview
    )


# ============================================================
# OBTENER MUESTRA COMPLETA
# ============================================================

@app.route(
    "/api/sample",
    methods=["GET"]
)
def sample_data():

    project = get_project()

    sample = project.get(
        "sample",
        pd.DataFrame()
    )

    clean_sample = (
        sample
        .drop(
            columns=[
                "_amount_numeric",
                "_stratum"
            ],
            errors="ignore"
        )
        .fillna("")
    )

    return jsonify(
        rows=int(len(sample)),
        data=clean_sample.to_dict(
            orient="records"
        )
    )


# ============================================================
# RESULTADOS DE AUDITORÍA
# ============================================================

@app.route(
    "/api/results",
    methods=["POST"]
)
def save_results():

    project = get_project()

    data = request.json or {}

    incoming = data.get(
        "results",
        []
    )

    sample = project.get(
        "sample",
        pd.DataFrame()
    )

    saved = {}

    for position, result in enumerate(incoming):

        if not isinstance(
            result,
            dict
        ):
            continue

        original_index = result.get(
            "_original_index"
        )

        # Compatibilidad temporal con frontend actual.
        # Si no viene el índice, asociar por orden
        # a la muestra.
        if (
            original_index is None
            and position < len(sample)
        ):

            original_index = (
                sample
                .iloc[position]
                .get(
                    "_original_index"
                )
            )

        if original_index is None:
            continue

        result_copy = dict(result)

        result_copy[
            "_original_index"
        ] = original_index

        saved[
            str(original_index)
        ] = result_copy

    project[
        "audit_results"
    ] = saved

    return jsonify(
        saved=len(saved)
    )


# ============================================================
# EXTRAPOLACIÓN
# ============================================================

@app.route(
    "/api/extrapolation",
    methods=["GET"]
)
def extrapolation():

    project = get_project()

    sample = project.get(
        "sample",
        pd.DataFrame()
    )

    df = project.get("df")

    params = project.get(
        "params",
        {}
    )

    results = project.get(
        "audit_results",
        {}
    )

    if (
        df is None
        or sample.empty
    ):

        return jsonify(
            error="No existe una muestra generada."
        ), 400

    amount_col = params.get(
        "amount_col"
    )

    if (
        not amount_col
        or amount_col not in df.columns
    ):

        return jsonify(
            error="No se encuentra la columna de importe."
        ), 400

    total_population = float(
        parse_amount(
            df[amount_col]
        )
        .abs()
        .sum()
    )

    s = sample.copy()

    s["error"] = [
        abs(
            float(
                results
                .get(
                    str(i),
                    {}
                )
                .get(
                    "difference",
                    0
                )
                or 0
            )
        )
        for i in s[
            "_original_index"
        ]
    ]

    s["status"] = [
        results
        .get(
            str(i),
            {}
        )
        .get(
            "status",
            ""
        )
        for i in s[
            "_original_index"
        ]
    ]

    hundred = s[
        s["Estrato"] == "100%"
    ]

    prob = s[
        s["Estrato"]
        == "Probabilístico"
    ]

    real_100 = float(
        hundred[
            "error"
        ].sum()
    )

    observed_prob = float(
        prob[
            "error"
        ].sum()
    )

    sample_amount = float(
        prob
        .get(
            "_amount_numeric",
            pd.Series(
                dtype=float
            )
        )
        .abs()
        .sum()
    )

    # Universo residual excluyendo revisión 100%
    if len(hundred):

        reviewed_indices = (
            hundred[
                "_original_index"
            ]
            .tolist()
        )

        residual_df = df.loc[
            ~df.index.isin(
                reviewed_indices
            )
        ]

    else:

        residual_df = df

    residual_total = float(
        parse_amount(
            residual_df[
                amount_col
            ]
        )
        .abs()
        .sum()
    )

    if (
        len(prob)
        and sample_amount > 0
    ):

        error_rate = (
            observed_prob
            / sample_amount
        )

        projected_residual = (
            error_rate
            * residual_total
        )

    else:

        error_rate = 0
        projected_residual = None

    total_estimated = (
        real_100
        + (
            projected_residual
            or 0
        )
    )

    exception_statuses = [
        "Excepción",
        "Error monetario",
        "Error no monetario"
    ]

    exceptions = int(
        s[
            "status"
        ]
        .isin(
            exception_statuses
        )
        .sum()
    )

    materiality = float(
        params.get(
            "materiality"
        )
        or 0
    )

    tolerable_error = float(
        params.get(
            "tolerable_error"
        )
        or 0
    )

    def traffic(
        value,
        limit
    ):

        if not limit:
            return "sin umbral"

        ratio = value / limit

        if ratio < 0.80:
            return "verde"

        if ratio <= 1:
            return "amarillo"

        return "rojo"

    extrapolable = bool(
        len(prob)
    )

    message = None

    if not extrapolable:

        message = (
            "La muestra fue seleccionada mediante "
            "criterios dirigidos o no probabilísticos. "
            "Los resultados observados no deben "
            "proyectarse estadísticamente a toda "
            "la población."
        )

    sample_amount_total = float(
        s.get(
            "_amount_numeric",
            pd.Series(
                dtype=float
            )
        )
        .abs()
        .sum()
    )

    return jsonify(
        extrapolable=extrapolable,
        message=message,

        total_population=
            total_population,

        hundred_amount=float(
            hundred
            .get(
                "_amount_numeric",
                pd.Series(
                    dtype=float
                )
            )
            .abs()
            .sum()
        ),

        residual_population=
            residual_total,

        observed_100=
            real_100,

        observed_residual=
            observed_prob,

        effectively_identified=
            real_100
            + observed_prob,

        error_rate=
            error_rate,

        projected_residual=
            projected_residual,

        total_estimated=
            total_estimated,

        exceptions=
            exceptions,

        sample_count=
            int(
                len(sample)
            ),

        coverage_count=(
            len(sample)
            / len(df)
            * 100
            if len(df)
            else 0
        ),

        coverage_amount=(
            sample_amount_total
            / total_population
            * 100
            if total_population
            else 0
        ),

        materiality=
            materiality,

        tolerable_error=
            tolerable_error,

        checks={
            "observed_vs_materiality":
                traffic(
                    real_100
                    + observed_prob,
                    materiality
                ),

            "projected_vs_materiality":
                traffic(
                    projected_residual
                    or 0,
                    materiality
                ),

            "total_vs_materiality":
                traffic(
                    total_estimated,
                    materiality
                ),

            "projected_vs_tolerable":
                traffic(
                    projected_residual
                    or 0,
                    tolerable_error
                )
        }
    )


# ============================================================
# EXPORTACIÓN EXCEL
# ============================================================

@app.route(
    "/api/export",
    methods=["GET"]
)
def export_excel():

    project = get_project()

    df = project.get("df")

    sample = project.get(
        "sample",
        pd.DataFrame()
    )

    if df is None:

        return jsonify(
            error="Sin población"
        ), 400

    output = BytesIO()

    with pd.ExcelWriter(
        output,
        engine="xlsxwriter"
    ) as writer:

        # 01
        df.to_excel(
            writer,
            sheet_name=
                "01_Poblacion_Original",
            index=False
        )

        # 02
        analysis_data = (
            population_analysis(
                df,
                project
                .get(
                    "mapping",
                    {}
                )
                .get(
                    "amount_col"
                )
            )
        )

        analysis = pd.DataFrame(
            list(
                analysis_data.items()
            ),
            columns=[
                "Metrica",
                "Valor"
            ]
        )

        analysis.to_excel(
            writer,
            sheet_name=
                "02_Analisis_Poblacion",
            index=False
        )

        # 03
        params_df = pd.DataFrame(
            list(
                project
                .get(
                    "params",
                    {}
                )
                .items()
            ),
            columns=[
                "Parametro",
                "Valor"
            ]
        )

        params_df.to_excel(
            writer,
            sheet_name=
                "03_Parametros_Muestreo",
            index=False
        )

        # 04
        sample_export = (
            sample
            .drop(
                columns=[
                    "_amount_numeric",
                    "_stratum"
                ],
                errors="ignore"
            )
        )

        sample_export.to_excel(
            writer,
            sheet_name=
                "04_Muestra_Seleccionada",
            index=False
        )

        # 05
        result_rows = []

        for _, result in (
            project
            .get(
                "audit_results",
                {}
            )
            .items()
        ):

            result_rows.append(
                result
            )

        pd.DataFrame(
            result_rows
        ).to_excel(
            writer,
            sheet_name=
                "05_Resultados_Auditoria",
            index=False
        )

        # 06
        try:

            response = (
                extrapolation()
            )

            if isinstance(
                response,
                tuple
            ):

                ex_data = {
                    "Estado":
                    "Pendiente de resultados"
                }

            else:

                ex_data = (
                    response.get_json()
                )

            ex_df = pd.DataFrame(
                list(
                    ex_data.items()
                ),
                columns=[
                    "Metrica",
                    "Valor"
                ]
            )

            ex_df.to_excel(
                writer,
                sheet_name=
                    "06_Extrapolacion",
                index=False
            )

        except Exception:

            pd.DataFrame(
                [{
                    "Estado":
                    "Pendiente de resultados"
                }]
            ).to_excel(
                writer,
                sheet_name=
                    "06_Extrapolacion",
                index=False
            )

        # 07
        summary = pd.DataFrame([
            {
                "Proyecto":
                    project.get(
                        "source_name",
                        ""
                    ),

                "Fecha":
                    datetime.now()
                    .isoformat(),

                "Poblacion":
                    len(df),

                "Muestra":
                    len(sample),

                "Hash archivo original":
                    project.get(
                        "source_hash",
                        ""
                    )
            }
        ])

        summary.to_excel(
            writer,
            sheet_name=
                "07_Resumen_Ejecutivo",
            index=False
        )

        # Formato básico
        for worksheet in (
            writer
            .sheets
            .values()
        ):

            worksheet.freeze_panes(
                1,
                0
            )

            worksheet.set_column(
                0,
                30,
                18
            )

    output.seek(0)

    return send_file(
        output,
        as_attachment=True,
        download_name=
            "Audit_Sampling_Export.xlsx",
        mimetype=(
            "application/vnd.openxmlformats-officedocument."
            "spreadsheetml.sheet"
        )
    )


# ============================================================
# INICIO
# ============================================================

if __name__ == "__main__":

    port = int(
        os.environ.get(
            "PORT",
            5000
        )
    )

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )
