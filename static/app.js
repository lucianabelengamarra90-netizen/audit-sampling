// =========================================================
// AUDIT SAMPLING & EXTRAPOLATION - FRONTEND
// =========================================================

let population = null;
let mapping = {};
let sample = [];
let results = {};
let lastSelectionCode = null;
let currentWork = null;
// =========================================================
// LECTURA SEGURA DE RESPUESTAS JSON
// =========================================================

async function readJsonResponse(response) {

    const text = await response.text();

    if (!text) {
        throw new Error(
            "El servidor cerró la conexión sin devolver respuesta."
        );
    }

    try {
        return JSON.parse(text);
    } catch (error) {

        console.error(
            "Respuesta recibida del servidor:",
            text
        );

        throw new Error(
            "Error del servidor (HTTP " +
            response.status +
            "). Revisar los logs de Render."
        );
    }
}

// =========================================================
// NAVEGACIÓN
// =========================================================

document.querySelectorAll(".nav-tab").forEach(tab => {

    tab.onclick = () => {

        document
            .querySelectorAll(".nav-tab")
            .forEach(x => x.classList.remove("active"));

        document
            .querySelectorAll(".tab-content")
            .forEach(x => x.classList.remove("active"));

        tab.classList.add("active");

        document
            .getElementById(tab.dataset.tab)
            .classList.add("active");
    };
});


// =========================================================
// ELEMENTOS PRINCIPALES
// =========================================================

const drop = document.getElementById("drop");
const file = document.getElementById("file");
const msg = document.getElementById("msg");
const mappingCard = document.getElementById("mappingCard");
const mappingDiv = document.getElementById("mapping");
const analyze = document.getElementById("analyze");
const preview = document.getElementById("preview");
const popKpis = document.getElementById("popKpis");
const quality = document.getElementById("quality");


// =========================================================
// TRACKING DE TRABAJOS
// =========================================================

async function initializeWorkTracking() {

    await checkDatabaseStatus();

    try {

        const r = await fetch("/api/work/current");
        const state = await r.json();

        if (!r.ok || state.error) {
            showWorkMessage(
                state.error || "No se pudo recuperar el trabajo actual.",
                "error"
            );
            return;
        }

        renderWorkState(state);

        if (
            state.population ||
            (state.sample && state.sample.rows)
        ) {
            await restoreProjectState(state);
        }

    } catch (err) {

        showWorkMessage(
            "No se pudo consultar el estado del trabajo: " + err.message,
            "error"
        );
    }
}


async function checkDatabaseStatus() {

    const badge = document.getElementById("dbStatus");

    if (!badge) return;

    try {

        const r = await fetch("/api/work/db-status");
        const j = await r.json();

        if (j.available) {

            badge.textContent = "BASE DISPONIBLE";

            badge.style.background = "#e9f7ef";
            badge.style.color = "#207544";

        } else {

            badge.textContent = "BASE NO DISPONIBLE";

            badge.style.background = "#fdecec";
            badge.style.color = "#a73030";

            if (j.message) {
                showWorkMessage(j.message, "error");
            }
        }

    } catch (err) {

        badge.textContent = "BASE NO DISPONIBLE";

        badge.style.background = "#fdecec";
        badge.style.color = "#a73030";
    }
}


function renderWorkState(state) {

    const work =
        state && state.work
            ? state.work
            : {};

    currentWork = work;

    const noActive =
        document.getElementById("workNoActive");

    const active =
        document.getElementById("workActive");


    if (work.work_code) {

        if (noActive) {
            noActive.style.display = "none";
        }

        if (active) {
            active.style.display = "block";
        }

        document.getElementById("currentWorkCode").textContent =
            work.work_code || "-";

        document.getElementById("currentWorkName").textContent =
            work.name || "-";

        document.getElementById("currentWorkResponsible").textContent =
            work.responsible || "-";

        document.getElementById("currentWorkStatus").textContent =
            work.status || "En curso";

    } else {

        if (noActive) {
            noActive.style.display = "block";
        }

        if (active) {
            active.style.display = "none";
        }
    }
}


function showWorkMessage(text, type = "info") {

    const box =
        document.getElementById("workMessage");

    if (!box) return;

    if (!text) {
        box.innerHTML = "";
        return;
    }

    let bg = "#f7f7f7";
    let border = "#dddddd";

    if (type === "success") {
        bg = "#edf8f0";
        border = "#b8dfc3";
    }

    if (type === "warning") {
        bg = "#fff8d9";
        border = "#ead992";
    }

    if (type === "error") {
        bg = "#fdecec";
        border = "#edbaba";
    }

    box.innerHTML =
        '<div style="' +
            'padding:14px 16px;' +
            'border-radius:9px;' +
            'background:' + bg + ';' +
            'border:1px solid ' + border + ';' +
            'font-size:13px;' +
            'line-height:1.45;' +
        '">' +
            text +
        '</div>';
}


// =========================================================
// CREAR TRABAJO
// =========================================================

const createWorkButton =
    document.getElementById("createWork");


if (createWorkButton) {

    createWorkButton.onclick = async () => {

        const name =
            document
                .getElementById("newWorkName")
                .value
                .trim();

        const responsible =
            document
                .getElementById("newWorkResponsible")
                .value
                .trim();


        if (!name) {

            alert(
                "Ingrese un nombre para el trabajo."
            );

            return;
        }


        if (!responsible) {

            alert(
                "Ingrese el responsable del trabajo."
            );

            return;
        }


        createWorkButton.disabled = true;
        createWorkButton.textContent = "Creando...";


        try {

            const r =
                await fetch(
                    "/api/work/create",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                name,
                                responsible
                            })
                    }
                );


            const j =
                await r.json();


            if (!r.ok || j.error) {

                alert(
                    j.error ||
                    "No se pudo crear el trabajo."
                );

                return;
            }


            renderWorkState(
                j.state
            );


            const code =
                j.work_code;

            const key =
                j.access_key;


            const createdCode =
                document.getElementById(
                    "createdWorkCode"
                );

            const createdKey =
                document.getElementById(
                    "createdWorkKey"
                );


            if (createdCode) {
                createdCode.textContent = code;
            }

            if (createdKey) {
                createdKey.textContent = key;
            }


            showWorkMessage(

                '<strong>Trabajo creado correctamente.</strong><br><br>' +

                'Código de trabajo: ' +

                '<strong>' +
                escapeHtml(code) +
                '</strong><br>' +

                'Clave de acceso: ' +

                '<strong>' +
                escapeHtml(key) +
                '</strong><br><br>' +

                '<strong>Guardá ambos datos.</strong> ' +

                'Los vas a necesitar para abrir este trabajo ' +
                'desde otra computadora o compartirlo con otra persona del equipo.',

                "warning"
            );


            alert(
                "Trabajo creado.\n\n" +
                "Código: " +
                code +
                "\n" +
                "Clave: " +
                key +
                "\n\n" +
                "Guardá ambos datos."
            );


        } catch (err) {

            alert(
                "Error al crear el trabajo: " +
                err.message
            );

        } finally {

            createWorkButton.disabled = false;

            createWorkButton.textContent =
                "Crear y guardar trabajo";
        }
    };
}


// =========================================================
// ABRIR TRABAJO EXISTENTE
// =========================================================

const openWorkButton =
    document.getElementById("openWork");


if (openWorkButton) {

    openWorkButton.onclick = async () => {

        const workCode =
            document
                .getElementById("openWorkCode")
                .value
                .trim();

        const accessKey =
            document
                .getElementById("openWorkKey")
                .value
                .trim();


        if (!workCode || !accessKey) {

            alert(
                "Ingrese el Código de trabajo y la Clave de acceso."
            );

            return;
        }


        openWorkButton.disabled = true;
        openWorkButton.textContent = "Abriendo...";


        try {

            const r =
                await fetch(
                    "/api/work/open",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                work_code:
                                    workCode,

                                access_key:
                                    accessKey
                            })
                    }
                );


            const j =
                await r.json();


            if (!r.ok || j.error) {

                alert(
                    j.error ||
                    "No se pudo abrir el trabajo."
                );

                return;
            }


            await restoreProjectState(
                j.state
            );


            renderWorkState(
                j.state
            );


            showWorkMessage(

                "Trabajo " +
                escapeHtml(
                    j.state.work.work_code
                ) +
                " recuperado correctamente.",

                "success"
            );


            document
                .getElementById("openWorkKey")
                .value = "";


        } catch (err) {

            alert(
                "Error al abrir el trabajo: " +
                err.message
            );

        } finally {

            openWorkButton.disabled = false;

            openWorkButton.textContent =
                "Abrir trabajo";
        }
    };
}


// =========================================================
// GUARDAR TRABAJO
// =========================================================

const saveWorkButton =
    document.getElementById("saveWork");


if (saveWorkButton) {

    saveWorkButton.onclick = async () => {

        saveWorkButton.disabled = true;
        saveWorkButton.textContent = "Guardando...";

        try {

            const r =
                await fetch(
                    "/api/work/save",
                    {
                        method: "POST"
                    }
                );

            const j =
                await r.json();


            if (!r.ok || j.error) {

                if (j.conflict) {

                    alert(
                        j.error +
                        "\n\nVolvé a abrir el trabajo antes de continuar."
                    );

                } else {

                    alert(
                        j.error ||
                        "No se pudo guardar el trabajo."
                    );
                }

                return;
            }


            showWorkMessage(

                "Trabajo " +
                escapeHtml(
                    j.work_code
                ) +
                " guardado correctamente.",

                "success"
            );


        } catch (err) {

            alert(
                "Error al guardar: " +
                err.message
            );

        } finally {

            saveWorkButton.disabled = false;
            saveWorkButton.textContent = "Guardar trabajo";
        }
    };
}


// =========================================================
// CERRAR TRABAJO
// =========================================================

const closeWorkButton =
    document.getElementById("closeWork");


if (closeWorkButton) {

    closeWorkButton.onclick = async () => {

        const ok =
            confirm(
                "¿Querés cerrar el trabajo actual?\n\n" +
                "El trabajo quedará guardado en la base " +
                "y podrás volver a abrirlo con su Código y Clave."
            );


        if (!ok) return;


        try {

            const r =
                await fetch(
                    "/api/work/close",
                    {
                        method: "POST"
                    }
                );


            const j =
                await r.json();


            if (!r.ok || j.error) {

                alert(
                    j.error ||
                    "No se pudo cerrar el trabajo."
                );

                return;
            }


            resetAuditUI();


            renderWorkState(
                j.state
            );


            showWorkMessage(

                "Trabajo cerrado. Podés crear uno nuevo o abrir un trabajo existente.",

                "success"
            );


        } catch (err) {

            alert(
                "Error al cerrar el trabajo: " +
                err.message
            );
        }
    };
}


// =========================================================
// RESTAURAR TRABAJO DESDE POSTGRESQL
// =========================================================

async function restoreProjectState(state) {

    resetAuditUI(false);


    if (!state) {
        return;
    }


    // -----------------------------------------------------
    // MAPPING
    // -----------------------------------------------------

    mapping = {};


    const storedMapping =
        state.mapping || {};


    Object.entries(
        storedMapping
    ).forEach(
        ([key, value]) => {

            if (!value) return;

            if (
                key.endsWith("_col")
            ) {

                const role =
                    key.substring(
                        0,
                        key.length - 4
                    );

                mapping[role] =
                    value;

            } else {

                mapping[key] =
                    value;
            }
        }
    );


    // -----------------------------------------------------
    // POBLACIÓN
    // -----------------------------------------------------

    if (state.population) {

        population =
            state.population;


        const columns =
            state.population.columns ||
            [];


        renderMappingControls(
            columns,
            mapping
        );


        mappingCard.style.display =
            "block";


        renderPreviewTable(

            columns,

            state.population.preview ||
            []
        );


        document
            .getElementById(
                "N"
            )
            .value =
                state.population.rows ||
                0;


        if (
            state.population.analysis
        ) {

            renderPopulationAnalysis(
                state.population.analysis
            );
        }


        const sourceName =
            state.work &&
            state.work.source_name

                ? state.work.source_name

                : "Población recuperada";


        document
            .getElementById(
                "fileStatus"
            )
            .textContent =

                sourceName +

                " (" +

                (
                    state.population.rows ||
                    0
                ) +

                " filas)";
    }


    // -----------------------------------------------------
    // PARÁMETROS
    // -----------------------------------------------------

    restoreDesignParameters(
        state.params || {}
    );


    // -----------------------------------------------------
    // MUESTRA
    // -----------------------------------------------------

    sample =

        state.sample &&
        Array.isArray(
            state.sample.preview
        )

            ? state.sample.preview

            : [];


    lastSelectionCode =

        state.params &&
        state.params.seed

            ? state.params.seed

            : null;


    if (
        state.sample &&
        state.sample.rows
    ) {

        renderRestoredSampleSummary(
            state
        );


        const repeatArea =
            document.getElementById(
                "repeatArea"
            );


        if (repeatArea) {

            repeatArea.style.display =
                "flex";
        }


        renderSampleTable();
    }


    // -----------------------------------------------------
    // RESULTADOS
    // -----------------------------------------------------

    results = {};


    if (
        Array.isArray(
            state.results
        )
    ) {

        state.results.forEach(
            item => {

                if (
                    item._original_index === undefined ||
                    item._original_index === null
                ) {
                    return;
                }


                results[
                    String(
                        item._original_index
                    )
                ] = {

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


    if (sample.length) {

        try {
            await updateExtrapolation();
        } catch (_) {
            // No interrumpe la restauración.
        }
    }
}


function restoreDesignParameters(params) {

    if (!params) return;


    if (
        params.confidence !== undefined
    ) {

        document
            .getElementById(
                "confidence"
            )
            .value =
                String(
                    params.confidence
                );
    }


    if (
        params.error !== undefined
    ) {

        document
            .getElementById(
                "error"
            )
            .value =
                params.error;
    }


    if (
        params.p !== undefined
    ) {

        document
            .getElementById(
                "p"
            )
            .value =
                params.p;


        document
            .getElementById(
                "q"
            )
            .value =
                (
                    1 -
                    Number(
                        params.p
                    )
                ).toFixed(2);
    }


    document
        .getElementById(
            "materiality"
        )
        .value =

            params.materiality !== undefined

                ? params.materiality

                : "";


    document
        .getElementById(
            "tolerable"
        )
        .value =

            params.tolerable_error !== undefined

                ? params.tolerable_error

                : "";


    document
        .getElementById(
            "threshold"
        )
        .value =

            params.significant_threshold !== undefined

                ? params.significant_threshold

                : "";


    document
        .getElementById(
            "incMat"
        )
        .checked =

            Boolean(
                params.include_materiality
            );


    document
        .getElementById(
            "incOut"
        )
        .checked =

            Boolean(
                params.include_outliers
            );


    if (
        params.method
    ) {

        const radio =
            document.querySelector(
                'input[name="method"][value="' +
                params.method +
                '"]'
            );


        if (radio) {

            radio.checked =
                true;
        }
    }


    document
        .getElementById(
            "nResult"
        )
        .textContent =

            params.n
                ? params.n
                : "-";
}


function renderRestoredSampleSummary(state) {

    const params =
        state.params || {};


    const populationRows =

        state.population
            ? state.population.rows || 0
            : 0;


    const sampleRows =

        state.sample
            ? state.sample.rows || 0
            : 0;


    const coverageCount =

        populationRows

            ? sampleRows /
              populationRows *
              100

            : 0;


    let coverageAmountText =
        "-";


    const amountCol =
        mapping.amount;


    const analysis =

        state.population
            ? state.population.analysis
            : null;


    if (
        amountCol &&
        analysis &&
        analysis.amount_abs_total &&
        sample.length === sampleRows
    ) {

        const selectedAmount =

            sample.reduce(
                (total, row) => {

                    const number =
                        Number(
                            row[amountCol]
                        );

                    return total +

                        (
                            Number.isFinite(
                                number
                            )

                                ? Math.abs(
                                    number
                                )

                                : 0
                        );
                },
                0
            );


        coverageAmountText =

            (
                selectedAmount /
                analysis.amount_abs_total *
                100
            ).toFixed(2) +

            "%";
    }


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
                    sampleRows +
                '</span>' +

            '</div>' +


            '<div class="summary-item">' +

                '<span class="summary-label">' +
                    'Cobertura registros' +
                '</span>' +

                '<span class="summary-value">' +
                    coverageCount.toFixed(2) +
                    '%' +
                '</span>' +

            '</div>' +


            '<div class="summary-item">' +

                '<span class="summary-label">' +
                    'Cobertura monetaria' +
                '</span>' +

                '<span class="summary-value">' +
                    coverageAmountText +
                '</span>' +

            '</div>' +


            '<div class="summary-item code-pill">' +

                '<span class="summary-label">' +
                    'Código de selección' +
                '</span>' +

                '<span class="summary-value">' +
                    (
                        params.seed ||
                        "-"
                    ) +
                '</span>' +

            '</div>' +


            '<div class="summary-item">' +

                '<span class="summary-label">' +
                    'Método' +
                '</span>' +

                '<span class="summary-value">' +

                    (
                        methodLabels[
                            params.method
                        ] ||

                        params.method ||

                        "-"
                    ) +

                '</span>' +

            '</div>';
}


// =========================================================
// RESETEAR INTERFAZ
// =========================================================

function resetAuditUI(clearWorkMessage = true) {

    population = null;
    mapping = {};
    sample = [];
    results = {};
    lastSelectionCode = null;


    mappingDiv.innerHTML =
        "";


    mappingCard.style.display =
        "none";


    document
        .getElementById(
            "populationResults"
        )
        .style.display =
            "none";


    preview.innerHTML =
        "";


    popKpis.innerHTML =
        "";


    quality.innerHTML =
        "";


    document
        .getElementById(
            "N"
        )
        .value =
            "";


    document
        .getElementById(
            "nResult"
        )
        .textContent =
            "-";


    document
        .getElementById(
            "sampleSummary"
        )
        .innerHTML =
            "";


    document
        .getElementById(
            "sampleTable"
        )
        .innerHTML =
            "";


    document
        .getElementById(
            "resultsTable"
        )
        .innerHTML =
            "";


    document
        .getElementById(
            "resultsDash"
        )
        .innerHTML =
            "";


    document
        .getElementById(
            "observed"
        )
        .innerHTML =
            "";


    document
        .getElementById(
            "projected"
        )
        .innerHTML =
            "";


    document
        .getElementById(
            "extraWarning"
        )
        .innerHTML =
            "";


    document
        .getElementById(
            "summary"
        )
        .innerHTML =
            "";


    document
        .getElementById(
            "conclusion"
        )
        .textContent =
            "Genere y evalúe la muestra para obtener el resumen.";


    document
        .getElementById(
            "fileStatus"
        )
        .textContent =
            "Sin población cargada";


    const repeatArea =
        document.getElementById(
            "repeatArea"
        );


    if (repeatArea) {

        repeatArea.style.display =
            "none";
    }


    if (clearWorkMessage) {

        showWorkMessage("");
    }
}


// =========================================================
// CARGA DE ARCHIVO
// =========================================================

drop.onclick =
    () => file.click();


file.onchange =
    upload;


drop.ondragover = e => {

    e.preventDefault();

    drop.style.borderColor =
        "var(--primary)";
};


drop.ondragleave =
    () => {

        drop.style.borderColor =
            "";
    };


drop.ondrop = e => {

    e.preventDefault();

    drop.style.borderColor =
        "";


    if (
        e.dataTransfer.files.length
    ) {

        upload({
            target: {
                files:
                    e.dataTransfer.files
            }
        });
    }
};


async function upload(e) {

    const f =
        e.target.files[0];


    if (!f) return;


    const fd =
        new FormData();


    fd.append(
        "file",
        f
    );


    msg.innerHTML =
        "Cargando...";


    try {

        const r =
            await fetch(
                "/api/upload",
                {
                    method:
                        "POST",

                    body:
                        fd
                }
            );


        const j =
    await readJsonResponse(r);


        if (
            !r.ok ||
            j.error
        ) {

            alert(
                j.error ||
                "No se pudo cargar la población."
            );

            msg.innerHTML =
                j.error || "";

            return;
        }


        mapping = {};
        sample = [];
        results = {};
        lastSelectionCode = null;


        msg.innerHTML =

            "Archivo: " +

            f.name +

            " (" +

            j.rows +

            " filas)";


        document
            .getElementById(
                "fileStatus"
            )
            .textContent =

                f.name +

                " (" +

                j.rows +

                " filas)";


        renderMappingControls(
            j.columns,
            {}
        );


        mappingCard.style.display =
            "block";


        population =
            j;


        renderPreviewTable(
            j.columns,
            j.preview
        );


        document
            .getElementById(
                "populationResults"
            )
            .style.display =
                "none";


        document
            .getElementById(
                "sampleSummary"
            )
            .innerHTML =
                "";


        document
            .getElementById(
                "sampleTable"
            )
            .innerHTML =
                "";


        document
            .getElementById(
                "resultsTable"
            )
            .innerHTML =
                "";


        document
            .getElementById(
                "resultsDash"
            )
            .innerHTML =
                "";


    } catch (err) {

        msg.innerHTML =
            "Error: " +
            err.message;
    }
}


// =========================================================
// MAPEO
// =========================================================

function renderMappingControls(
    columns,
    restoredMapping = {}
) {

    mappingDiv.innerHTML =
        "";


    const roleByColumn =
        {};


    Object.entries(
        restoredMapping
    ).forEach(
        ([role, column]) => {

            if (column) {
                roleByColumn[column] =
                    role;
            }
        }
    );


    columns.forEach(
        column => {

            const selectedRole =
                roleByColumn[column] ||
                "";


            mappingDiv.innerHTML +=

                '<div class="form-group">' +

                    '<label>' +
                        escapeHtml(column) +
                    '</label>' +

                    '<select ' +
                        'class="col-map" ' +
                        'data-col="' +
                        escapeAttribute(column) +
                    '">' +

                        mappingOption(
                            "",
                            "Ignorar",
                            selectedRole
                        ) +

                        mappingOption(
                            "id",
                            "ID",
                            selectedRole
                        ) +

                        mappingOption(
                            "amount",
                            "Importe",
                            selectedRole
                        ) +

                        mappingOption(
                            "date",
                            "Fecha",
                            selectedRole
                        ) +

                        mappingOption(
                            "vendor",
                            "Proveedor",
                            selectedRole
                        ) +

                        mappingOption(
                            "company",
                            "Sociedad",
                            selectedRole
                        ) +

                        mappingOption(
                            "center",
                            "Centro",
                            selectedRole
                        ) +

                        mappingOption(
                            "user",
                            "Usuario",
                            selectedRole
                        ) +

                        mappingOption(
                            "doctype",
                            "Tipo Doc",
                            selectedRole
                        ) +

                        mappingOption(
                            "account",
                            "Cuenta",
                            selectedRole
                        ) +

                    '</select>' +

                '</div>';
        }
    );
}


function mappingOption(
    value,
    label,
    selected
) {

    return (

        '<option value="' +
        value +
        '"' +

        (
            value === selected
                ? " selected"
                : ""
        ) +

        '>' +

        label +

        '</option>'
    );
}


// =========================================================
// PREVIEW
// =========================================================

function renderPreviewTable(
    columns,
    rows
) {

    preview.innerHTML =

        "<thead><tr>" +

        columns
            .map(
                column =>
                    "<th>" +
                    escapeHtml(column) +
                    "</th>"
            )
            .join("") +

        "</tr></thead>" +


        "<tbody>" +

        rows
            .map(
                row =>

                    "<tr>" +

                    columns
                        .map(
                            column =>

                                "<td>" +

                                escapeHtml(
                                    displayValue(
                                        row[column]
                                    )
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
// ANÁLISIS DE POBLACIÓN
// =========================================================

analyze.onclick =
    async () => {

        mapping =
            {};


        document
            .querySelectorAll(
                ".col-map"
            )
            .forEach(
                select => {

                    if (
                        select.value
                    ) {

                        mapping[
                            select.value
                        ] =
                            select.dataset.col;
                    }
                }
            );


        if (
            !mapping.id ||
            !mapping.amount
        ) {

            alert(
                "Seleccione ID e Importe."
            );

            return;
        }


        const r =
            await fetch(
                "/api/analyze",
                {
                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            mapping
                        )
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
                "No se pudo analizar la población."
            );

            return;
        }


        renderPopulationAnalysis(
            j
        );


        document
            .getElementById(
                "N"
            )
            .value =
                j.records;
    };


function renderPopulationAnalysis(j) {

    document
        .getElementById(
            "populationResults"
        )
        .style.display =
            "block";


    popKpis.innerHTML =

        kpiCard(
            "Registros",
            (
                j.records ||
                0
            ).toLocaleString()
        ) +

        kpiCard(
            "Importe Total",
            formatMoney(
                j.amount_total || 0
            )
        ) +

        kpiCard(
            "Promedio",
            formatMoney(
                j.mean || 0
            )
        ) +

        kpiCard(
            "Mediana",
            formatMoney(
                j.median || 0
            )
        ) +

        kpiCard(
            "Máximo",
            formatMoney(
                j.max || 0
            )
        ) +

        kpiCard(
            "Mínimo",
            formatMoney(
                j.min || 0
            )
        ) +

        kpiCard(
            "Desv. Estándar",
            formatMoney(
                j.std || 0
            )
        ) +

        kpiCard(
            "Duplicados",
            j.duplicate_rows || 0
        );


    quality.innerHTML =

        qualityItem(
            "Ceros",
            j.zeros || 0
        ) +

        qualityItem(
            "Negativos",
            j.negatives || 0
        ) +

        qualityItem(
            "Outliers",
            j.outliers || 0
        ) +

        qualityItem(
            "Top 10",
            (
                j.top10_pct || 0
            ).toFixed(1) +
            "%"
        ) +

        qualityItem(
            "Top 20",
            (
                j.top20_pct || 0
            ).toFixed(1) +
            "%"
        ) +

        qualityItem(
            "Top 50",
            (
                j.top50_pct || 0
            ).toFixed(1) +
            "%"
        );
}


function kpiCard(
    label,
    value
) {

    return (

        '<div class="kpi-card">' +

            '<div class="kpi-label">' +
                label +
            '</div>' +

            '<div class="kpi-value">' +
                value +
            '</div>' +

        '</div>'
    );
}


function qualityItem(
    label,
    value
) {

    return (

        '<div class="quality-item">' +

            '<span class="quality-label">' +
                label +
            '</span>' +

            '<span class="quality-value">' +
                value +
            '</span>' +

        '</div>'
    );
}


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
                        .getElementById(
                            "p"
                        )
                        .value
                ) || 0.5;


            document
                .getElementById(
                    "q"
                )
                .value =
                    (
                        1 - p
                    ).toFixed(2);
        };


document
    .getElementById("q")
    .value =
        "0.5";


// =========================================================
// EXPLICACIÓN DEL TAMAÑO DE MUESTRA
// =========================================================

document
    .getElementById(
        "howSample"
    )
    .onclick =
        () => {

            const N =
                parseInt(
                    document
                        .getElementById(
                            "N"
                        )
                        .value
                ) || 0;


            const conf =
                document
                    .getElementById(
                        "confidence"
                    )
                    .value;


            const e =
                parseFloat(
                    document
                        .getElementById(
                            "error"
                        )
                        .value
                ) || 0.05;


            const p =
                parseFloat(
                    document
                        .getElementById(
                            "p"
                        )
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
                    (
                        N - 1
                    )

                    +

                    z *
                    z *
                    p *
                    q
                );


            document
                .getElementById(
                    "modalText"
                )
                .innerHTML =

                    '<p><strong>Fórmula</strong>: ' +

                    'n = (Z² × p × q × N) / ' +

                    '[e² × (N-1) + Z² × p × q]</p>' +

                    '<p><strong>Variables</strong>:<br>' +

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

                    '<p><strong>Resultado</strong>: n = ' +

                    Math.ceil(n) +

                    ' registros</p>';


            document
                .getElementById(
                    "modal"
                )
                .classList
                .add(
                    "active"
                );
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
                .getElementById(
                    "modal"
                )
                .classList
                .remove(
                    "active"
                );
        };
}


// =========================================================
// RECOMENDACIÓN
// =========================================================

document
    .getElementById(
        "recommend"
    )
    .onclick =
        async () => {

            if (
                !mapping.amount
            ) {

                alert(
                    "Analice la población primero."
                );

                return;
            }


            const r =
                await fetch(
                    "/api/recommend",
                    {
                        method:
                            "POST",

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


            if (
                !r.ok ||
                j.error
            ) {

                alert(
                    j.error ||
                    "No se pudo generar la recomendación."
                );

                return;
            }


            const box =
                document.getElementById(
                    "recommendationBox"
                );


            box.style.display =
                "block";


            box.innerHTML =

                '<p><strong>Recomendación</strong>: ' +

                j.recommendation +

                '</p>' +

                '<p><strong>Razones</strong>:</p>' +

                '<ul>' +

                j.reasons
                    .map(
                        reason =>
                            "<li>" +
                            escapeHtml(reason) +
                            "</li>"
                    )
                    .join("") +

                '</ul>';
        };


// =========================================================
// GENERAR / REPETIR MUESTRA
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
            "Analice la población primero."
        );

        return;
    }


    const N =
        parseInt(
            document
                .getElementById(
                    "N"
                )
                .value
        ) || 0;


    const conf =
        document
            .getElementById(
                "confidence"
            )
            .value;


    const e =
        parseFloat(
            document
                .getElementById(
                    "error"
                )
                .value
        ) || 0.05;


    const p =
        parseFloat(
            document
                .getElementById(
                    "p"
                )
                .value
        ) || 0.5;


    const calcResponse =
        await fetch(
            "/api/calculate-sample",
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        N,
                        confidence:
                            conf,
                        error:
                            e,
                        p
                    })
            }
        );


    const calc =
        await calcResponse.json();


    if (
        !calcResponse.ok ||
        calc.error
    ) {

        alert(
            calc.error ||
            "No se pudo calcular el tamaño de muestra."
        );

        return;
    }


    document
        .getElementById(
            "nResult"
        )
        .textContent =
            calc.n;


    const method =
        document
            .querySelector(
                'input[name="method"]:checked'
            )
            .value;


    const payload = {

        id_col:
            mapping.id,

        amount_col:
            mapping.amount,

        method,

        n:
            calc.n,

        confidence:
            conf,

        error:
            e,

        p,

        seed:

            selectionCode !== null

                ? selectionCode

                : Date.now(),

        include_materiality:

            document
                .getElementById(
                    "incMat"
                )
                .checked,

        include_outliers:

            document
                .getElementById(
                    "incOut"
                )
                .checked,

        significant_threshold:

            parseFloat(
                document
                    .getElementById(
                        "threshold"
                    )
                    .value
            ) || 0,

        materiality:

            parseFloat(
                document
                    .getElementById(
                        "materiality"
                    )
                    .value
            ) || 0,

        tolerable_error:

            parseFloat(
                document
                    .getElementById(
                        "tolerable"
                    )
                    .value
            ) || 0
    };


    const r =
        await fetch(
            "/api/generate-sample",
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        payload
                    )
            }
        );


    const j =
        await r.json();


    if (
        !r.ok ||
        j.error
    ) {

        if (
            j.conflict
        ) {

            alert(
                j.error +
                "\n\nVolvé a abrir el trabajo antes de continuar."
            );

        } else {

            alert(
                j.error ||
                "No se pudo generar la muestra."
            );
        }

        return;
    }


    sample =
        j.preview || [];


    lastSelectionCode =
        j.seed;


    if (
        !isRepeat
    ) {

        results =
            {};
    }


    renderGeneratedSampleSummary(
        j,
        method
    );


    const repeatArea =
        document.getElementById(
            "repeatArea"
        );


    if (
        repeatArea
    ) {

        repeatArea.style.display =
            "flex";
    }


    renderSampleTable();

    renderResultsTable();


    if (
        isRepeat
    ) {

        alert(
            "Selección reproducida correctamente.\n" +

            "Código de selección: " +

            lastSelectionCode
        );

    } else {

        alert(
            "Muestra: " +
            j.rows +
            " registros"
        );
    }
}


function renderGeneratedSampleSummary(
    j,
    method
) {

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


    document
        .getElementById(
            "sampleSummary"
        )
        .innerHTML =

            summaryItem(
                "Tamaño",
                j.rows || 0
            ) +

            summaryItem(
                "Cobertura registros",
                (
                    j.coverage_count ||
                    0
                ).toFixed(2) +
                "%"
            ) +

            summaryItem(
                "Cobertura monetaria",
                (
                    j.coverage_amount ||
                    0
                ).toFixed(2) +
                "%"
            ) +

            summaryItem(
                "Código de selección",
                j.seed,
                "code-pill"
            ) +

            summaryItem(
                "Método",
                methodLabels[method] ||
                method
            );
}


function summaryItem(
    label,
    value,
    extraClass = ""
) {

    return (

        '<div class="summary-item ' +
        extraClass +
        '">' +

            '<span class="summary-label">' +
                label +
            '</span>' +

            '<span class="summary-value">' +
                value +
            '</span>' +

        '</div>'
    );
}


document
    .getElementById(
        "generate"
    )
    .onclick =
        async () => {

            await generateSample(
                null,
                false
            );
        };


const repeatSelectionButton =
    document.getElementById(
        "repeatSelection"
    );


if (
    repeatSelectionButton
) {

    repeatSelectionButton.onclick =
        async () => {

            if (
                !lastSelectionCode
            ) {

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

    if (
        !sample.length
    ) {

        return [];
    }


    return Object
        .keys(
            sample[0]
        )
        .filter(
            column =>

                !column.startsWith(
                    "_"
                )

                &&

                column !==
                    "Tipo_Seleccion"
        );
}


function renderSampleTable() {

    const table =
        document.getElementById(
            "sampleTable"
        );


    if (
        !sample.length
    ) {

        table.innerHTML =
            "";

        return;
    }


    const cols =
        getVisibleSampleColumns();


    table.innerHTML =

        "<thead><tr>" +

        cols
            .map(
                column =>
                    "<th>" +
                    escapeHtml(column) +
                    "</th>"
            )
            .join("") +

        "</tr></thead>" +

        "<tbody>" +

        sample
            .map(
                row =>

                    "<tr>" +

                    cols
                        .map(
                            column =>

                                "<td>" +

                                escapeHtml(
                                    displayValue(
                                        row[column]
                                    )
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
// RESULTADOS
// =========================================================

function getOriginalIndex(
    row,
    fallback
) {

    if (
        row._original_index !== undefined &&
        row._original_index !== null &&
        row._original_index !== ""
    ) {

        return row._original_index;
    }


    return fallback;
}


function getRegisteredAmount(
    row
) {

    if (
        mapping.amount &&
        row[mapping.amount] !== undefined &&
        row[mapping.amount] !== null &&
        row[mapping.amount] !== ""
    ) {

        return row[
            mapping.amount
        ];
    }


    return "";
}


function renderResultsTable() {

    const table =
        document.getElementById(
            "resultsTable"
        );


    if (
        !sample.length
    ) {

        table.innerHTML =
            "";

        updateResultsDashboard();

        return;
    }


    const cols =
        getVisibleSampleColumns();


    table.innerHTML =

        "<thead><tr>" +

        cols
            .map(
                column =>
                    "<th>" +
                    escapeHtml(column) +
                    "</th>"
            )
            .join("") +

        '<th class="audit-col">Resultado de revisión</th>' +

        '<th class="audit-col">Importe registrado</th>' +

        '<th class="audit-col">Importe validado</th>' +

        '<th class="audit-col">Diferencia</th>' +

        '<th class="audit-col">Tipo de excepción</th>' +

        '<th class="audit-col">Comentario del auditor</th>' +

        '<th class="audit-col">Referencia de evidencia</th>' +

        "</tr></thead>" +

        "<tbody>" +

        sample
            .map(
                (
                    row,
                    i
                ) => {

                    const orig =
                        getOriginalIndex(
                            row,
                            i
                        );


                    const key =
                        String(orig);


                    results[key] =
                        results[key] ||
                        {};


                    const res =
                        results[key];


                    const defaultRegistered =
                        getRegisteredAmount(
                            row
                        );


                    const registeredValue =

                        res.registered !== undefined &&
                        res.registered !== ""

                            ? res.registered

                            : defaultRegistered;


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

                            : "";


                    return (

                        "<tr>" +

                        cols
                            .map(
                                column =>

                                    "<td>" +

                                    escapeHtml(
                                        displayValue(
                                            row[column]
                                        )
                                    ) +

                                    "</td>"
                            )
                            .join("") +


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


                        '<td ' +
                            'class="audit-col res-diff" ' +
                            'data-idx="' +
                            orig +
                        '">' +

                            formatDifference(
                                res.difference
                            ) +

                        '</td>' +


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
                                    res.comment ||
                                    ""
                                ) +
                            '">' +

                        '</td>' +


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
                                    res.evidence ||
                                    ""
                                ) +
                            '">' +

                        '</td>' +

                        "</tr>"
                    );
                }
            )
            .join("") +

        "</tbody>";


    bindResultEvents();

    updateResultsDashboard();
}


// =========================================================
// EVENTOS RESULTADOS
// =========================================================

function bindResultEvents() {

    document
        .querySelectorAll(
            ".res-registered, .res-validated"
        )
        .forEach(
            input => {

                input.oninput =
                    calcDiff;
            }
        );


    document
        .querySelectorAll(
            ".res-status"
        )
        .forEach(
            select => {

                select.onchange =
                    handleStatusChange;
            }
        );


    document
        .querySelectorAll(
            ".res-exception-type"
        )
        .forEach(
            select => {

                select.onchange =
                    () => {

                        const idx =
                            String(
                                select.dataset.idx
                            );


                        results[idx] =
                            results[idx] ||
                            {};


                        results[idx].exception_type =
                            select.value;


                        updateResultsDashboard();
                    };
            }
        );


    document
        .querySelectorAll(
            ".res-comment"
        )
        .forEach(
            input => {

                input.oninput =
                    () => {

                        const idx =
                            String(
                                input.dataset.idx
                            );


                        results[idx] =
                            results[idx] ||
                            {};


                        results[idx].comment =
                            input.value;
                    };
            }
        );


    document
        .querySelectorAll(
            ".res-evidence"
        )
        .forEach(
            input => {

                input.oninput =
                    () => {

                        const idx =
                            String(
                                input.dataset.idx
                            );


                        results[idx] =
                            results[idx] ||
                            {};


                        results[idx].evidence =
                            input.value;
                    };
            }
        );
}


// =========================================================
// ESTADO DE REVISIÓN
// =========================================================

function handleStatusChange(e) {

    const select =
        e.target;


    const idx =
        String(
            select.dataset.idx
        );


    results[idx] =
        results[idx] ||
        {};


    results[idx].status =
        select.value;


    if (
        select.value ===
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


            const diffCell =
                document.querySelector(
                    '.res-diff[data-idx="' +
                    idx +
                    '"]'
                );


            if (
                diffCell
            ) {

                diffCell.textContent =
                    formatDifference(
                        0
                    );
            }
        }
    }


    updateResultsDashboard();
}


// =========================================================
// DIFERENCIA
// =========================================================

function calcDiff(e) {

    const idx =
        String(
            e.target.dataset.idx
        );


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
        results[idx] ||
        {};


    results[idx].registered =
        registered;


    results[idx].validated =
        validated;


    const diffCell =
        document.querySelector(
            '.res-diff[data-idx="' +
            idx +
            '"]'
        );


    if (
        registered === "" ||
        validated === ""
    ) {

        results[idx].difference =
            "";


        if (
            diffCell
        ) {

            diffCell.textContent =
                "";
        }


        updateResultsDashboard();

        return;
    }


    const difference =

        Number(
            registered
        )

        -

        Number(
            validated
        );


    results[idx].difference =
        difference;


    if (
        diffCell
    ) {

        diffCell.textContent =
            formatDifference(
                difference
            );
    }


    updateResultsDashboard();
}


// =========================================================
// DASHBOARD RESULTADOS
// =========================================================

function updateResultsDashboard() {

    const dash =
        document.getElementById(
            "resultsDash"
        );


    if (
        !dash
    ) {

        return;
    }


    if (
        !sample.length
    ) {

        dash.innerHTML =
            "";

        return;
    }


    let reviewed = 0;
    let exceptions = 0;
    let pending = 0;
    let observedError = 0;


    sample.forEach(
        (
            row,
            i
        ) => {

            const idx =
                String(
                    getOriginalIndex(
                        row,
                        i
                    )
                );


            const res =
                results[idx] ||
                {};


            if (
                !res.status
            ) {

                pending++;

                return;
            }


            reviewed++;


            if (
                res.status ===
                    "Excepción monetaria"

                ||

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

        kpiCard(
            "Total muestra",
            sample.length
        ) +

        kpiCard(
            "Revisados",
            reviewed
        ) +

        kpiCard(
            "Pendientes",
            pending
        ) +

        kpiCard(
            "Excepciones",
            exceptions
        ) +

        kpiCard(
            "Error monetario observado",
            formatMoney(
                observedError
            )
        );
}


// =========================================================
// GUARDAR RESULTADOS
// =========================================================

document
    .getElementById(
        "saveResults"
    )
    .onclick =
        async () => {

            if (
                !sample.length
            ) {

                alert(
                    "Genere muestra primero."
                );

                return;
            }


            collectVisibleResults();


            const payloadResults =

                sample.map(
                    (
                        row,
                        i
                    ) => {

                        const idx =
                            String(
                                getOriginalIndex(
                                    row,
                                    i
                                )
                            );


                        const res =
                            results[idx] ||
                            {};


                        return {

                            _original_index:
                                Number(idx),

                            status:
                                res.status ||
                                "",

                            registered:

                                res.registered !== undefined

                                    ? res.registered

                                    : "",

                            validated:

                                res.validated !== undefined

                                    ? res.validated

                                    : "",

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
                                res.exception_type ||
                                "",

                            comment:
                                res.comment ||
                                "",

                            evidence:
                                res.evidence ||
                                ""
                        };
                    }
                );


            const r =
                await fetch(
                    "/api/results",
                    {
                        method:
                            "POST",

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


            if (
                !r.ok ||
                j.error
            ) {

                if (
                    j.conflict
                ) {

                    alert(
                        j.error +
                        "\n\nVolvé a abrir el trabajo antes de continuar."
                    );

                } else {

                    alert(
                        j.error ||
                        "No se pudieron guardar los resultados."
                    );
                }

                return;
            }


            alert(
                "Resultados guardados."
            );


            updateResultsDashboard();

            await updateExtrapolation();
        };


// =========================================================
// RECOLECTAR RESULTADOS
// =========================================================

function collectVisibleResults() {

    document
        .querySelectorAll(
            ".res-status"
        )
        .forEach(
            el => {

                const idx =
                    String(
                        el.dataset.idx
                    );


                results[idx] =
                    results[idx] ||
                    {};


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
                    String(
                        el.dataset.idx
                    );


                results[idx] =
                    results[idx] ||
                    {};


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
                    String(
                        el.dataset.idx
                    );


                results[idx] =
                    results[idx] ||
                    {};


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
                    String(
                        el.dataset.idx
                    );


                results[idx] =
                    results[idx] ||
                    {};


                results[idx].exception_type =
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
                    String(
                        el.dataset.idx
                    );


                results[idx] =
                    results[idx] ||
                    {};


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
                    String(
                        el.dataset.idx
                    );


                results[idx] =
                    results[idx] ||
                    {};


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


if (
    downloadReview
) {

    downloadReview.onclick =
        () => {

            if (
                !sample.length
            ) {

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
// IMPORTAR EXCEL DE REVISIÓN
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

            if (
                !sample.length
            ) {

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


            if (
                !f
            ) {

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
                            method:
                                "POST",

                            body:
                                fd
                        }
                    );


                const j =
                    await r.json();


                if (
                    !r.ok ||
                    j.error
                ) {

                    if (
                        j.conflict
                    ) {

                        alert(
                            j.error +
                            "\n\nVolvé a abrir el trabajo antes de continuar."
                        );

                    } else {

                        alert(
                            j.error ||
                            "No se pudo importar el archivo."
                        );
                    }

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
                                    item.status ||
                                    "",

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
                                    item.exception_type ||
                                    "",

                                comment:
                                    item.comment ||
                                    "",

                                evidence:
                                    item.evidence ||
                                    ""
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


                alert(
                    message
                );


                await updateExtrapolation();


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
    .getElementById(
        "refreshExtra"
    )
    .onclick =
        updateExtrapolation;


async function updateExtrapolation() {

    const r =
        await fetch(
            "/api/extrapolation"
        );


    const j =
        await r.json();


    if (
        !r.ok ||
        j.error
    ) {

        document
            .getElementById(
                "extraWarning"
            )
            .innerHTML =

                '<div class="warning-box">' +

                escapeHtml(
                    j.error ||
                    "No se pudo calcular la extrapolación."
                ) +

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

                    escapeHtml(
                        j.message
                    ) +

                    '</div>'
                )

                : "";


    document
        .getElementById(
            "observed"
        )
        .innerHTML =

            observedItem(
                "Error detectado en revisión 100%",
                formatMoney(
                    j.observed_100 ||
                    0
                )
            ) +

            observedItem(
                "Error detectado en muestra probabilística",
                formatMoney(
                    j.observed_residual ||
                    0
                )
            ) +

            observedItem(
                "Total de errores efectivamente detectados",
                formatMoney(
                    j.effectively_identified ||
                    0
                )
            );


    document
        .getElementById(
            "projected"
        )
        .innerHTML =

            projectedItem(
                "Tasa de error observada",

                (
                    (
                        j.error_rate ||
                        0
                    )

                    *

                    100
                ).toFixed(2)

                +

                "%"
            ) +

            projectedItem(
                "Error estimado en el universo probabilístico",

                formatMoney(
                    j.projected_residual ||
                    0
                )
            ) +

            projectedItem(
                "Error total estimado de la población",

                formatMoney(
                    j.total_estimated ||
                    0
                )
            );


    document
        .getElementById(
            "summary"
        )
        .innerHTML =

            executiveKpi(
                "Muestra",
                (
                    j.sample_count ||
                    0
                ).toLocaleString()
            ) +

            executiveKpi(
                "Cobertura registros",
                (
                    j.coverage_count ||
                    0
                ).toFixed(2) +
                "%"
            ) +

            executiveKpi(
                "Excepciones",
                j.exceptions ||
                0
            ) +

            executiveKpi(
                "Error observado",

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
                )
            ) +

            executiveKpi(
                "Error estimado universo probabilístico",

                formatMoney(
                    j.projected_residual ||
                    0
                )
            ) +

            executiveKpi(
                "Error total estimado",

                formatMoney(
                    j.total_estimated ||
                    0
                )
            );


    const materiality =
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

            'Error total estimado de la población: ' +

            '<strong>' +

            formatMoney(
                j.total_estimated ||
                0
            ) +

            '</strong>. ' +

            'Materialidad: ' +

            '<strong>' +

            formatMoney(
                materiality
            ) +

            '</strong>. ' +

            'Estado: ' +

            '<strong>' +

            escapeHtml(
                checks.total_vs_materiality ||
                "sin umbral"
            ) +

            '</strong>.' +

            '</p>';
}


function observedItem(
    label,
    value
) {

    return (

        '<div class="obs-item">' +

            '<span class="obs-label">' +
                label +
            '</span>' +

            '<span class="obs-value">' +
                value +
            '</span>' +

        '</div>'
    );
}


function projectedItem(
    label,
    value
) {

    return (

        '<div class="proj-item">' +

            '<span class="proj-label">' +
                label +
            '</span>' +

            '<span class="proj-value">' +
                value +
            '</span>' +

        '</div>'
    );
}


function executiveKpi(
    label,
    value
) {

    return (

        '<div class="exec-kpi">' +

            '<div class="exec-kpi-label">' +
                label +
            '</div>' +

            '<div class="exec-kpi-value">' +
                value +
            '</div>' +

        '</div>'
    );
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
        escapeAttribute(
            value
        ) +
        '"' +

        (
            value === selectedValue

                ? " selected"

                : ""
        ) +

        '>' +

        escapeHtml(
            label
        ) +

        '</option>'
    );
}


function parseNumberOrBlank(
    value
) {

    if (
        value === "" ||
        value === null ||
        value === undefined
    ) {

        return "";
    }


    const number =
        Number(
            value
        );


    return Number.isFinite(
        number
    )

        ? number

        : "";
}


function formatDifference(
    value
) {

    if (
        value === "" ||
        value === undefined ||
        value === null
    ) {

        return "";
    }


    return formatMoney(
        value
    );
}


function safeInputValue(
    value
) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {

        return "";
    }


    const number =
        Number(
            value
        );


    if (
        Number.isFinite(
            number
        )
    ) {

        return number;
    }


    return "";
}


function displayValue(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";
    }


    return String(
        value
    );
}


function escapeHtml(
    value
) {

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
        "<",
        "&lt;"
    )
    .replaceAll(
        ">",
        "&gt;"
    )
    .replaceAll(
        '"',
        "&quot;"
    )
    .replaceAll(
        "'",
        "&#039;"
    );
}


function escapeAttribute(
    value
) {

    return escapeHtml(
        value
    );
}


// =========================================================
// FORMATO MONETARIO
// =========================================================

function formatMoney(
    value
) {

    const number =
        Number(
            value
        ) || 0;


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
    .format(
        number
    );
}


// =========================================================
// INICIAR TRACKING
// =========================================================

initializeWorkTracking();
