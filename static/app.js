// Audit Sampling & Extrapolation - Frontend

let population = null, mapping = {}, sample = [], results = {};

document.querySelectorAll(".nav-tab").forEach(t => t.onclick = () => {
    document.querySelectorAll(".nav-tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    document.getElementById(t.dataset.tab).classList.add("active");
});

const drop = document.getElementById("drop"),
      file = document.getElementById("file"),
      msg = document.getElementById("msg"),
      mappingCard = document.getElementById("mappingCard"),
      mappingDiv = document.getElementById("mapping"),
      analyze = document.getElementById("analyze"),
      preview = document.getElementById("preview"),
      popKpis = document.getElementById("popKpis"),
      quality = document.getElementById("quality");

drop.onclick = () => file.click();

file.onchange = upload;

drop.ondragover = e => {
    e.preventDefault();
    drop.style.borderColor = "var(--primary)";
};

drop.ondragleave = () => drop.style.borderColor = "";

drop.ondrop = e => {
    e.preventDefault();
    drop.style.borderColor = "";
    if (e.dataTransfer.files.length) {
        upload({ target: { files: e.dataTransfer.files } });
    }
};

async function upload(e) {
    const f = e.target.files[0];
    if (!f) return;

    const fd = new FormData();
    fd.append("file", f);

    msg.innerHTML = "Cargando...";

    try {
        const r = await fetch("/api/upload", {
            method: "POST",
            body: fd
        });

        const j = await r.json();

        if (j.error) {
            msg.innerHTML = j.error;
            return;
        }

        msg.innerHTML = "Archivo: " + f.name + " (" + j.rows + " filas)";
        document.getElementById("fileStatus").textContent =
            f.name + " (" + j.rows + " filas)";

        mappingDiv.innerHTML = "";

        j.columns.forEach(c => {
            mappingDiv.innerHTML +=
                '<div class="form-group">' +
                '<label>' + c + '</label>' +
                '<select class="col-map" data-col="' + c + '">' +
                '<option value="">Ignorar</option>' +
                '<option value="id">ID</option>' +
                '<option value="amount">Importe</option>' +
                '<option value="date">Fecha</option>' +
                '<option value="vendor">Proveedor</option>' +
                '<option value="company">Sociedad</option>' +
                '<option value="center">Centro</option>' +
                '<option value="user">Usuario</option>' +
                '<option value="doctype">Tipo Doc</option>' +
                '<option value="account">Cuenta</option>' +
                '</select>' +
                '</div>';
        });

        mappingCard.style.display = "block";
        population = j;

        preview.innerHTML =
            "<thead><tr>" +
            j.columns.map(c => "<th>" + c + "</th>").join("") +
            "</tr></thead><tbody>" +
            j.preview.map(row =>
                "<tr>" +
                j.columns.map(c => "<td>" + (row[c] || "") + "</td>").join("") +
                "</tr>"
            ).join("") +
            "</tbody>";

    } catch (err) {
        msg.innerHTML = "Error: " + err.message;
    }
}

analyze.onclick = async () => {
    mapping = {};

    document.querySelectorAll(".col-map").forEach(s => {
        if (s.value) {
            mapping[s.value] = s.dataset.col;
        }
    });

    if (!mapping.id || !mapping.amount) {
        alert("Seleccione ID e Importe");
        return;
    }

    const r = await fetch("/api/analyze", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(mapping)
    });

    const j = await r.json();

    if (j.error) {
        alert(j.error);
        return;
    }

    document.getElementById("populationResults").style.display = "block";

    popKpis.innerHTML =
        '<div class="kpi-card">' +
            '<div class="kpi-label">Registros</div>' +
            '<div class="kpi-value">' + j.records.toLocaleString() + '</div>' +
        '</div>' +

        '<div class="kpi-card">' +
            '<div class="kpi-label">Importe Total</div>' +
            '<div class="kpi-value">' + formatMoney(j.amount_total || 0) + '</div>' +
        '</div>' +

        '<div class="kpi-card">' +
            '<div class="kpi-label">Promedio</div>' +
            '<div class="kpi-value">' + formatMoney(j.mean || 0) + '</div>' +
        '</div>' +

        '<div class="kpi-card">' +
            '<div class="kpi-label">Mediana</div>' +
            '<div class="kpi-value">' + formatMoney(j.median || 0) + '</div>' +
        '</div>' +

        '<div class="kpi-card">' +
            '<div class="kpi-label">Máximo</div>' +
            '<div class="kpi-value">' + formatMoney(j.max || 0) + '</div>' +
        '</div>' +

        '<div class="kpi-card">' +
            '<div class="kpi-label">Mínimo</div>' +
            '<div class="kpi-value">' + formatMoney(j.min || 0) + '</div>' +
        '</div>' +

        '<div class="kpi-card">' +
            '<div class="kpi-label">Desv. Estándar</div>' +
            '<div class="kpi-value">' + formatMoney(j.std || 0) + '</div>' +
        '</div>' +

        '<div class="kpi-card">' +
            '<div class="kpi-label">Duplicados</div>' +
            '<div class="kpi-value">' + (j.duplicate_rows || 0) + '</div>' +
        '</div>';

    quality.innerHTML =
        '<div class="quality-item">' +
            '<span class="quality-label">Ceros</span>' +
            '<span class="quality-value">' + (j.zeros || 0) + '</span>' +
        '</div>' +

        '<div class="quality-item">' +
            '<span class="quality-label">Negativos</span>' +
            '<span class="quality-value">' + (j.negatives || 0) + '</span>' +
        '</div>' +

        '<div class="quality-item">' +
            '<span class="quality-label">Outliers</span>' +
            '<span class="quality-value">' + (j.outliers || 0) + '</span>' +
        '</div>' +

        '<div class="quality-item">' +
            '<span class="quality-label">Top 10</span>' +
            '<span class="quality-value">' + (j.top10_pct || 0).toFixed(1) + '%</span>' +
        '</div>' +

        '<div class="quality-item">' +
            '<span class="quality-label">Top 20</span>' +
            '<span class="quality-value">' + (j.top20_pct || 0).toFixed(1) + '%</span>' +
        '</div>' +

        '<div class="quality-item">' +
            '<span class="quality-label">Top 50</span>' +
            '<span class="quality-value">' + (j.top50_pct || 0).toFixed(1) + '%</span>' +
        '</div>';

    document.getElementById("N").value = j.records;
};

document.getElementById("p").oninput = () => {
    const p = parseFloat(document.getElementById("p").value) || 0.5;
    document.getElementById("q").value = (1 - p).toFixed(2);
};

document.getElementById("q").value = "0.5";

document.getElementById("howSample").onclick = () => {
    const N = parseInt(document.getElementById("N").value) || 0;
    const conf = document.getElementById("confidence").value;
    const e = parseFloat(document.getElementById("error").value) || 0.05;
    const p = parseFloat(document.getElementById("p").value) || 0.5;
    const q = 1 - p;

    const zmap = {
        "90": 1.645,
        "95": 1.96,
        "97": 2.17,
        "99": 2.576
    };

    const z = zmap[conf];

    const n =
        (z * z * p * q * N) /
        (e * e * (N - 1) + z * z * p * q);

    document.getElementById("modalText").innerHTML =
        '<p><strong>Fórmula</strong>: ' +
        'n = (Z² × p × q × N) / [e² × (N-1) + Z² × p × q]</p>' +

        '<p><strong>Variables</strong>:<br>' +
        'Z = ' + z + ' (confianza ' + conf + '%)<br>' +
        'p = ' + p + '<br>' +
        'q = ' + q.toFixed(2) + '<br>' +
        'N = ' + N + '<br>' +
        'e = ' + e +
        '</p>' +

        '<p><strong>Resultado</strong>: n = ' +
        Math.ceil(n) +
        ' registros</p>';

    document.getElementById("modal").classList.add("active");
};

document.getElementById("recommend").onclick = async () => {

    if (!mapping.amount) {
        alert("Analice la población primero");
        return;
    }

    const r = await fetch("/api/recommend", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            amount_col: mapping.amount,
            significant_threshold:
                parseFloat(document.getElementById("threshold").value) || 0
        })
    });

    const j = await r.json();

    const box = document.getElementById("recommendationBox");

    box.style.display = "block";

    box.innerHTML =
        '<p><strong>Recomendación</strong>: ' +
        j.recommendation +
        '</p>' +

        '<p><strong>Razones</strong>:</p>' +

        '<ul>' +
        j.reasons.map(x => "<li>" + x + "</li>").join("") +
        '</ul>';
};

document.getElementById("generate").onclick = async () => {

    if (!mapping.id || !mapping.amount) {
        alert("Analice la población primero");
        return;
    }

    const N = parseInt(document.getElementById("N").value) || 0;
    const conf = document.getElementById("confidence").value;
    const e = parseFloat(document.getElementById("error").value) || 0.05;
    const p = parseFloat(document.getElementById("p").value) || 0.5;

    const r = await fetch("/api/calculate-sample", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            N,
            confidence: conf,
            error: e,
            p
        })
    });

    const j = await r.json();

    document.getElementById("nResult").textContent = j.n;

    const method =
        document.querySelector('input[name="method"]:checked').value;

    const payload = {
        id_col: mapping.id,
        amount_col: mapping.amount,
        method,
        n: j.n,
        confidence: conf,
        error: e,
        p,
        seed: Date.now(),
        include_materiality:
            document.getElementById("incMat").checked,
        include_outliers:
            document.getElementById("incOut").checked,
        significant_threshold:
            parseFloat(document.getElementById("threshold").value) || 0,
        materiality:
            parseFloat(document.getElementById("materiality").value) || 0,
        tolerable_error:
            parseFloat(document.getElementById("tolerable").value) || 0
    };

    const s = await fetch("/api/generate-sample", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const sj = await s.json();

    sample = sj.preview || [];

    document.getElementById("sampleSummary").innerHTML =
        '<div class="summary-item">' +
            '<span class="summary-label">Tamaño</span>' +
            '<span class="summary-value">' + (sj.rows || 0) + '</span>' +
        '</div>' +

        '<div class="summary-item">' +
            '<span class="summary-label">Cobertura %</span>' +
            '<span class="summary-value">' +
            (sj.coverage_count || 0).toFixed(2) +
            '%</span>' +
        '</div>' +

        '<div class="summary-item">' +
            '<span class="summary-label">Semilla</span>' +
            '<span class="summary-value">' + sj.seed + '</span>' +
        '</div>';

    renderSampleTable();
    renderResultsTable();

    alert("Muestra: " + sj.rows + " registros");
};

function renderSampleTable() {

    if (!sample.length) return;

    const cols =
        Object.keys(sample[0]).filter(c => !c.startsWith("_"));

    document.getElementById("sampleTable").innerHTML =
        "<thead><tr>" +
        cols.map(c => "<th>" + c + "</th>").join("") +
        "</tr></thead><tbody>" +

        sample.map(row =>
            "<tr>" +
            cols.map(c =>
                "<td>" + (row[c] || "") + "</td>"
            ).join("") +
            "</tr>"
        ).join("") +

        "</tbody>";
}

function renderResultsTable() {

    if (!sample.length) return;

    const cols =
        Object.keys(sample[0]).filter(c => !c.startsWith("_"));

    document.getElementById("resultsTable").innerHTML =
        "<thead><tr>" +

        cols.map(c => "<th>" + c + "</th>").join("") +

        "<th>Resultado</th>" +
        "<th>Auditado</th>" +
        "<th>Correcto</th>" +
        "<th>Diferencia</th>" +

        "</tr></thead><tbody>" +

        sample.map((row, i) => {

            const orig = row._original_index || i;
            const res = results[orig] || {};

            return "<tr>" +

            cols.map(c =>
                "<td>" + (row[c] || "") + "</td>"
            ).join("") +

            '<td>' +
            '<select class="res-status" data-idx="' + orig + '">' +

            '<option value="">-</option>' +

            '<option value="Sin excepción"' +
            (res.status === "Sin excepción" ? " selected" : "") +
            '>Sin excepción</option>' +

            '<option value="Excepción"' +
            (res.status === "Excepción" ? " selected" : "") +
            '>Excepción</option>' +

            '<option value="Error monetario"' +
            (res.status === "Error monetario" ? " selected" : "") +
            '>Error monetario</option>' +

            '<option value="Error no monetario"' +
            (res.status === "Error no monetario" ? " selected" : "") +
            '>Error no monetario</option>' +

            '</select>' +
            '</td>' +

            '<td>' +
            '<input class="res-audited" type="number" data-idx="' +
            orig +
            '" value="' +
            (res.audited || "") +
            '">' +
            '</td>' +

            '<td>' +
            '<input class="res-correct" type="number" data-idx="' +
            orig +
            '" value="' +
            (res.correct || "") +
            '">' +
            '</td>' +

            '<td class="res-diff" data-idx="' +
            orig +
            '">' +
            (res.difference || "") +
            '</td>' +

            "</tr>";

        }).join("") +

        "</tbody>";

    document
        .querySelectorAll(".res-audited,.res-correct")
        .forEach(inp => inp.onchange = calcDiff);

    document
        .querySelectorAll(".res-status")
        .forEach(sel => sel.onchange = () => {
            const idx = sel.dataset.idx;
            results[idx] = results[idx] || {};
            results[idx].status = sel.value;
        });
}

function calcDiff(e) {

    const idx = e.target.dataset.idx;

    const aud =
        parseFloat(
            document.querySelector(
                '.res-audited[data-idx="' + idx + '"]'
            ).value
        ) || 0;

    const cor =
        parseFloat(
            document.querySelector(
                '.res-correct[data-idx="' + idx + '"]'
            ).value
        ) || 0;

    const diff = aud - cor;

    document.querySelector(
        '.res-diff[data-idx="' + idx + '"]'
    ).textContent = diff.toFixed(2);

    results[idx] = results[idx] || {};

    results[idx].audited = aud;
    results[idx].correct = cor;
    results[idx].difference = diff;
}

document.getElementById("saveResults").onclick = async () => {

    if (!sample.length) {
        alert("Genere muestra primero");
        return;
    }

    const payload = {
        results: Object.values(results)
    };

    await fetch("/api/results", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    alert("Resultados guardados");

    updateExtrapolation();
};

document.getElementById("refreshExtra").onclick = updateExtrapolation;

async function updateExtrapolation() {

    const r = await fetch("/api/extrapolation");
    const j = await r.json();

    if (j.error) {
        document.getElementById("extraWarning").innerHTML =
            '<div class="warning-box">' +
            j.error +
            '</div>';
        return;
    }

    document.getElementById("extraWarning").innerHTML =
        j.message
            ? '<div class="warning-box">' + j.message + '</div>'
            : "";

    document.getElementById("observed").innerHTML =
        '<div class="obs-item">' +
            '<span class="obs-label">Error 100%</span>' +
            '<span class="obs-value">' +
            formatMoney(j.observed_100 || 0) +
            '</span>' +
        '</div>' +

        '<div class="obs-item">' +
            '<span class="obs-label">Error Residual</span>' +
            '<span class="obs-value">' +
            formatMoney(j.observed_residual || 0) +
            '</span>' +
        '</div>' +

        '<div class="obs-item">' +
            '<span class="obs-label">Identificado</span>' +
            '<span class="obs-value">' +
            formatMoney(j.effectively_identified || 0) +
            '</span>' +
        '</div>';

    document.getElementById("projected").innerHTML =
        '<div class="proj-item">' +
            '<span class="proj-label">Tasa error</span>' +
            '<span class="proj-value">' +
            ((j.error_rate || 0) * 100).toFixed(2) +
            '%</span>' +
        '</div>' +

        '<div class="proj-item">' +
            '<span class="proj-label">Proyectado</span>' +
            '<span class="proj-value">' +
            formatMoney(j.projected_residual || 0) +
            '</span>' +
        '</div>' +

        '<div class="proj-item">' +
            '<span class="proj-label">Total estimado</span>' +
            '<span class="proj-value">' +
            formatMoney(j.total_estimated || 0) +
            '</span>' +
        '</div>';

    document.getElementById("summary").innerHTML =
        '<div class="exec-kpi">' +
            '<div class="exec-kpi-label">Muestra</div>' +
            '<div class="exec-kpi-value">' +
            (j.sample_count || 0).toLocaleString() +
            '</div>' +
        '</div>' +

        '<div class="exec-kpi">' +
            '<div class="exec-kpi-label">Cobertura %</div>' +
            '<div class="exec-kpi-value">' +
            (j.coverage_count || 0).toFixed(2) +
            '%</div>' +
        '</div>' +

        '<div class="exec-kpi">' +
            '<div class="exec-kpi-label">Excepciones</div>' +
            '<div class="exec-kpi-value">' +
            (j.exceptions || 0) +
            '</div>' +
        '</div>' +

        '<div class="exec-kpi">' +
            '<div class="exec-kpi-label">Error observado</div>' +
            '<div class="exec-kpi-value">' +
            formatMoney(
                (j.observed_100 || 0) +
                (j.observed_residual || 0)
            ) +
            '</div>' +
        '</div>' +

        '<div class="exec-kpi">' +
            '<div class="exec-kpi-label">Error proyectado</div>' +
            '<div class="exec-kpi-value">' +
            formatMoney(j.projected_residual || 0) +
            '</div>' +
        '</div>' +

        '<div class="exec-kpi">' +
            '<div class="exec-kpi-label">Error total</div>' +
            '<div class="exec-kpi-value">' +
            formatMoney(j.total_estimated || 0) +
            '</div>' +
        '</div>';

    const mat = j.materiality || 0;
    const checks = j.checks || {};

    document.getElementById("conclusion").innerHTML =
        '<p>Error total: ' +
        formatMoney(j.total_estimated || 0) +
        '. Materialidad: ' +
        formatMoney(mat) +
        '. Estado: ' +
        (checks.total_vs_materiality || "sin umbral") +
        '.</p>';
}
