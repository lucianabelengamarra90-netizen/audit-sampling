// =========================================================
// AUDIT SAMPLING & EXTRAPOLATION - FRONTEND
// =========================================================

let population = null,
    mapping = {},
    sample = [],
    results = {},
    lastSelectionCode = null;


// =========================================================
// NAVEGACIÓN
// =========================================================

document.querySelectorAll(".nav-tab").forEach(t => t.onclick = () => {

    document
        .querySelectorAll(".nav-tab")
        .forEach(x => x.classList.remove("active"));

    document
        .querySelectorAll(".tab-content")
        .forEach(x => x.classList.remove("active"));

    t.classList.add("active");

    document
        .getElementById(t.dataset.tab)
        .classList.add("active");
});


// =========================================================
// ELEMENTOS PRINCIPALES
// =========================================================

const drop = document.getElementById("drop"),
      file = document.getElementById("file"),
      msg = document.getElementById("msg"),
      mappingCard = document.getElementById("mappingCard"),
      mappingDiv = document.getElementById("mapping"),
      analyze = document.getElementById("analyze"),
      preview = document.getElementById("preview"),
      popKpis = document.getElementById("popKpis"),
      quality = document.getElementById("quality");


// =========================================================
// CARGA DE ARCHIVO
// =========================================================

drop.onclick = () => file.click();

file.onchange = upload;


drop.ondragover = e => {

    e.preventDefault();

    drop.style.borderColor =
        "var(--primary)";
};


drop.ondragleave = () => {

    drop.style.borderColor = "";
};


drop.ondrop = e => {

    e.preventDefault();

    drop.style.borderColor = "";

    if (e.dataTransfer.files.length) {

        upload({
            target: {
                files: e.dataTransfer.files
            }
        });
    }
};


async function upload(e) {

    const f = e.target.files[0];

    if (!f) return;


    const fd = new FormData();

    fd.append("file", f);


    msg.innerHTML =
        "Cargando...";


    try {

        const r =
            await fetch(
                "/api/upload",
                {
                    method: "POST",
                    body: fd
                }
            );


        const j =
            await r.json();


        if (j.error) {

            msg.innerHTML =
                j.error;

            return;
        }


        msg.innerHTML =
            "Archivo: " +
            f.name +
            " (" +
            j.rows +
            " filas)";


        document
            .getElementById("fileStatus")
            .textContent =
                f.name +
                " (" +
                j.rows +
                " filas)";


        // Nueva población = limpiar estados anteriores
        mapping = {};
        sample = [];
        results = {};
        lastSelectionCode = null;


        const repeatArea =
            document.getElementById("repeatArea");

        if (repeatArea) {

            repeatArea.style.display =
                "none";
        }


        mappingDiv.innerHTML = "";


        j.columns.forEach(c => {

            mappingDiv.innerHTML +=

                '<div class="form-group">' +

                    '<label>' +
                        c +
                    '</label>' +

                    '<select ' +
                        'class="col-map" ' +
                        'data-col="' +
                        c +
                    '">' +

                        '<option value="">' +
                            'Ignorar' +
                        '</option>' +

                        '<option value="id">' +
                            'ID' +
                        '</option>' +

                        '<option value="amount">' +
                            'Importe' +
                        '</option>' +

                        '<option value="date">' +
                            'Fecha' +
                        '</option>' +

                        '<option value="vendor">' +
                            'Proveedor' +
                        '</option>' +

                        '<option value="company">' +
                            'Sociedad' +
                        '</option>' +

                        '<option value="center">' +
                            'Centro' +
                        '</option>' +

                        '<option value="user">' +
                            'Usuario' +
                        '</option>' +

                        '<option value="doctype">' +
                            'Tipo Doc' +
                        '</option>' +

                        '<option value="account">' +
                            'Cuenta' +
                        '</option>' +

                    '</select>' +

                '</div>';
        });


        mappingCard.style.display =
            "block";


        population = j;


        preview.innerHTML =

            "<thead><tr>" +

                j.columns
                    .map(c =>
                        "<th>" +
                        c +
                        "</th>"
                    )
                    .join("") +

            "</tr></thead>" +

            "<tbody>" +

                j.preview
                    .map(row =>

                        "<tr>" +

                            j.columns
                                .map(c =>

                                    "<td>" +
                                    (
                                        row[c] !== undefined &&
                                        row[c] !== null
                                            ? row[c]
                                            : ""
                                    ) +
                                    "</td>"

                                )
                                .join("") +

                        "</tr>"

                    )
                    .join("") +

            "</tbody>";


    } catch (err) {

        msg.innerHTML =
            "Error: " +
            err.message;
    }
}


// =========================================================
// ANÁLISIS DE POBLACIÓN
// =========================================================

analyze.onclick = async () => {

    mapping = {};


    document
        .querySelectorAll(".col-map")
        .forEach(s => {

            if (s.value) {

                mapping[s.value] =
                    s.dataset.col;
            }
        });


    if (!mapping.id || !mapping.amount) {

        alert(
            "Seleccione ID e Importe"
        );

        return;
    }


    const r =
        await fetch(
            "/api/analyze",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(mapping)
            }
        );


    const j =
        await r.json();


    if (j.error) {

        alert(j.error);

        return;
    }


    document
        .getElementById(
            "populationResults"
        )
        .style.display =
            "block";


    popKpis.innerHTML =

        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Registros' +
            '</div>' +

            '<div class="kpi-value">' +
                j.records.toLocaleString() +
            '</div>' +

        '</div>' +


        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Importe Total' +
            '</div>' +

            '<div class="kpi-value">' +
                formatMoney(
                    j.amount_total || 0
                ) +
            '</div>' +

        '</div>' +


        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Promedio' +
            '</div>' +

            '<div class="kpi-value">' +
                formatMoney(
                    j.mean || 0
                ) +
            '</div>' +

        '</div>' +


        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Mediana' +
            '</div>' +

            '<div class="kpi-value">' +
                formatMoney(
                    j.median || 0
                ) +
            '</div>' +

        '</div>' +


        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Máximo' +
            '</div>' +

            '<div class="kpi-value">' +
                formatMoney(
                    j.max || 0
                ) +
            '</div>' +

        '</div>' +


        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Mínimo' +
            '</div>' +

            '<div class="kpi-value">' +
                formatMoney(
                    j.min || 0
                ) +
            '</div>' +

        '</div>' +


        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Desv. Estándar' +
            '</div>' +

            '<div class="kpi-value">' +
                formatMoney(
                    j.std || 0
                ) +
            '</div>' +

        '</div>' +


        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Duplicados' +
            '</div>' +

            '<div class="kpi-value">' +
                (j.duplicate_rows || 0) +
            '</div>' +

        '</div>';


    quality.innerHTML =

        '<div class="quality-item">' +

            '<span class="quality-label">' +
                'Ceros' +
            '</span>' +

            '<span class="quality-value">' +
                (j.zeros || 0) +
            '</span>' +

        '</div>' +


        '<div class="quality-item">' +

            '<span class="quality-label">' +
                'Negativos' +
            '</span>' +

            '<span class="quality-value">' +
                (j.negatives || 0) +
            '</span>' +

        '</div>' +


        '<div class="quality-item">' +

            '<span class="quality-label">' +
                'Outliers' +
            '</span>' +

            '<span class="quality-value">' +
                (j.outliers || 0) +
            '</span>' +

        '</div>' +


        '<div class="quality-item">' +

            '<span class="quality-label">' +
                'Top 10' +
            '</span>' +

            '<span class="quality-value">' +
                (j.top10_pct || 0)
                    .toFixed(1) +
                '%' +
            '</span>' +

        '</div>' +


        '<div class="quality-item">' +

            '<span class="quality-label">' +
                'Top 20' +
            '</span>' +

            '<span class="quality-value">' +
                (j.top20_pct || 0)
                    .toFixed(1) +
                '%' +
            '</span>' +

        '</div>' +


        '<div class="quality-item">' +

            '<span class="quality-label">' +
                'Top 50' +
            '</span>' +

            '<span class="quality-value">' +
                (j.top50_pct || 0)
                    .toFixed(1) +
                '%' +
            '</span>' +

        '</div>';


    document
        .getElementById("N")
        .value =
            j.records;
};


// =========================================================
// P Y Q
// =========================================================

document
    .getElementById("p")
    .oninput =
        () => {

            const p =
                parseFloat(
                    document
                        .getElementById("p")
                        .value
                ) || 0.5;


            document
                .getElementById("q")
                .value =
                    (1 - p)
                        .toFixed(2);
        };


document
    .getElementById("q")
    .value =
        "0.5";


// =========================================================
// EXPLICACIÓN TAMAÑO MUESTRA
// =========================================================

document
    .getElementById("howSample")
    .onclick =
        () => {

            const N =
                parseInt(
                    document
                        .getElementById("N")
                        .value
                ) || 0;


            const conf =
                document
                    .getElementById("confidence")
                    .value;


            const e =
                parseFloat(
                    document
                        .getElementById("error")
                        .value
                ) || 0.05;


            const p =
                parseFloat(
                    document
                        .getElementById("p")
                        .value
                ) || 0.5;


            const q =
                1 - p;


            const zmap = {

                "90": 1.645,

                "95": 1.96,

                "97": 2.17,

                "99": 2.576
            };


            const z =
                zmap[conf];


            const n =

                (
                    z *
                    z *
                    p *
                    q *
                    N
                )

                /

                (
                    e *
                    e *
                    (N - 1)

                    +

                    z *
                    z *
                    p *
                    q
                );


            document
                .getElementById("modalText")
                .innerHTML =

                    '<p>' +

                        '<strong>Fórmula</strong>: ' +

                        'n = (Z² × p × q × N) / ' +

                        '[e² × (N-1) + Z² × p × q]' +

                    '</p>' +


                    '<p>' +

                        '<strong>Variables</strong>:<br>' +

                        'Z = ' +
                        z +
                        ' (confianza ' +
                        conf +
                        '%)<br>' +

                        'p = ' +
                        p +
                        '<br>' +

                        'q = ' +
                        q.toFixed(2) +
                        '<br>' +

                        'N = ' +
                        N +
                        '<br>' +

                        'e = ' +
                        e +

                    '</p>' +


                    '<p>' +

                        '<strong>Resultado</strong>: n = ' +

                        Math.ceil(n) +

                        ' registros' +

                    '</p>';


            document
                .getElementById("modal")
                .classList
                .add("active");
        };


// =========================================================
// CERRAR MODAL
// =========================================================

const modalClose =
    document.querySelector(
        ".modal-close"
    );


if (modalClose) {

    modalClose.onclick =
        () => {

            document
                .getElementById("modal")
                .classList
                .remove("active");
        };
}


// =========================================================
// RECOMENDACIÓN
// =========================================================

document
    .getElementById("recommend")
    .onclick =
        async () => {


            if (!mapping.amount) {

                alert(
                    "Analice la población primero"
                );

                return;
            }


            const r =
                await fetch(
                    "/api/recommend",
                    {
                        method: "POST",

                        headers: {

                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({

                                amount_col:
                                    mapping.amount,

                                significant_threshold:
                                    parseFloat(
                                        document
                                            .getElementById(
                                                "threshold"
                                            )
                                            .value
                                    ) || 0

                            })
                    }
                );


            const j =
                await r.json();


            if (j.error) {

                alert(j.error);

                return;
            }


            const box =
                document
                    .getElementById(
                        "recommendationBox"
                    );


            box.style.display =
                "block";


            box.innerHTML =

                '<p>' +

                    '<strong>' +
                        'Recomendación' +
                    '</strong>: ' +

                    j.recommendation +

                '</p>' +


                '<p>' +

                    '<strong>' +
                        'Razones' +
                    '</strong>:' +

                '</p>' +


                '<ul>' +

                    j.reasons
                        .map(
                            x =>
                                "<li>" +
                                x +
                                "</li>"
                        )
                        .join("") +

                '</ul>';
        };


// =========================================================
// GENERACIÓN Y REPRODUCCIÓN DE MUESTRA
// =========================================================

async function generateSample(
    selectionCode = null,
    isRepeat = false
) {

    if (
        !mapping.id ||
        !mapping.amount
    ) {

        alert(
            "Analice la población primero"
        );

        return;
    }


    const N =
        parseInt(
            document
                .getElementById("N")
                .value
        ) || 0;


    const conf =
        document
            .getElementById("confidence")
            .value;


    const e =
        parseFloat(
            document
                .getElementById("error")
                .value
        ) || 0.05;


    const p =
        parseFloat(
            document
                .getElementById("p")
                .value
        ) || 0.5;


    const r =
        await fetch(
            "/api/calculate-sample",
            {
                method: "POST",

                headers: {

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        N,
                        confidence: conf,
                        error: e,
                        p
                    })
            }
        );


    const j =
        await r.json();


    if (j.error) {

        alert(j.error);

        return;
    }


    document
        .getElementById("nResult")
        .textContent =
            j.n;


    const method =
        document
            .querySelector(
                'input[name="method"]:checked'
            )
            .value;


    const methodLabels = {

        random:
            "Aleatorio simple",

        systematic:
            "Sistemático",

        stratified:
            "Estratificado",

        mus:
            "MUS / PPS",

        topn:
            "Top N"
    };


    const payload = {

        id_col:
            mapping.id,

        amount_col:
            mapping.amount,

        method,

        n:
            j.n,

        confidence:
            conf,

        error:
            e,

        p,


        // Muestra nueva:
        // genera un código nuevo.
        // Repetición:
        // utiliza exactamente el mismo.

        seed:
            selectionCode !== null

                ? selectionCode

                : Date.now(),


        include_materiality:
            document
                .getElementById("incMat")
                .checked,


        include_outliers:
            document
                .getElementById("incOut")
                .checked,


        significant_threshold:
            parseFloat(
                document
                    .getElementById("threshold")
                    .value
            ) || 0,


        materiality:
            parseFloat(
                document
                    .getElementById("materiality")
                    .value
            ) || 0,


        tolerable_error:
            parseFloat(
                document
                    .getElementById("tolerable")
                    .value
            ) || 0
    };


    const s =
        await fetch(
            "/api/generate-sample",
            {
                method: "POST",

                headers: {

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(payload)
            }
        );


    const sj =
        await s.json();


    if (sj.error) {

        alert(sj.error);

        return;
    }


    sample =
        sj.preview || [];


    lastSelectionCode =
        sj.seed;


    if (!isRepeat) {

        results = {};
    }


    document
        .getElementById(
            "sampleSummary"
        )
        .innerHTML =


            '<div class="summary-item">' +

                '<span class="summary-label">' +
                    'Tamaño' +
                '</span>' +

                '<span class="summary-value">' +
                    (sj.rows || 0) +
                '</span>' +

            '</div>' +


            '<div class="summary-item">' +

                '<span class="summary-label">' +
                    'Cobertura registros' +
                '</span>' +

                '<span class="summary-value">' +

                    (
                        sj.coverage_count ||
                        0
                    ).toFixed(2) +

                    '%' +

                '</span>' +

            '</div>' +


            '<div class="summary-item">' +

                '<span class="summary-label">' +
                    'Cobertura monetaria' +
                '</span>' +

                '<span class="summary-value">' +

                    (
                        sj.coverage_amount ||
                        0
                    ).toFixed(2) +

                    '%' +

                '</span>' +

            '</div>' +


            '<div class="summary-item code-pill">' +

                '<span class="summary-label">' +
                    'Código de selección' +
                '</span>' +

                '<span class="summary-value">' +
                    lastSelectionCode +
                '</span>' +

            '</div>' +


            '<div class="summary-item">' +

                '<span class="summary-label">' +
                    'Método' +
                '</span>' +

                '<span class="summary-value">' +

                    (
                        methodLabels[method] ||
                        method
                    ) +

                '</span>' +

            '</div>';


    const repeatArea =
        document
            .getElementById(
                "repeatArea"
            );


    if (repeatArea) {

        repeatArea.style.display =
            "flex";
    }


    renderSampleTable();

    renderResultsTable();


    if (isRepeat) {

        alert(

            "Selección reproducida correctamente.\n" +

            "Código de selección: " +

            lastSelectionCode
        );

    } else {

        alert(

            "Muestra: " +

            sj.rows +

            " registros"
        );
    }
}


// =========================================================
// GENERAR NUEVA MUESTRA
// =========================================================

document
    .getElementById("generate")
    .onclick =
        async () => {

            await generateSample(
                null,
                false
            );
        };


// =========================================================
// REPETIR SELECCIÓN
// =========================================================

const repeatSelectionButton =
    document
        .getElementById(
            "repeatSelection"
        );


if (repeatSelectionButton) {

    repeatSelectionButton.onclick =
        async () => {


            if (!lastSelectionCode) {

                alert(
                    "Primero genere una muestra."
                );

                return;
            }


            await generateSample(
                lastSelectionCode,
                true
            );
        };
}


// =========================================================
// TABLA DE MUESTRA
// =========================================================

function getVisibleSampleColumns() {

    if (!sample.length) {

        return [];
    }


    return Object
        .keys(sample[0])
        .filter(
            c =>
                !c.startsWith("_") &&
                c !== "Tipo_Seleccion"
        );
}


function renderSampleTable() {

    if (!sample.length) {

        return;
    }


    const cols =
        getVisibleSampleColumns();


    document
        .getElementById("sampleTable")
        .innerHTML =

            "<thead><tr>" +

                cols
                    .map(
                        c =>
                            "<th>" +
                            c +
                            "</th>"
                    )
                    .join("") +

            "</tr></thead>" +


            "<tbody>" +

                sample
                    .map(row =>

                        "<tr>" +

                            cols
                                .map(c =>

                                    "<td>" +

                                    displayValue(
                                        row[c]
                                    ) +

                                    "</td>"

                                )
                                .join("") +

                        "</tr>"

                    )
                    .join("") +

            "</tbody>";
}


// =========================================================
// RESULTADOS DE AUDITORÍA
// =========================================================

function getOriginalIndex(row, fallbackIndex) {

    if (
        row._original_index !== undefined &&
        row._original_index !== null &&
        row._original_index !== ""
    ) {

        return row._original_index;
    }


    return fallbackIndex;
}


function getRegisteredAmount(row) {

    if (
        mapping.amount &&
        row[mapping.amount] !== undefined &&
        row[mapping.amount] !== null &&
        row[mapping.amount] !== ""
    ) {

        return row[mapping.amount];
    }


    return "";
}


function renderResultsTable() {

    if (!sample.length) {

        document
            .getElementById("resultsTable")
            .innerHTML = "";

        updateResultsDashboard();

        return;
    }


    const cols =
        getVisibleSampleColumns();


    document
        .getElementById(
            "resultsTable"
        )
        .innerHTML =


        "<thead>" +

            "<tr>" +


                cols
                    .map(
                        c =>
                            "<th>" +
                            c +
                            "</th>"
                    )
                    .join("") +


                '<th class="audit-col">' +
                    'Resultado de revisión' +
                '</th>' +


                '<th class="audit-col">' +
                    'Importe registrado' +
                '</th>' +


                '<th class="audit-col">' +
                    'Importe validado' +
                '</th>' +


                '<th class="audit-col">' +
                    'Diferencia' +
                '</th>' +


                '<th class="audit-col">' +
                    'Tipo de excepción' +
                '</th>' +


                '<th class="audit-col">' +
                    'Comentario del auditor' +
                '</th>' +


                '<th class="audit-col">' +
                    'Referencia de evidencia' +
                '</th>' +


            "</tr>" +

        "</thead>" +


        "<tbody>" +


            sample
                .map(
                    (row, i) => {


                        const orig =
                            getOriginalIndex(
                                row,
                                i
                            );


                        results[orig] =
                            results[orig] || {};


                        const res =
                            results[orig];


                        // El importe registrado se completa
                        // automáticamente con el valor de la población.

                        const defaultRegistered =
                            getRegisteredAmount(row);


                        const registeredValue =

                            res.registered !== undefined &&
                            res.registered !== ""

                                ? res.registered

                                : (
                                    res.audited !== undefined &&
                                    res.audited !== ""

                                        ? res.audited

                                        : defaultRegistered
                                );


                        if (
                            res.registered === undefined ||
                            res.registered === ""
                        ) {

                            res.registered =
                                registeredValue;
                        }


                        const validatedValue =

                            res.validated !== undefined

                                ? res.validated

                                : (
                                    res.correct !== undefined

                                        ? res.correct

                                        : ""
                                );


                        return "<tr>" +


                            cols
                                .map(
                                    c =>
                                        "<td>" +
                                        displayValue(
                                            row[c]
                                        ) +
                                        "</td>"
                                )
                                .join("") +


                            // RESULTADO DE REVISIÓN

                            '<td class="audit-col">' +

                                '<select ' +
                                    'class="res-status form-input" ' +
                                    'data-idx="' +
                                    orig +
                                '">' +


                                    optionSelected(
                                        "",
                                        "Pendiente",
                                        res.status
                                    ) +


                                    optionSelected(
                                        "Sin excepción",
                                        "Sin excepción",
                                        res.status
                                    ) +


                                    optionSelected(
                                        "Excepción monetaria",
                                        "Excepción monetaria",
                                        res.status
                                    ) +


                                    optionSelected(
                                        "Excepción no monetaria",
                                        "Excepción no monetaria",
                                        res.status
                                    ) +


                                '</select>' +

                            '</td>' +


                            // IMPORTE REGISTRADO

                            '<td class="audit-col">' +

                                '<input ' +
                                    'class="res-registered form-input" ' +
                                    'type="number" ' +
                                    'step="any" ' +
                                    'data-idx="' +
                                    orig +
                                    '" ' +
                                    'value="' +
                                    safeInputValue(
                                        registeredValue
                                    ) +
                                '">' +

                            '</td>' +


                            // IMPORTE VALIDADO

                            '<td class="audit-col">' +

                                '<input ' +
                                    'class="res-validated form-input" ' +
                                    'type="number" ' +
                                    'step="any" ' +
                                    'data-idx="' +
                                    orig +
                                    '" ' +
                                    'value="' +
                                    safeInputValue(
                                        validatedValue
                                    ) +
                                '">' +

                            '</td>' +


                            // DIFERENCIA

                            '<td ' +
                                'class="audit-col res-diff" ' +
                                'data-idx="' +
                                orig +
                            '">' +

                                formatDifference(
                                    res.difference
                                ) +

                            '</td>' +


                            // TIPO DE EXCEPCIÓN

                            '<td class="audit-col">' +

                                '<select ' +
                                    'class="res-exception-type form-input" ' +
                                    'data-idx="' +
                                    orig +
                                '">' +


                                    optionSelected(
                                        "",
                                        "-",
                                        res.exception_type
                                    ) +


                                    optionSelected(
                                        "Monetaria",
                                        "Monetaria",
                                        res.exception_type
                                    ) +


                                    optionSelected(
                                        "Documental",
                                        "Documental",
                                        res.exception_type
                                    ) +


                                    optionSelected(
                                        "Cumplimiento",
                                        "Cumplimiento",
                                        res.exception_type
                                    ) +


                                    optionSelected(
                                        "Duplicado",
                                        "Duplicado",
                                        res.exception_type
                                    ) +


                                    optionSelected(
                                        "Imputación / registración",
                                        "Imputación / registración",
                                        res.exception_type
                                    ) +


                                    optionSelected(
                                        "Otro",
                                        "Otro",
                                        res.exception_type
                                    ) +


                                '</select>' +

                            '</td>' +


                            // COMENTARIO

                            '<td class="audit-col">' +

                                '<input ' +
                                    'class="res-comment form-input" ' +
                                    'type="text" ' +
                                    'data-idx="' +
                                    orig +
                                    '" ' +
                                    'placeholder="Describa brevemente la revisión" ' +
                                    'value="' +
                                    escapeAttribute(
                                        res.comment || ""
                                    ) +
                                '">' +

                            '</td>' +


                            // EVIDENCIA

                            '<td class="audit-col">' +

                                '<input ' +
                                    'class="res-evidence form-input" ' +
                                    'type="text" ' +
                                    'data-idx="' +
                                    orig +
                                    '" ' +
                                    'placeholder="Factura, OC, SAP, ticket..." ' +
                                    'value="' +
                                    escapeAttribute(
                                        res.evidence || ""
                                    ) +
                                '">' +

                            '</td>' +


                        "</tr>";
                    }
                )
                .join("") +


        "</tbody>";


    bindResultEvents();

    updateResultsDashboard();
}


// =========================================================
// EVENTOS DE RESULTADOS
// =========================================================

function bindResultEvents() {


    document
        .querySelectorAll(
            ".res-registered, .res-validated"
        )
        .forEach(
            inp => {

                inp.oninput =
                    calcDiff;
            }
        );


    document
        .querySelectorAll(
            ".res-status"
        )
        .forEach(
            sel => {

                sel.onchange =
                    handleStatusChange;
            }
        );


    document
        .querySelectorAll(
            ".res-exception-type"
        )
        .forEach(
            sel => {

                sel.onchange =
                    () => {

                        const idx =
                            sel.dataset.idx;


                        results[idx] =
                            results[idx] || {};


                        results[idx]
                            .exception_type =
                                sel.value;


                        updateResultsDashboard();
                    };
            }
        );


    document
        .querySelectorAll(
            ".res-comment"
        )
        .forEach(
            inp => {

                inp.oninput =
                    () => {

                        const idx =
                            inp.dataset.idx;


                        results[idx] =
                            results[idx] || {};


                        results[idx].comment =
                            inp.value;
                    };
            }
        );


    document
        .querySelectorAll(
            ".res-evidence"
        )
        .forEach(
            inp => {

                inp.oninput =
                    () => {

                        const idx =
                            inp.dataset.idx;


                        results[idx] =
                            results[idx] || {};


                        results[idx].evidence =
                            inp.value;
                    };
            }
        );
}


// =========================================================
// CAMBIO DE ESTADO
// =========================================================

function handleStatusChange(e) {

    const sel =
        e.target;


    const idx =
        sel.dataset.idx;


    results[idx] =
        results[idx] || {};


    results[idx].status =
        sel.value;


    // Si el auditor marca "Sin excepción",
    // la herramienta iguala el importe validado
    // al registrado automáticamente.

    if (
        sel.value ===
        "Sin excepción"
    ) {

        const registeredInput =
            document.querySelector(
                '.res-registered[data-idx="' +
                idx +
                '"]'
            );


        const validatedInput =
            document.querySelector(
                '.res-validated[data-idx="' +
                idx +
                '"]'
            );


        if (
            registeredInput &&
            validatedInput &&
            registeredInput.value !== ""
        ) {

            validatedInput.value =
                registeredInput.value;


            results[idx].registered =
                parseNumberOrBlank(
                    registeredInput.value
                );


            results[idx].validated =
                parseNumberOrBlank(
                    registeredInput.value
                );


            results[idx].difference =
                0;


            document.querySelector(
                '.res-diff[data-idx="' +
                idx +
                '"]'
            ).textContent =
                formatDifference(0);
        }
    }


    updateResultsDashboard();
}


// =========================================================
// DIFERENCIA MONETARIA
// =========================================================

function calcDiff(e) {

    const idx =
        e.target.dataset.idx;


    const registeredInput =
        document.querySelector(
            '.res-registered[data-idx="' +
            idx +
            '"]'
        );


    const validatedInput =
        document.querySelector(
            '.res-validated[data-idx="' +
            idx +
            '"]'
        );


    if (
        !registeredInput ||
        !validatedInput
    ) {

        return;
    }


    const registered =
        parseNumberOrBlank(
            registeredInput.value
        );


    const validated =
        parseNumberOrBlank(
            validatedInput.value
        );


    results[idx] =
        results[idx] || {};


    results[idx].registered =
        registered;


    results[idx].validated =
        validated;


    if (
        registered === "" ||
        validated === ""
    ) {

        results[idx].difference =
            "";


        document.querySelector(
            '.res-diff[data-idx="' +
            idx +
            '"]'
        ).textContent =
            "";


        updateResultsDashboard();

        return;
    }


    const diff =
        Number(registered) -
        Number(validated);


    results[idx].difference =
        diff;


    document.querySelector(
        '.res-diff[data-idx="' +
        idx +
        '"]'
    ).textContent =
        formatDifference(diff);


    updateResultsDashboard();
}


// =========================================================
// DASHBOARD DE RESULTADOS
// =========================================================

function updateResultsDashboard() {

    const dash =
        document.getElementById(
            "resultsDash"
        );


    if (!dash) {

        return;
    }


    if (!sample.length) {

        dash.innerHTML =
            "";

        return;
    }


    let reviewed = 0;

    let exceptions = 0;

    let pending = 0;

    let observedError = 0;


    sample.forEach(
        (row, i) => {

            const idx =
                getOriginalIndex(
                    row,
                    i
                );


            const res =
                results[idx] || {};


            if (
                !res.status
            ) {

                pending++;

                return;
            }


            reviewed++;


            if (
                res.status ===
                    "Excepción monetaria" ||

                res.status ===
                    "Excepción no monetaria"
            ) {

                exceptions++;
            }


            if (
                res.difference !== "" &&
                res.difference !== undefined &&
                res.difference !== null
            ) {

                observedError +=
                    Math.abs(
                        Number(
                            res.difference
                        ) || 0
                    );
            }
        }
    );


    dash.innerHTML =


        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Total muestra' +
            '</div>' +

            '<div class="kpi-value">' +
                sample.length +
            '</div>' +

        '</div>' +


        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Revisados' +
            '</div>' +

            '<div class="kpi-value">' +
                reviewed +
            '</div>' +

        '</div>' +


        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Pendientes' +
            '</div>' +

            '<div class="kpi-value">' +
                pending +
            '</div>' +

        '</div>' +


        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Excepciones' +
            '</div>' +

            '<div class="kpi-value">' +
                exceptions +
            '</div>' +

        '</div>' +


        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                'Error monetario observado' +
            '</div>' +

            '<div class="kpi-value">' +
                formatMoney(
                    observedError
                ) +
            '</div>' +

        '</div>';
}


// =========================================================
// GUARDAR RESULTADOS
// =========================================================

document
    .getElementById("saveResults")
    .onclick =
        async () => {


            if (!sample.length) {

                alert(
                    "Genere muestra primero"
                );

                return;
            }


            // Antes de guardar, levantamos TODOS
            // los campos visibles de la tabla.

            collectVisibleResults();


            const payloadResults =

                sample.map(
                    (row, i) => {


                        const idx =
                            getOriginalIndex(
                                row,
                                i
                            );


                        const res =
                            results[idx] || {};


                        return {

                            _original_index:
                                Number(idx),

                            status:
                                res.status || "",

                            registered:
                                res.registered !== undefined
                                    ? res.registered
                                    : "",

                            validated:
                                res.validated !== undefined
                                    ? res.validated
                                    : "",

                            // Compatibilidad con backend anterior

                            audited:
                                res.registered !== undefined
                                    ? res.registered
                                    : "",

                            correct:
                                res.validated !== undefined
                                    ? res.validated
                                    : "",

                            difference:
                                Number(
                                    res.difference
                                ) || 0,

                            exception_type:
                                res.exception_type || "",

                            comment:
                                res.comment || "",

                            evidence:
                                res.evidence || ""
                        };
                    }
                );


            const r =
                await fetch(
                    "/api/results",
                    {
                        method: "POST",

                        headers: {

                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({

                                results:
                                    payloadResults
                            })
                    }
                );


            const j =
                await r.json();


            if (!r.ok || j.error) {

                alert(
                    j.error ||
                    "No se pudieron guardar los resultados"
                );

                return;
            }


            alert(
                "Resultados guardados"
            );


            updateResultsDashboard();

            updateExtrapolation();
        };


// =========================================================
// RECOLECTAR CAMPOS VISIBLES
// =========================================================

function collectVisibleResults() {

    document
        .querySelectorAll(
            ".res-status"
        )
        .forEach(
            el => {

                const idx =
                    el.dataset.idx;


                results[idx] =
                    results[idx] || {};


                results[idx].status =
                    el.value;
            }
        );


    document
        .querySelectorAll(
            ".res-registered"
        )
        .forEach(
            el => {

                const idx =
                    el.dataset.idx;


                results[idx] =
                    results[idx] || {};


                results[idx].registered =
                    parseNumberOrBlank(
                        el.value
                    );
            }
        );


    document
        .querySelectorAll(
            ".res-validated"
        )
        .forEach(
            el => {

                const idx =
                    el.dataset.idx;


                results[idx] =
                    results[idx] || {};


                results[idx].validated =
                    parseNumberOrBlank(
                        el.value
                    );
            }
        );


    document
        .querySelectorAll(
            ".res-exception-type"
        )
        .forEach(
            el => {

                const idx =
                    el.dataset.idx;


                results[idx] =
                    results[idx] || {};


                results[idx]
                    .exception_type =
                        el.value;
            }
        );


    document
        .querySelectorAll(
            ".res-comment"
        )
        .forEach(
            el => {

                const idx =
                    el.dataset.idx;


                results[idx] =
                    results[idx] || {};


                results[idx].comment =
                    el.value;
            }
        );


    document
        .querySelectorAll(
            ".res-evidence"
        )
        .forEach(
            el => {

                const idx =
                    el.dataset.idx;


                results[idx] =
                    results[idx] || {};


                results[idx].evidence =
                    el.value;
            }
        );
}


// =========================================================
// DESCARGAR HOJA DE REVISIÓN
// =========================================================

const downloadReview =
    document.getElementById(
        "downloadReview"
    );


if (downloadReview) {

    downloadReview.onclick =
        () => {


            if (!sample.length) {

                alert(
                    "Genere primero una muestra."
                );

                return;
            }


            window.location.href =
                "/api/review-template";
        };
}


// =========================================================
// IMPORTAR RESULTADOS DESDE EXCEL
// =========================================================

const importReview =
    document.getElementById(
        "importReview"
    );


const reviewFile =
    document.getElementById(
        "reviewFile"
    );


if (
    importReview &&
    reviewFile
) {

    importReview.onclick =
        () => {


            if (!sample.length) {

                alert(
                    "Genere primero una muestra."
                );

                return;
            }


            reviewFile.click();
        };


    reviewFile.onchange =
        async e => {


            const f =
                e.target.files[0];


            if (!f) {

                return;
            }


            const fd =
                new FormData();


            fd.append(
                "file",
                f
            );


            try {

                const r =
                    await fetch(
                        "/api/import-results",
                        {
                            method: "POST",
                            body: fd
                        }
                    );


                const j =
                    await r.json();


                if (
                    !r.ok ||
                    j.error
                ) {

                    alert(
                        j.error ||
                        "No se pudo importar el archivo"
                    );

                    return;
                }


                if (
                    Array.isArray(
                        j.results
                    )
                ) {

                    j.results.forEach(
                        item => {


                            const idx =
                                String(
                                    item._original_index
                                );


                            results[idx] = {

                                status:
                                    item.status || "",

                                registered:
                                    item.registered !== undefined
                                        ? item.registered
                                        : "",

                                validated:
                                    item.validated !== undefined
                                        ? item.validated
                                        : "",

                                difference:
                                    item.difference !== undefined
                                        ? item.difference
                                        : "",

                                exception_type:
                                    item.exception_type || "",

                                comment:
                                    item.comment || "",

                                evidence:
                                    item.evidence || ""
                            };
                        }
                    );
                }


                renderResultsTable();


                let message =

                    "Se importaron " +

                    (
                        j.imported ||
                        0
                    ) +

                    " resultados.";


                if (
                    j.missing_from_file
                ) {

                    message +=

                        "\n" +

                        j.missing_from_file +

                        " registros de la muestra no estaban en el Excel.";
                }


                alert(message);


            } catch (err) {

                alert(

                    "Error al importar: " +

                    err.message
                );
            }


            reviewFile.value =
                "";
        };
}


// =========================================================
// EXTRAPOLACIÓN
// =========================================================

document
    .getElementById("refreshExtra")
    .onclick =
        updateExtrapolation;


async function updateExtrapolation() {

    const r =
        await fetch(
            "/api/extrapolation"
        );


    const j =
        await r.json();


    if (j.error) {

        document
            .getElementById(
                "extraWarning"
            )
            .innerHTML =

                '<div class="warning-box">' +

                    j.error +

                '</div>';


        return;
    }


    document
        .getElementById(
            "extraWarning"
        )
        .innerHTML =

            j.message

                ? (
                    '<div class="warning-box">' +

                        j.message +

                    '</div>'
                )

                : "";


    document
        .getElementById(
            "observed"
        )
        .innerHTML =


            '<div class="obs-item">' +

                '<span class="obs-label">' +
                    'Error 100%' +
                '</span>' +

                '<span class="obs-value">' +

                    formatMoney(
                        j.observed_100 ||
                        0
                    ) +

                '</span>' +

            '</div>' +


            '<div class="obs-item">' +

                '<span class="obs-label">' +
                    'Error muestra probabilística' +
                '</span>' +

                '<span class="obs-value">' +

                    formatMoney(
                        j.observed_residual ||
                        0
                    ) +

                '</span>' +

            '</div>' +


            '<div class="obs-item">' +

                '<span class="obs-label">' +
                    'Error identificado' +
                '</span>' +

                '<span class="obs-value">' +

                    formatMoney(
                        j.effectively_identified ||
                        0
                    ) +

                '</span>' +

            '</div>';


    document
        .getElementById(
            "projected"
        )
        .innerHTML =


            '<div class="proj-item">' +

                '<span class="proj-label">' +
                    'Tasa de error' +
                '</span>' +

                '<span class="proj-value">' +

                    (
                        (
                            j.error_rate ||
                            0
                        ) *
                        100
                    )
                    .toFixed(2) +

                    '%' +

                '</span>' +

            '</div>' +


            '<div class="proj-item">' +

                '<span class="proj-label">' +
                    'Error proyectado' +
                '</span>' +

                '<span class="proj-value">' +

                    formatMoney(
                        j.projected_residual ||
                        0
                    ) +

                '</span>' +

            '</div>' +


            '<div class="proj-item">' +

                '<span class="proj-label">' +
                    'Total estimado' +
                '</span>' +

                '<span class="proj-value">' +

                    formatMoney(
                        j.total_estimated ||
                        0
                    ) +

                '</span>' +

            '</div>';


    document
        .getElementById(
            "summary"
        )
        .innerHTML =


            '<div class="exec-kpi">' +

                '<div class="exec-kpi-label">' +
                    'Muestra' +
                '</div>' +

                '<div class="exec-kpi-value">' +

                    (
                        j.sample_count ||
                        0
                    ).toLocaleString() +

                '</div>' +

            '</div>' +


            '<div class="exec-kpi">' +

                '<div class="exec-kpi-label">' +
                    'Cobertura registros' +
                '</div>' +

                '<div class="exec-kpi-value">' +

                    (
                        j.coverage_count ||
                        0
                    ).toFixed(2) +

                    '%' +

                '</div>' +

            '</div>' +


            '<div class="exec-kpi">' +

                '<div class="exec-kpi-label">' +
                    'Excepciones' +
                '</div>' +

                '<div class="exec-kpi-value">' +

                    (
                        j.exceptions ||
                        0
                    ) +

                '</div>' +

            '</div>' +


            '<div class="exec-kpi">' +

                '<div class="exec-kpi-label">' +
                    'Error observado' +
                '</div>' +

                '<div class="exec-kpi-value">' +

                    formatMoney(

                        (
                            j.observed_100 ||
                            0
                        )

                        +

                        (
                            j.observed_residual ||
                            0
                        )

                    ) +

                '</div>' +

            '</div>' +


            '<div class="exec-kpi">' +

                '<div class="exec-kpi-label">' +
                    'Error proyectado' +
                '</div>' +

                '<div class="exec-kpi-value">' +

                    formatMoney(
                        j.projected_residual ||
                        0
                    ) +

                '</div>' +

            '</div>' +


            '<div class="exec-kpi">' +

                '<div class="exec-kpi-label">' +
                    'Error total' +
                '</div>' +

                '<div class="exec-kpi-value">' +

                    formatMoney(
                        j.total_estimated ||
                        0
                    ) +

                '</div>' +

            '</div>';


    const mat =
        j.materiality ||
        0;


    const checks =
        j.checks ||
        {};


    document
        .getElementById(
            "conclusion"
        )
        .innerHTML =


            '<p>' +

                'Error total estimado: ' +

                '<strong>' +

                    formatMoney(
                        j.total_estimated ||
                        0
                    ) +

                '</strong>' +

                '. Materialidad: ' +

                '<strong>' +

                    formatMoney(mat) +

                '</strong>' +

                '. Estado: ' +

                '<strong>' +

                    (
                        checks
                            .total_vs_materiality ||

                        "sin umbral"
                    ) +

                '</strong>.' +

            '</p>';
}


// =========================================================
// FUNCIONES AUXILIARES
// =========================================================

function optionSelected(
    value,
    label,
    selectedValue
) {

    return (
        '<option value="' +
        escapeAttribute(value) +
        '"' +

        (
            value === selectedValue
                ? " selected"
                : ""
        ) +

        '>' +

        label +

        '</option>'
    );
}


function parseNumberOrBlank(value) {

    if (
        value === "" ||
        value === null ||
        value === undefined
    ) {

        return "";
    }


    const number =
        Number(value);


    return Number.isFinite(number)

        ? number

        : "";
}


function formatDifference(value) {

    if (
        value === "" ||
        value === undefined ||
        value === null
    ) {

        return "";
    }


    return formatMoney(value);
}


function safeInputValue(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";
    }


    const n =
        Number(value);


    if (
        Number.isFinite(n)
    ) {

        return n;
    }


    return "";
}


function displayValue(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";
    }


    return value;
}


function escapeAttribute(value) {

    return String(
        value === undefined ||
        value === null
            ? ""
            : value
    )
    .replaceAll(
        "&",
        "&amp;"
    )
    .replaceAll(
        '"',
        "&quot;"
    )
    .replaceAll(
        "<",
        "&lt;"
    )
    .replaceAll(
        ">",
        "&gt;"
    );
}


// =========================================================
// FORMATO MONETARIO
// =========================================================

function formatMoney(value) {

    const number =
        Number(value) ||
        0;


    return new Intl.NumberFormat(
        "es-AR",
        {
            style:
                "currency",

            currency:
                "ARS",

            minimumFractionDigits:
                0,

            maximumFractionDigits:
                2
        }
    )
    .format(number);
}
