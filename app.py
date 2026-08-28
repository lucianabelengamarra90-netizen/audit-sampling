import os, uuid, math, hashlib, json, gzip, secrets
from datetime import datetime
from io import BytesIO, StringIO
import numpy as np
import pandas as pd
from flask import Flask, render_template, request, jsonify, send_file, session
import psycopg2
from psycopg2.extras import RealDictCursor, Json
from werkzeug.security import generate_password_hash, check_password_hash
app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'audit-secret-key-change-in-production')
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
ALLOWED_EXTENSIONS = {'csv', 'xlsx', 'xls', 'xlsb'}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
projects = {}
DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()

class WorkConflictError(Exception):
    pass

def database_available():
    return bool(DATABASE_URL)

def db_connect():
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL no está configurada.')
    return psycopg2.connect(DATABASE_URL, connect_timeout=10)

def json_default(value):
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)

def json_dumps(value):
    return json.dumps(value, ensure_ascii=False, default=json_default)

def df_to_blob(df):
    if df is None:
        return None
    text = df.to_json(orient='split', date_format='iso', force_ascii=False, default_handler=str)
    compressed = gzip.compress(text.encode('utf-8'), compresslevel=6)
    return psycopg2.Binary(compressed)

def blob_to_df(blob):
    if blob is None:
        return None
    raw = bytes(blob)
    if not raw:
        return pd.DataFrame()
    text = gzip.decompress(raw).decode('utf-8')
    return pd.read_json(StringIO(text), orient='split')

def init_db():
    if not database_available():
        print('DATABASE_URL no configurada: tracking persistente deshabilitado.')
        return
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute('\n                CREATE SEQUENCE IF NOT EXISTS audit_work_seq START 1;\n            ')
            cur.execute("\n                CREATE TABLE IF NOT EXISTS audit_projects (\n                    work_code VARCHAR(40) PRIMARY KEY,\n                    name TEXT NOT NULL,\n                    responsible TEXT NOT NULL,\n                    access_key_hash TEXT NOT NULL,\n                    status TEXT NOT NULL DEFAULT 'En curso',\n                    source_name TEXT,\n                    source_hash TEXT,\n                    mapping JSONB NOT NULL DEFAULT '{}'::jsonb,\n                    params JSONB NOT NULL DEFAULT '{}'::jsonb,\n                    audit_results JSONB NOT NULL DEFAULT '{}'::jsonb,\n                    population_blob BYTEA,\n                    sample_blob BYTEA,\n                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n                    version INTEGER NOT NULL DEFAULT 1\n                );\n            ")
            cur.execute("\n                CREATE TABLE IF NOT EXISTS audit_project_events (\n                    id BIGSERIAL PRIMARY KEY,\n                    work_code VARCHAR(40) NOT NULL\n                        REFERENCES audit_projects(work_code)\n                        ON DELETE CASCADE,\n                    event_type TEXT NOT NULL,\n                    actor TEXT,\n                    details JSONB NOT NULL DEFAULT '{}'::jsonb,\n                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n                );\n            ")
            cur.execute('\n                CREATE INDEX IF NOT EXISTS idx_audit_projects_updated\n                ON audit_projects(updated_at DESC);\n            ')
            cur.execute('\n                CREATE INDEX IF NOT EXISTS idx_audit_events_work\n                ON audit_project_events(work_code, created_at DESC);\n            ')
        conn.commit()

def log_event_with_cursor(cur, project, event_type, details=None):
    work_code = project.get('work_code')
    if not work_code:
        return
    cur.execute('\n        INSERT INTO audit_project_events\n            (work_code, event_type, actor, details)\n        VALUES\n            (%s, %s, %s, %s)\n        ', (work_code, event_type, project.get('responsible', ''), Json(details or {}, dumps=json_dumps)))

def log_event(project, event_type, details=None):
    if not database_available() or not project.get('work_code'):
        return
    with db_connect() as conn:
        with conn.cursor() as cur:
            log_event_with_cursor(cur, project, event_type, details)
        conn.commit()

def fetch_work_record(work_code):
    if not database_available():
        return None
    with db_connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute('\n                SELECT *\n                FROM audit_projects\n                WHERE UPPER(work_code) = UPPER(%s)\n                ', (work_code.strip(),))
            return cur.fetchone()

def record_to_project(row):
    return {'df': blob_to_df(row['population_blob']), 'mapping': row['mapping'] or {}, 'sample': blob_to_df(row['sample_blob']) if row['sample_blob'] is not None else pd.DataFrame(), 'params': row['params'] or {}, 'audit_results': row['audit_results'] or {}, 'created': row['created_at'].isoformat() if row.get('created_at') else datetime.now().isoformat(), 'source_name': row.get('source_name') or '', 'source_hash': row.get('source_hash') or '', 'work_code': row['work_code'], 'work_name': row['name'], 'responsible': row['responsible'], 'work_status': row.get('status') or 'En curso', 'db_version': int(row.get('version') or 1)}

def persist_project(project, event_type='Guardado', details=None):
    """
    Guarda el expediente completo.
    Usa control optimista de versión para evitar que dos personas
    sobrescriban cambios sin advertencia.
    """
    work_code = project.get('work_code')
    if not work_code:
        return False
    if not database_available():
        raise RuntimeError('La base de datos no está disponible. El trabajo no pudo guardarse de forma persistente.')
    expected_version = int(project.get('db_version', 1) or 1)
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute('\n                UPDATE audit_projects\n                SET\n                    name = %s,\n                    responsible = %s,\n                    status = %s,\n                    source_name = %s,\n                    source_hash = %s,\n                    mapping = %s,\n                    params = %s,\n                    audit_results = %s,\n                    population_blob = %s,\n                    sample_blob = %s,\n                    updated_at = NOW(),\n                    version = version + 1\n                WHERE\n                    work_code = %s\n                    AND version = %s\n                RETURNING version\n                ', (project.get('work_name') or 'Trabajo de auditoría', project.get('responsible') or '', project.get('work_status') or 'En curso', project.get('source_name') or '', project.get('source_hash') or '', Json(project.get('mapping') or {}, dumps=json_dumps), Json(project.get('params') or {}, dumps=json_dumps), Json(project.get('audit_results') or {}, dumps=json_dumps), df_to_blob(project.get('df')), df_to_blob(project.get('sample', pd.DataFrame())), work_code, expected_version))
            updated = cur.fetchone()
            if not updated:
                conn.rollback()
                raise WorkConflictError('Este trabajo fue modificado desde otra sesión. Volvé a abrirlo antes de guardar para evitar sobrescribir cambios.')
            project['db_version'] = int(updated[0])
            log_event_with_cursor(cur, project, event_type, details or {})
        conn.commit()
    return True

def create_persistent_work(project, name, responsible):
    if not database_available():
        raise RuntimeError('La conexión a PostgreSQL no está disponible.')
    name = (name or '').strip()
    responsible = (responsible or '').strip()
    if not name:
        raise ValueError('Ingresá un nombre para el trabajo.')
    if not responsible:
        raise ValueError('Ingresá el responsable del trabajo.')
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    access_key = ''.join((secrets.choice(alphabet) for _ in range(8)))
    access_key_hash = generate_password_hash(access_key)
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT nextval('audit_work_seq')")
            sequence_number = int(cur.fetchone()[0])
            work_code = f'AUD-{datetime.now().year}-{sequence_number:06d}'
            cur.execute('\n                INSERT INTO audit_projects (\n                    work_code,\n                    name,\n                    responsible,\n                    access_key_hash,\n                    status,\n                    source_name,\n                    source_hash,\n                    mapping,\n                    params,\n                    audit_results,\n                    population_blob,\n                    sample_blob,\n                    version\n                )\n                VALUES (\n                    %s, %s, %s, %s, %s,\n                    %s, %s, %s, %s, %s,\n                    %s, %s, 1\n                )\n                ', (work_code, name, responsible, access_key_hash, 'En curso', project.get('source_name') or '', project.get('source_hash') or '', Json(project.get('mapping') or {}, dumps=json_dumps), Json(project.get('params') or {}, dumps=json_dumps), Json(project.get('audit_results') or {}, dumps=json_dumps), df_to_blob(project.get('df')), df_to_blob(project.get('sample', pd.DataFrame()))))
            project['work_code'] = work_code
            project['work_name'] = name
            project['responsible'] = responsible
            project['work_status'] = 'En curso'
            project['db_version'] = 1
            log_event_with_cursor(cur, project, 'Trabajo creado', {'name': name, 'responsible': responsible})
        conn.commit()
    return (work_code, access_key)

def new_temp_project():
    return {'df': None, 'mapping': {}, 'sample': pd.DataFrame(), 'params': {}, 'audit_results': {}, 'created': datetime.now().isoformat(), 'source_name': '', 'source_hash': '', 'work_code': '', 'work_name': '', 'responsible': '', 'work_status': 'Temporal', 'db_version': None}

def allowed_file(name):
    return '.' in name and name.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_project():
    pid = session.get('project_id')
    if pid and pid in projects:
        return projects[pid]
    work_code = session.get('work_code')
    if work_code and database_available():
        try:
            row = fetch_work_record(work_code)
            if row:
                project = record_to_project(row)
                pid = str(uuid.uuid4())
                projects[pid] = project
                session['project_id'] = pid
                return project
        except Exception as exc:
            print('No se pudo restaurar el trabajo desde PostgreSQL:', exc)
    pid = str(uuid.uuid4())
    projects[pid] = new_temp_project()
    session['project_id'] = pid
    return projects[pid]

def project_state_payload(project):
    df = project.get('df')
    sample = project.get('sample', pd.DataFrame())
    mapping = project.get('mapping') or {}
    params = project.get('params') or {}
    population_state = None
    if df is not None:
        amount_col = mapping.get('amount_col')
        population_state = {'rows': int(len(df)), 'columns': list(df.columns), 'preview': df.head(10).fillna('').to_dict(orient='records'), 'analysis': population_analysis(df, amount_col) if amount_col in df.columns else None}
    sample_preview = []
    if sample is not None and (not sample.empty):
        sample_preview = sample.drop(columns=['_amount_numeric'], errors='ignore').head(500).fillna('').to_dict(orient='records')
    return {'work': {'work_code': project.get('work_code') or '', 'name': project.get('work_name') or '', 'responsible': project.get('responsible') or '', 'status': project.get('work_status') or '', 'created': project.get('created') or '', 'source_name': project.get('source_name') or '', 'source_hash': project.get('source_hash') or '', 'version': project.get('db_version')}, 'mapping': mapping, 'params': params, 'population': population_state, 'sample': {'rows': int(len(sample)) if sample is not None else 0, 'preview': sample_preview}, 'results': list((project.get('audit_results') or {}).values())}
try:
    init_db()
except Exception as exc:
    print('No se pudo inicializar PostgreSQL. La app seguirá funcionando en modo temporal:', exc)

def parse_amount(series):
    if pd.api.types.is_numeric_dtype(series):
        return pd.to_numeric(series, errors='coerce')
    cleaned = series.astype(str).str.strip().str.replace('[^0-9,.\\-]', '', regex=True)

    def parse_one(v):
        if v in ('', '-', '.', ',', 'nan', 'None'):
            return np.nan
        try:
            if ',' in v and '.' in v:
                if v.rfind(',') > v.rfind('.'):
                    v = v.replace('.', '').replace(',', '.')
                else:
                    v = v.replace(',', '')
            elif ',' in v:
                parts = v.split(',')
                if len(parts[-1]) in (1, 2):
                    v = v.replace('.', '').replace(',', '.')
                else:
                    v = v.replace(',', '')
            return float(v)
        except Exception:
            return np.nan
    return cleaned.map(parse_one)

def population_analysis(df, amount_col=None):
    result = {'records': int(len(df)), 'columns': list(df.columns), 'nulls': {str(k): int(v) for k, v in df.isna().sum().to_dict().items()}, 'duplicate_rows': int(df.duplicated().sum())}
    if amount_col and amount_col in df.columns:
        x = parse_amount(df[amount_col]).dropna()
        if len(x):
            q1 = x.quantile(0.25)
            q3 = x.quantile(0.75)
            iqr = q3 - q1
            lower = q1 - 3 * iqr
            upper = q3 + 3 * iqr
            abs_x = x.abs()
            abs_total = float(abs_x.sum())
            result.update({'amount_valid': int(len(x)), 'amount_total': float(x.sum()), 'amount_abs_total': abs_total, 'mean': float(x.mean()), 'median': float(x.median()), 'min': float(x.min()), 'max': float(x.max()), 'std': float(x.std(ddof=1)) if len(x) > 1 else 0, 'zeros': int((x == 0).sum()), 'negatives': int((x < 0).sum()), 'outliers': int(((x < lower) | (x > upper)).sum()), 'outlier_lower': float(lower), 'outlier_upper': float(upper), 'top10_pct': float(abs_x.nlargest(min(10, len(abs_x))).sum() / abs_total * 100) if abs_total else 0, 'top20_pct': float(abs_x.nlargest(min(20, len(abs_x))).sum() / abs_total * 100) if abs_total else 0, 'top50_pct': float(abs_x.nlargest(min(50, len(abs_x))).sum() / abs_total * 100) if abs_total else 0})
    return result

def sample_size(N, confidence, error, p):
    z_map = {'90': 1.645, '95': 1.96, '97': 2.17, '99': 2.576}
    z = z_map.get(str(confidence), 1.96)
    q = 1 - p
    if N <= 0 or error <= 0:
        return (0, z, q)
    n = z * z * p * q * N / (error * error * (N - 1) + z * z * p * q)
    return (int(math.ceil(n)), z, q)

def selection_signature(params, seed=None):
    return (str(params.get('id_col', '')), str(params.get('amount_col', '')), str(params.get('method', '')), int(params.get('n', 0) or 0), bool(params.get('include_materiality')), bool(params.get('include_outliers')), float(params.get('significant_threshold', 0) or 0), int(seed if seed is not None else params.get('seed') or 0))

def add_selection(base, idx, reason, method, selection_type, stratum):
    if len(idx) == 0:
        return pd.DataFrame()
    out = base.loc[idx].copy()
    out['_original_index'] = out.index.astype(int)
    out['Motivo de selección'] = reason
    out['Método'] = method
    out['Tipo_Seleccion'] = selection_type
    out['Estrato'] = stratum
    return out

def make_sample(df, params):
    id_col = params.get('id_col')
    amount_col = params.get('amount_col')
    method = params.get('method', 'random')
    seed = int(params.get('seed') or np.random.randint(1, 2 ** 31 - 1))
    rng = np.random.default_rng(seed)
    n = int(params.get('n', 0))
    work = df.copy()
    selected = []
    excluded = set()
    if amount_col and amount_col in work.columns:
        work['_amount_numeric'] = parse_amount(work[amount_col]).fillna(0)
    else:
        work['_amount_numeric'] = 0.0
    threshold = float(params.get('significant_threshold') or 0)
    if params.get('include_materiality') and threshold > 0:
        idx = work.index[work['_amount_numeric'].abs() >= threshold]
        if len(idx):
            selected.append(add_selection(work, idx, 'Partida significativa', 'Revisión 100%', 'Dirigida_100', '100%'))
            excluded.update(idx.tolist())
    if params.get('include_outliers'):
        x = work.loc[~work.index.isin(excluded), '_amount_numeric']
        if len(x):
            q1 = x.quantile(0.25)
            q3 = x.quantile(0.75)
            iqr = q3 - q1
            lower = q1 - 3 * iqr
            upper = q3 + 3 * iqr
            idx = x.index[(x < lower) | (x > upper)]
            if len(idx):
                selected.append(add_selection(work, idx, 'Valor atípico', 'Revisión 100%', 'Dirigida_100', '100%'))
                excluded.update(idx.tolist())
    residual = work.loc[~work.index.isin(excluded)].copy()
    n = min(n, len(residual))
    if n > 0 and method == 'random':
        idx = rng.choice(residual.index.to_numpy(), size=n, replace=False)
        selected.append(add_selection(work, idx, 'Selección aleatoria', 'Aleatorio simple', 'Probabilistica', 'Probabilístico'))
    elif n > 0 and method == 'systematic':
        ordered = residual.sort_values(id_col) if id_col in residual.columns else residual
        interval = len(ordered) / n
        start = rng.uniform(0, interval)
        pos = np.floor(start + np.arange(n) * interval).astype(int)
        pos = np.clip(pos, 0, len(ordered) - 1)
        idx = ordered.index[pos]
        selected.append(add_selection(work, idx, 'Selección sistemática', 'Sistemático', 'Probabilistica', 'Probabilístico'))
    elif n > 0 and method == 'mus':
        positive = residual.loc[residual['_amount_numeric'] > 0].copy()
        total_positive = float(positive['_amount_numeric'].sum())
        if len(positive) and total_positive > 0:
            interval = total_positive / n
            start = rng.uniform(0, interval)
            points = start + np.arange(n) * interval
            cumulative = positive['_amount_numeric'].cumsum().to_numpy()
            locs = np.searchsorted(cumulative, points, side='left')
            locs = np.clip(locs, 0, len(positive) - 1)
            idx = positive.index[np.unique(locs)]
            selected.append(add_selection(work, idx, 'Selección por unidad monetaria', 'MUS / PPS', 'Probabilistica', 'Probabilístico'))
    elif n > 0 and method == 'topn':
        idx = residual['_amount_numeric'].abs().nlargest(n).index
        selected.append(add_selection(work, idx, 'Mayores importes', 'Top N', 'Dirigida', 'Dirigido'))
    elif n > 0 and method == 'stratified':
        values = residual['_amount_numeric'].abs()
        q50 = values.quantile(0.5)
        q90 = values.quantile(0.9)
        if q50 == q90:
            idx = rng.choice(residual.index.to_numpy(), size=n, replace=False)
            selected.append(add_selection(work, idx, 'Selección estratificada', 'Estratificado', 'Probabilistica', 'Probabilístico'))
        else:
            residual['_stratum'] = pd.cut(values, bins=[-np.inf, q50, q90, np.inf], labels=['Bajo', 'Medio', 'Alto'], include_lowest=True)
            picks = []
            for _, group in residual.groupby('_stratum', observed=True):
                take = min(len(group), max(1, round(n * len(group) / len(residual))))
                picks.extend(rng.choice(group.index.to_numpy(), size=take, replace=False).tolist())
            picks = list(dict.fromkeys(picks))
            if len(picks) < n:
                remaining = residual.index[~residual.index.isin(picks)]
                extra = min(n - len(picks), len(remaining))
                if extra:
                    picks.extend(rng.choice(remaining.to_numpy(), size=extra, replace=False).tolist())
            selected.append(add_selection(work, picks[:n], 'Selección estratificada', 'Estratificado', 'Probabilistica', 'Probabilístico'))
    if not selected:
        return (pd.DataFrame(), seed)
    out = pd.concat(selected, ignore_index=False)
    out = out.drop_duplicates(subset=['_original_index'], keep='first')
    return (out, seed)

def normalize_result(item):
    idx = item.get('_original_index')
    if idx is None:
        return None
    try:
        idx = int(idx)
    except Exception:
        return None

    def number_or_blank(value):
        if value in ('', None):
            return ''
        try:
            return float(value)
        except Exception:
            return ''
    registered = number_or_blank(item.get('registered', item.get('audited', '')))
    validated = number_or_blank(item.get('validated', item.get('correct', '')))
    if registered != '' and validated != '':
        difference = registered - validated
    else:
        try:
            difference = float(item.get('difference', 0) or 0)
        except Exception:
            difference = 0.0
    return {'_original_index': idx, 'status': str(item.get('status', '') or '').strip(), 'registered': registered, 'validated': validated, 'difference': float(difference), 'exception_type': str(item.get('exception_type', '') or '').strip(), 'comment': str(item.get('comment', '') or '').strip(), 'evidence': str(item.get('evidence', '') or '').strip()}

def get_audit_rows(project):
    sample = project.get('sample', pd.DataFrame())
    results = project.get('audit_results', {})
    if sample.empty:
        return []
    rows = []
    for _, row in sample.iterrows():
        idx = int(row['_original_index'])
        result = results.get(str(idx), {})
        rows.append({'_original_index': idx, 'Estrato': row.get('Estrato', ''), 'Método': row.get('Método', ''), 'Motivo de selección': row.get('Motivo de selección', ''), 'Resultado de revisión': result.get('status', ''), 'Importe registrado': result.get('registered', ''), 'Importe validado': result.get('validated', ''), 'Diferencia': result.get('difference', ''), 'Tipo de excepción': result.get('exception_type', ''), 'Comentario del auditor': result.get('comment', ''), 'Referencia de evidencia': result.get('evidence', '')})
    return rows

def calculate_extrapolation(project):
    sample = project.get('sample', pd.DataFrame())
    df = project.get('df')
    params = project.get('params', {})
    results = project.get('audit_results', {})
    if df is None or sample.empty:
        raise ValueError('No existe muestra generada')
    amount_col = params.get('amount_col')
    if not amount_col or amount_col not in df.columns:
        raise ValueError('No se encuentra la columna de importe configurada')
    total_population = float(parse_amount(df[amount_col]).fillna(0).abs().sum())
    s = sample.copy()
    if '_amount_numeric' not in s.columns:
        s['_amount_numeric'] = parse_amount(s[amount_col]).fillna(0)
    s['_amount_abs'] = s['_amount_numeric'].abs()
    s['error'] = [float(results.get(str(int(i)), {}).get('difference', 0) or 0) for i in s['_original_index']]
    s['status'] = [results.get(str(int(i)), {}).get('status', '') for i in s['_original_index']]
    if 'Tipo_Seleccion' in s.columns:
        hundred = s[s['Tipo_Seleccion'] == 'Dirigida_100']
        prob = s[s['Tipo_Seleccion'] == 'Probabilistica']
        directed = s[s['Tipo_Seleccion'] == 'Dirigida']
    else:
        norm = s.get('Estrato', pd.Series('', index=s.index)).astype(str).str.lower()
        hundred = s[norm.eq('100%')]
        prob = s[norm.str.contains('probabil', na=False)]
        directed = s[~s.index.isin(hundred.index) & ~s.index.isin(prob.index)]
    observed_100 = float(hundred['error'].abs().sum())
    observed_prob = float(prob['error'].abs().sum())
    directed_observed = float(directed['error'].abs().sum())
    prob_sample_amount = float(prob['_amount_abs'].sum())
    excluded_ids = set(hundred['_original_index'].astype(int).tolist())
    excluded_ids.update(directed['_original_index'].astype(int).tolist())
    residual_population = float(parse_amount(df.loc[~df.index.isin(excluded_ids), amount_col]).fillna(0).abs().sum())
    error_rate = observed_prob / prob_sample_amount if prob_sample_amount else 0.0
    projected = error_rate * residual_population if len(prob) else None
    identified = observed_100 + observed_prob + directed_observed
    total_estimated = observed_100 + directed_observed + (projected or 0)
    exception_statuses = {'Excepción monetaria', 'Excepción no monetaria', 'Excepción', 'Error monetario', 'Error no monetario'}
    exceptions = int(s['status'].isin(exception_statuses).sum())
    materiality = float(params.get('materiality') or 0)
    tolerable = float(params.get('tolerable_error') or 0)

    def traffic(value, limit):
        if not limit:
            return 'sin umbral'
        ratio = abs(value) / abs(limit)
        if ratio < 0.8:
            return 'verde'
        if ratio <= 1:
            return 'amarillo'
        return 'rojo'
    method = params.get('method', '')
    message = None
    if not len(prob):
        message = 'La muestra no contiene registros probabilísticos. Las selecciones dirigidas o revisadas al 100% no deben extrapolarse estadísticamente.'
    elif method == 'mus':
        message = 'La muestra MUS/PPS es probabilística. La proyección mostrada es una estimación proporcional simplificada; una evaluación MUS formal requiere su metodología específica.'
    return {'extrapolable': bool(len(prob)), 'message': message, 'method': method, 'total_population': total_population, 'hundred_population': float(hundred['_amount_abs'].sum()), 'residual_population': residual_population, 'probabilistic_sample_amount': prob_sample_amount, 'probabilistic_sample_count': int(len(prob)), 'hundred_count': int(len(hundred)), 'directed_count': int(len(directed)), 'observed_100': observed_100, 'observed_residual': observed_prob, 'directed_observed': directed_observed, 'effectively_identified': identified, 'error_rate': error_rate, 'projected_residual': projected, 'total_estimated': total_estimated, 'exceptions': exceptions, 'sample_count': int(len(sample)), 'coverage_count': len(sample) / len(df) * 100 if len(df) else 0, 'coverage_amount': float(s['_amount_abs'].sum()) / total_population * 100 if total_population else 0, 'materiality': materiality, 'tolerable_error': tolerable, 'checks': {'observed_vs_materiality': traffic(identified, materiality), 'projected_vs_materiality': traffic(projected or 0, materiality), 'total_vs_materiality': traffic(total_estimated, materiality), 'projected_vs_tolerable': traffic(projected or 0, tolerable)}}

@app.route('/api/work/db-status', methods=['GET'])
def work_db_status():
    if not database_available():
        return jsonify(configured=False, available=False, message='DATABASE_URL no está configurada.')
    try:
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT 1')
                cur.fetchone()
        return jsonify(configured=True, available=True)
    except Exception as exc:
        return (jsonify(configured=True, available=False, message=str(exc)), 503)

@app.route('/api/work/current', methods=['GET'])
def current_work():
    project = get_project()
    return jsonify(project_state_payload(project))

@app.route('/api/work/create', methods=['POST'])
def create_work():
    project = get_project()
    data = request.json or {}
    if project.get('work_code'):
        return (jsonify(error='Ya hay un trabajo persistente abierto. Cerralo antes de crear uno nuevo.'), 400)
    try:
        work_code, access_key = create_persistent_work(project, data.get('name'), data.get('responsible'))
    except (ValueError, RuntimeError) as exc:
        return (jsonify(error=str(exc)), 400)
    except Exception as exc:
        return (jsonify(error='No se pudo crear el trabajo en PostgreSQL: ' + str(exc)), 500)
    session['work_code'] = work_code
    return jsonify(created=True, work_code=work_code, access_key=access_key, message='Trabajo creado. Guardá el Código de trabajo y la Clave de acceso.', state=project_state_payload(project))

@app.route('/api/work/open', methods=['POST'])
def open_work():
    data = request.json or {}
    work_code = str(data.get('work_code') or '').strip().upper()
    access_key = str(data.get('access_key') or '').strip().upper()
    if not work_code or not access_key:
        return (jsonify(error='Ingresá el Código de trabajo y la Clave de acceso.'), 400)
    try:
        row = fetch_work_record(work_code)
    except Exception as exc:
        return (jsonify(error='No se pudo consultar PostgreSQL: ' + str(exc)), 500)
    if not row:
        return (jsonify(error='No se encontró el Código de trabajo.'), 404)
    if not check_password_hash(row['access_key_hash'], access_key):
        return (jsonify(error='La Clave de acceso es incorrecta.'), 403)
    project = record_to_project(row)
    pid = str(uuid.uuid4())
    projects[pid] = project
    session['project_id'] = pid
    session['work_code'] = project['work_code']
    try:
        log_event(project, 'Trabajo abierto', {'source': 'web'})
    except Exception as exc:
        print('No se pudo registrar el evento de apertura:', exc)
    return jsonify(opened=True, state=project_state_payload(project))

@app.route('/api/work/save', methods=['POST'])
def save_work():
    project = get_project()
    if not project.get('work_code'):
        return (jsonify(error='Este es un trabajo temporal. Creá un Código de trabajo para guardarlo.'), 400)
    try:
        persist_project(project, 'Guardado manual')
    except WorkConflictError as exc:
        return (jsonify(error=str(exc), conflict=True), 409)
    except Exception as exc:
        return (jsonify(error='No se pudo guardar el trabajo: ' + str(exc)), 500)
    return jsonify(saved=True, work_code=project['work_code'], version=project.get('db_version'))

@app.route('/api/work/update', methods=['POST'])
def update_work():
    project = get_project()
    if not project.get('work_code'):
        return (jsonify(error='No hay un trabajo persistente abierto.'), 400)
    data = request.json or {}
    name = str(data.get('name') or project.get('work_name') or '').strip()
    responsible = str(data.get('responsible') or project.get('responsible') or '').strip()
    status = str(data.get('status') or project.get('work_status') or 'En curso').strip()
    if not name or not responsible:
        return (jsonify(error='Nombre y responsable son obligatorios.'), 400)
    project['work_name'] = name
    project['responsible'] = responsible
    project['work_status'] = status
    try:
        persist_project(project, 'Datos del trabajo actualizados', {'name': name, 'responsible': responsible, 'status': status})
    except WorkConflictError as exc:
        return (jsonify(error=str(exc), conflict=True), 409)
    except Exception as exc:
        return (jsonify(error=str(exc)), 500)
    return jsonify(updated=True, state=project_state_payload(project))

@app.route('/api/work/close', methods=['POST'])
def close_work():
    current = get_project()
    if current.get('work_code'):
        try:
            persist_project(current, 'Trabajo cerrado en sesión')
        except WorkConflictError:
            pass
        except Exception as exc:
            print('No se pudo autoguardar al cerrar:', exc)
    old_pid = session.pop('project_id', None)
    session.pop('work_code', None)
    if old_pid:
        projects.pop(old_pid, None)
    project = get_project()
    return jsonify(closed=True, state=project_state_payload(project))

@app.route('/api/work/events', methods=['GET'])
def work_events():
    project = get_project()
    work_code = project.get('work_code')
    if not work_code:
        return jsonify(events=[])
    try:
        with db_connect() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute('\n                    SELECT\n                        event_type,\n                        actor,\n                        details,\n                        created_at\n                    FROM audit_project_events\n                    WHERE work_code = %s\n                    ORDER BY created_at DESC\n                    LIMIT 100\n                    ', (work_code,))
                rows = cur.fetchall()
        events = [{'event_type': row['event_type'], 'actor': row['actor'], 'details': row['details'] or {}, 'created_at': row['created_at'].isoformat() if row['created_at'] else ''} for row in rows]
        return jsonify(events=events)
    except Exception as exc:
        return (jsonify(error=str(exc)), 500)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return (jsonify(error='Seleccione un archivo'), 400)
    f = request.files['file']
    if not f.filename or not allowed_file(f.filename):
        return (jsonify(error='Formato no admitido. Use CSV, XLSX, XLS o XLSB.'), 400)
    name = f.filename
    path = os.path.join(UPLOAD_FOLDER, f'{uuid.uuid4()}_{name}')
    f.save(path)
    try:
        ext = name.rsplit('.', 1)[1].lower()
        if ext == 'csv':
            try:
                df = pd.read_csv(path, low_memory=False)
            except UnicodeDecodeError:
                df = pd.read_csv(path, low_memory=False, encoding='latin1')
        else:
            df = pd.read_excel(path, engine='pyxlsb' if ext == 'xlsb' else None)
    except Exception as e:
        return (jsonify(error='No se pudo leer el archivo: ' + str(e)), 400)
    df.columns = [str(c).strip() for c in df.columns]
    p = get_project()
    p['df'] = df
    p['mapping'] = {}
    p['sample'] = pd.DataFrame()
    p['params'] = {}
    p['audit_results'] = {}
    p['source_name'] = name
    with open(path, 'rb') as h:
        p['source_hash'] = hashlib.sha256(h.read()).hexdigest()
    if p.get('work_code'):
        try:
            persist_project(p, 'Población cargada', {'source_name': name, 'rows': int(len(df))})
        except WorkConflictError as exc:
            return (jsonify(error=str(exc), conflict=True), 409)
        except Exception as exc:
            return (jsonify(error='La población se cargó, pero no pudo guardarse en el trabajo persistente: ' + str(exc)), 500)
    return jsonify(rows=int(len(df)), columns=list(df.columns), preview=df.head(10).fillna('').to_dict(orient='records'))

@app.route('/api/analyze', methods=['POST'])
def analyze():
    p = get_project()
    data = request.json or {}
    df = p.get('df')
    if df is None:
        return (jsonify(error='Cargue primero una población'), 400)
    id_col = data.get('id') or data.get('id_col')
    amount_col = data.get('amount') or data.get('amount_col')
    if not id_col or not amount_col:
        return (jsonify(error='Debe definir las columnas ID e Importe'), 400)
    p['mapping'] = {'id_col': id_col, 'amount_col': amount_col}
    if p.get('work_code'):
        try:
            persist_project(p, 'Mapeo de población actualizado', {'id_col': id_col, 'amount_col': amount_col})
        except WorkConflictError as exc:
            return (jsonify(error=str(exc), conflict=True), 409)
        except Exception as exc:
            return (jsonify(error='El análisis se realizó, pero no pudo guardarse en el trabajo persistente: ' + str(exc)), 500)
    return jsonify(population_analysis(df, amount_col))

@app.route('/api/calculate-sample', methods=['POST'])
def calculate_sample():
    d = request.json or {}
    N = int(d.get('N', 0))
    confidence = d.get('confidence', '95')
    error = float(d.get('error', 0.05))
    p = float(d.get('p', 0.5))
    n, z, q = sample_size(N, confidence, error, p)
    return jsonify(n=n, z=z, q=q, formula='n=(Z²*p*q*N) / [e²*(N-1)+Z²*p*q]', variables={'N': N, 'Z': z, 'p': p, 'q': q, 'e': error})

@app.route('/api/recommend', methods=['POST'])
def recommend():
    p = get_project()
    df = p.get('df')
    d = request.json or {}
    amount_col = d.get('amount_col')
    if df is None or not amount_col:
        return (jsonify(error='Defina una columna de importe'), 400)
    a = population_analysis(df, amount_col)
    reasons = []
    if a.get('top20_pct', 0) >= 40:
        reasons.append('Existe alta concentración monetaria: los 20 mayores importes explican al menos 40% del valor absoluto de la población.')
    if a.get('outliers', 0) > 0:
        reasons.append(f"Se detectaron {a['outliers']} valores atípicos por criterio de 3×IQR.")
    threshold = float(d.get('significant_threshold') or 0)
    significant = 0
    if threshold > 0:
        significant = int((parse_amount(df[amount_col]).abs() >= threshold).sum())
    if significant:
        reasons.append(f'Hay {significant} partidas iguales o superiores al umbral significativo.')
    if significant or a.get('top20_pct', 0) >= 40:
        method = 'stratified'
        recommendation = 'Revisión 100% de partidas significativas + muestreo estratificado del universo residual'
    elif a.get('std', 0) > abs(a.get('mean', 0)) and a.get('records', 0) > 30:
        method = 'stratified'
        recommendation = 'Muestreo estratificado'
    else:
        method = 'random'
        recommendation = 'Muestreo aleatorio simple'
    return jsonify(method=method, recommendation=recommendation, reasons=reasons or ['La población no presenta señales fuertes de concentración; un muestreo aleatorio simple es una alternativa razonable.'], analysis=a)

@app.route('/api/generate-sample', methods=['POST'])
def generate_sample():
    p = get_project()
    df = p.get('df')
    d = request.json or {}
    if df is None:
        return (jsonify(error='Cargue primero una población'), 400)
    previous_params = p.get('params', {}).copy()
    previous_signature = selection_signature(previous_params, previous_params.get('seed')) if previous_params else None
    sample, seed = make_sample(df, d)
    new_signature = selection_signature(d, seed)
    p['sample'] = sample
    p['params'] = d.copy()
    p['params']['seed'] = seed
    if previous_signature != new_signature:
        p['audit_results'] = {}
    amount_col = d.get('amount_col')
    total = float(parse_amount(df[amount_col]).fillna(0).abs().sum()) if amount_col in df.columns else 0
    selected = float(sample.get('_amount_numeric', pd.Series(dtype=float)).abs().sum()) if len(sample) else 0
    if p.get('work_code'):
        try:
            persist_project(p, 'Muestra generada', {'selection_code': str(seed), 'method': d.get('method', ''), 'sample_rows': int(len(sample))})
        except WorkConflictError as exc:
            return (jsonify(error=str(exc), conflict=True), 409)
        except Exception as exc:
            return (jsonify(error='La muestra se generó, pero no pudo guardarse en el trabajo persistente: ' + str(exc)), 500)
    return jsonify(rows=int(len(sample)), seed=seed, selection_code=str(seed), coverage_amount=selected / total * 100 if total else 0, coverage_count=len(sample) / len(df) * 100 if len(df) else 0, method=d.get('method', ''), preview=sample.drop(columns=['_amount_numeric'], errors='ignore').head(500).fillna('').to_dict(orient='records'))

@app.route('/api/sample', methods=['GET'])
def sample_data():
    p = get_project()
    s = p.get('sample', pd.DataFrame())
    return jsonify(rows=int(len(s)), data=s.drop(columns=['_amount_numeric'], errors='ignore').fillna('').to_dict(orient='records'))

@app.route('/api/results', methods=['POST'])
def save_results():
    p = get_project()
    data = request.json or {}
    incoming = data.get('results', [])
    clean = {}
    for item in incoming:
        normalized = normalize_result(item)
        if normalized is not None:
            clean[str(normalized['_original_index'])] = normalized
    p['audit_results'] = clean
    if p.get('work_code'):
        try:
            persist_project(p, 'Resultados guardados', {'results_count': len(clean)})
        except WorkConflictError as exc:
            return (jsonify(error=str(exc), conflict=True), 409)
        except Exception as exc:
            return (jsonify(error='Los resultados se procesaron, pero no pudieron guardarse en PostgreSQL: ' + str(exc)), 500)
    return jsonify(saved=len(clean))

@app.route('/api/review-template', methods=['GET'])
def review_template():
    p = get_project()
    sample = p.get('sample', pd.DataFrame())
    if sample.empty:
        return (jsonify(error='Genere primero una muestra'), 400)
    review_df = sample.drop(columns=['_amount_numeric'], errors='ignore').copy()
    results = p.get('audit_results', {})
    amount_col = p.get('params', {}).get('amount_col')
    review_df['Resultado de revisión'] = [results.get(str(int(i)), {}).get('status', '') for i in review_df['_original_index']]
    review_df['Importe registrado'] = [results.get(str(int(i)), {}).get('registered', review_df.loc[review_df['_original_index'] == i, amount_col].iloc[0] if amount_col in review_df.columns else '') for i in review_df['_original_index']]
    review_df['Importe validado'] = [results.get(str(int(i)), {}).get('validated', '') for i in review_df['_original_index']]
    review_df['Diferencia'] = [results.get(str(int(i)), {}).get('difference', '') for i in review_df['_original_index']]
    review_df['Tipo de excepción'] = [results.get(str(int(i)), {}).get('exception_type', '') for i in review_df['_original_index']]
    review_df['Comentario del auditor'] = [results.get(str(int(i)), {}).get('comment', '') for i in review_df['_original_index']]
    review_df['Referencia de evidencia'] = [results.get(str(int(i)), {}).get('evidence', '') for i in review_df['_original_index']]
    out = BytesIO()
    with pd.ExcelWriter(out, engine='xlsxwriter') as writer:
        review_df.to_excel(writer, sheet_name='Hoja_de_Revision', index=False)
        wb = writer.book
        ws = writer.sheets['Hoja_de_Revision']
        header_fmt = wb.add_format({'bold': True, 'bg_color': '#222222', 'font_color': '#FFFFFF', 'border': 1, 'align': 'center', 'valign': 'vcenter'})
        source_fmt = wb.add_format({'bg_color': '#F3F3F3', 'border': 1})
        audit_fmt = wb.add_format({'bg_color': '#FFF7D1', 'border': 1})
        audit_cols = {'Resultado de revisión', 'Importe registrado', 'Importe validado', 'Diferencia', 'Tipo de excepción', 'Comentario del auditor', 'Referencia de evidencia'}
        for c, col in enumerate(review_df.columns):
            ws.write(0, c, col, header_fmt)
            width = 34 if col in {'Comentario del auditor', 'Referencia de evidencia'} else min(max(14, len(str(col)) + 3), 30)
            ws.set_column(c, c, width, audit_fmt if col in audit_cols else source_fmt)
        status_col = review_df.columns.get_loc('Resultado de revisión')
        ws.data_validation(1, status_col, max(1, len(review_df)), status_col, {'validate': 'list', 'source': ['Pendiente', 'Sin excepción', 'Excepción monetaria', 'Excepción no monetaria']})
        exception_col = review_df.columns.get_loc('Tipo de excepción')
        ws.data_validation(1, exception_col, max(1, len(review_df)), exception_col, {'validate': 'list', 'source': ['Monetaria', 'Documental', 'Cumplimiento', 'Duplicado', 'Imputación / registración', 'Otro']})
        ws.freeze_panes(1, 0)
        ws.autofilter(0, 0, len(review_df), len(review_df.columns) - 1)
        guide = pd.DataFrame({'Campo': ['Resultado de revisión', 'Importe registrado', 'Importe validado', 'Diferencia', 'Tipo de excepción', 'Comentario del auditor', 'Referencia de evidencia'], 'Cómo completarlo': ['Indicá si el registro fue validado sin diferencias o presenta una excepción.', 'Valor informado originalmente en la población.', 'Valor determinado como correcto según la evidencia revisada.', 'Importe registrado menos Importe validado. La app lo recalcula al importar.', 'Clasificación breve del desvío detectado.', 'Descripción corta del hallazgo, diferencia o validación.', 'Factura, OC, ticket, SAP, archivo u otra evidencia utilizada.']})
        guide.to_excel(writer, sheet_name='Guia', index=False)
        writer.sheets['Guia'].set_column(0, 0, 30)
        writer.sheets['Guia'].set_column(1, 1, 90)
        params = p.get('params', {})
        trace = pd.DataFrame([['Código de trabajo', p.get('work_code', '')], ['Nombre del trabajo', p.get('work_name', '')], ['Responsable', p.get('responsible', '')], ['Código de selección', params.get('seed', '')], ['Método', params.get('method', '')], ['Archivo origen', p.get('source_name', '')], ['Hash archivo origen', p.get('source_hash', '')]], columns=['Dato', 'Valor'])
        trace.to_excel(writer, sheet_name='Trazabilidad', index=False)
        writer.sheets['Trazabilidad'].set_column(0, 0, 28)
        writer.sheets['Trazabilidad'].set_column(1, 1, 70)
    out.seek(0)
    return send_file(out, as_attachment=True, download_name='Hoja_Revision_Auditoria.xlsx', mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@app.route('/api/import-results', methods=['POST'])
def import_results():
    p = get_project()
    sample = p.get('sample', pd.DataFrame())
    if sample.empty:
        return (jsonify(error='Genere primero una muestra'), 400)
    if 'file' not in request.files:
        return (jsonify(error='Seleccione el Excel de revisión'), 400)
    f = request.files['file']
    try:
        excel = pd.ExcelFile(f)
        review_df = pd.read_excel(excel, sheet_name='Hoja_de_Revision')
        trace_data = {}
        if 'Trazabilidad' in excel.sheet_names:
            trace_df = pd.read_excel(excel, sheet_name='Trazabilidad')
            if 'Dato' in trace_df.columns and 'Valor' in trace_df.columns:
                trace_data = {str(row['Dato']): row['Valor'] for _, row in trace_df.iterrows()}
    except Exception as e:
        return (jsonify(error='No se pudo leer el Excel de revisión: ' + str(e)), 400)
    required = ['_original_index', 'Resultado de revisión', 'Importe registrado', 'Importe validado', 'Diferencia', 'Tipo de excepción', 'Comentario del auditor', 'Referencia de evidencia']
    missing = [col for col in required if col not in review_df.columns]
    if missing:
        return (jsonify(error='Faltan columnas requeridas: ' + ', '.join(missing)), 400)

    def normalize_seed(value):
        if value in ('', None) or pd.isna(value):
            return ''
        try:
            return str(int(float(value)))
        except Exception:
            return str(value).strip()
    current_work_code = str(p.get('work_code', '') or '').strip().upper()
    imported_work_code = str(trace_data.get('Código de trabajo', '') or '').strip().upper()
    if imported_work_code and current_work_code and (imported_work_code != current_work_code):
        return (jsonify(error='El Excel corresponde a otro Código de trabajo. No se importaron resultados.'), 400)
    current_seed = normalize_seed(p.get('params', {}).get('seed', ''))
    imported_seed = normalize_seed(trace_data.get('Código de selección', ''))
    if imported_seed and current_seed and (imported_seed != current_seed):
        return (jsonify(error='El Excel corresponde a otro Código de selección. Importe la hoja asociada a la muestra actual.'), 400)
    current_hash = str(p.get('source_hash', ''))
    imported_hash = str(trace_data.get('Hash archivo origen', ''))
    if imported_hash and current_hash and (imported_hash != current_hash):
        return (jsonify(error='El Excel corresponde a otra población. No se importaron resultados.'), 400)
    sample_ids = set(sample['_original_index'].astype(int).tolist())
    incoming_ids = pd.to_numeric(review_df['_original_index'], errors='coerce')
    if incoming_ids.isna().any():
        return (jsonify(error='Hay identificadores internos inválidos en el Excel.'), 400)
    incoming_ids = incoming_ids.astype(int)
    duplicates = incoming_ids[incoming_ids.duplicated()].tolist()
    if duplicates:
        return (jsonify(error='El Excel contiene IDs internos duplicados: ' + ', '.join((str(x) for x in duplicates[:10]))), 400)
    foreign = sorted(set(incoming_ids.tolist()) - sample_ids)
    if foreign:
        return (jsonify(error='El Excel contiene registros que no pertenecen a la muestra actual: ' + ', '.join((str(x) for x in foreign[:10]))), 400)
    imported = {}
    for _, row in review_df.iterrows():
        idx = int(row['_original_index'])
        reg_raw = pd.to_numeric(pd.Series([row['Importe registrado']]), errors='coerce').iloc[0]
        val_raw = pd.to_numeric(pd.Series([row['Importe validado']]), errors='coerce').iloc[0]
        registered = '' if pd.isna(reg_raw) else float(reg_raw)
        validated = '' if pd.isna(val_raw) else float(val_raw)
        if registered != '' and validated != '':
            difference = registered - validated
        else:
            diff_raw = pd.to_numeric(pd.Series([row['Diferencia']]), errors='coerce').iloc[0]
            difference = 0.0 if pd.isna(diff_raw) else float(diff_raw)

        def text_value(col):
            value = row[col]
            return '' if pd.isna(value) else str(value).strip()
        imported[str(idx)] = {'_original_index': idx, 'status': text_value('Resultado de revisión'), 'registered': registered, 'validated': validated, 'difference': float(difference), 'exception_type': text_value('Tipo de excepción'), 'comment': text_value('Comentario del auditor'), 'evidence': text_value('Referencia de evidencia')}
    p['audit_results'].update(imported)
    if p.get('work_code'):
        try:
            persist_project(p, 'Resultados importados desde Excel', {'imported': len(imported)})
        except WorkConflictError as exc:
            return (jsonify(error=str(exc), conflict=True), 409)
        except Exception as exc:
            return (jsonify(error='Los resultados se importaron, pero no pudieron guardarse en PostgreSQL: ' + str(exc)), 500)
    return jsonify(imported=len(imported), missing_from_file=len(sample_ids - set(incoming_ids.tolist())), results=list(imported.values()))

@app.route('/api/extrapolation', methods=['GET'])
def extrapolation():
    p = get_project()
    try:
        return jsonify(calculate_extrapolation(p))
    except ValueError as e:
        return (jsonify(error=str(e)), 400)

@app.route('/api/export', methods=['GET'])
def export_excel():
    p = get_project()
    df = p.get('df')
    sample = p.get('sample', pd.DataFrame())
    if df is None:
        return (jsonify(error='Sin población'), 400)
    out = BytesIO()
    with pd.ExcelWriter(out, engine='xlsxwriter') as writer:
        df.to_excel(writer, sheet_name='01_Poblacion_Original', index=False)
        analysis = population_analysis(df, p.get('mapping', {}).get('amount_col'))
        analysis_rows = []
        for key, value in analysis.items():
            if isinstance(value, dict):
                for subkey, subvalue in value.items():
                    analysis_rows.append([f'{key}.{subkey}', subvalue])
            elif isinstance(value, list):
                analysis_rows.append([key, ', '.join((str(x) for x in value))])
            else:
                analysis_rows.append([key, value])
        pd.DataFrame(analysis_rows, columns=['Métrica', 'Valor']).to_excel(writer, sheet_name='02_Analisis_Poblacion', index=False)
        params_rows = [['Código de selección' if key == 'seed' else key, value] for key, value in p.get('params', {}).items()]
        pd.DataFrame(params_rows, columns=['Parámetro', 'Valor']).to_excel(writer, sheet_name='03_Parametros_Muestreo', index=False)
        sample.drop(columns=['_amount_numeric'], errors='ignore').to_excel(writer, sheet_name='04_Muestra_Seleccionada', index=False)
        pd.DataFrame(get_audit_rows(p)).to_excel(writer, sheet_name='05_Resultados_Auditoria', index=False)
        try:
            extra = calculate_extrapolation(p)
            extra_rows = []
            for key, value in extra.items():
                if isinstance(value, dict):
                    for subkey, subvalue in value.items():
                        extra_rows.append([f'{key}.{subkey}', subvalue])
                else:
                    extra_rows.append([key, value])
            pd.DataFrame(extra_rows, columns=['Métrica', 'Valor']).to_excel(writer, sheet_name='06_Extrapolacion', index=False)
        except Exception:
            pd.DataFrame([{'Estado': 'Pendiente de resultados'}]).to_excel(writer, sheet_name='06_Extrapolacion', index=False)
        summary = pd.DataFrame([{'Código de trabajo': p.get('work_code', ''), 'Nombre del trabajo': p.get('work_name', ''), 'Responsable': p.get('responsible', ''), 'Proyecto': p.get('source_name', ''), 'Fecha': datetime.now().isoformat(), 'Población': len(df), 'Muestra': len(sample), 'Código de selección': p.get('params', {}).get('seed', ''), 'Hash archivo original': p.get('source_hash', '')}])
        summary.to_excel(writer, sheet_name='07_Resumen_Ejecutivo', index=False)
        for ws in writer.sheets.values():
            ws.freeze_panes(1, 0)
            ws.set_column(0, min(30, ws.dim_colmax + 1), 18)
    out.seek(0)
    return send_file(out, as_attachment=True, download_name='Audit_Sampling_Export.xlsx', mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
