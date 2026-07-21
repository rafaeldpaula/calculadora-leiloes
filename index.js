"use strict";

/* ============================================================
 * Auction Property Viability Calculator
 *
 * The UI is in Portuguese (pt-BR) and the persisted state keys
 * mirror the form fields (lance, venda, despesas, ...), which is
 * the contract shared with index.html (data-k) and the saved
 * localStorage / exported JSON. Those keys are kept as-is on
 * purpose; everything else uses descriptive English names.
 * ============================================================ */

/* ---------------- financial model constants ---------------- */

// Financing is approximated with a 35-year (420-month) linear
// amortization. These estimates can always be overridden by the
// user with the bank's real numbers.
const FINANCING_TERM_MONTHS = 420;
const ESTIMATED_INSTALLMENT_RATE = 0.0097; // monthly payment ≈ 0.97% of financed amount

const STORAGE_KEY = "viab_leilao_v1";

/* ---------------- formatters ---------------- */
const brlFormatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
});
const decimalFormatter = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});
const formatBRL = (value) => brlFormatter.format(isFinite(value) ? value : 0);

/* ---------------- default state ---------------- */
function createId() {
    return "d" + Math.random().toString(36).slice(2, 9);
}

const createDefaultExpenses = () => [
    { id: createId(), nome: "ITBI", tipo: "pctLance", pct: 0.02 },
    { id: createId(), nome: "Registro", tipo: "fixo", valor: 1600 },
    { id: createId(), nome: "Emolumentos / carta de arremat.", tipo: "fixo", valor: 2700 },
    { id: createId(), nome: "Comissão do leiloeiro", tipo: "pctLance", pct: 0.05 },
    { id: createId(), nome: "Reforma", tipo: "fixo", valor: 5000 },
    { id: createId(), nome: "IPTU", tipo: "mensal", valor: 30 },
    { id: createId(), nome: "Condomínio", tipo: "mensal", valor: 300 },
    { id: createId(), nome: "Comissão de venda (corretor)", tipo: "pctVenda", pct: 0.05 },
    { id: createId(), nome: "Advogado", tipo: "fixo", valor: 7000 },
    { id: createId(), nome: "Dívidas até a arrematação (IPTU/cond.)", tipo: "fixo", valor: 20000 },
];

const createDefaultState = () => ({
    tipo: "",
    cidade: "",
    link: "",
    modalidade: "Licitação Aberta",
    leiloeiro: "",
    dataLeilao: "",
    area: 0,
    avaliacao: 0,
    lanceMinimo: 0,
    lance: 0,
    venda: 0,
    prazo: 12,
    roiMin: 0.25,
    financiado: 0,
    pctEntrada: 0.2,
    parcelaOverride: "",
    saldoOverride: "",
    aliquotaIR: 0.15,
    despesas: createDefaultExpenses(),
});

let state = loadStoredState() || createDefaultState();

/* ---------------- input parsing ---------------- */

// Parse a user-typed number that may use Brazilian formatting
// (dot as thousands separator, comma as decimal), returning 0 for
// anything that isn't a valid number.
function parseNumber(input) {
    if (typeof input === "number") return input;
    if (input == null || input === "") return 0;

    let text = String(input).trim().replace(/[^\d.,-]/g, "");
    if (text === "") return 0;

    const hasComma = text.includes(",");
    const hasDot = text.includes(".");

    if (hasComma && hasDot) {
        // "1.234,56" -> dots are thousands, comma is the decimal separator
        text = text.replace(/\./g, "").replace(",", ".");
    } else if (hasComma) {
        // "1234,56" -> "1234.56"
        text = text.replace(",", ".");
    } else if (hasDot) {
        // Only dots: are they thousands separators or a decimal point?
        const groups = text.split(".");
        const lastGroup = groups[groups.length - 1];
        if (groups.length > 2 || lastGroup.length === 3) {
            text = text.replace(/\./g, ""); // "1.600" / "1.234.567" -> thousands
        }
        // "1.5" is left as a decimal
    }

    const value = parseFloat(text);
    return isNaN(value) ? 0 : value;
}

// Use the user's manual override when provided, otherwise the estimate.
function overrideOr(override, estimate) {
    return override !== "" && override != null ? +override : estimate;
}

/* ---------------- financial model ---------------- */

// Compute the full deal from the current state: expense breakdown,
// financing figures, profit, invested capital and ROI.
function calculateDeal() {
    const bid = +state.lance || 0;
    const salePrice = +state.venda || 0;
    const monthsHeld = +state.prazo || 0;

    // Sum every expense line. Sale commissions (% of sale) are tracked
    // separately because they are later excluded from invested capital.
    const expenseLines = [];
    let userExpensesTotal = 0;
    let saleCommissionsTotal = 0;
    for (const expense of state.despesas) {
        let amount = 0;
        switch (expense.tipo) {
            case "fixo":
                amount = +expense.valor || 0;
                break;
            case "mensal":
                amount = (+expense.valor || 0) * monthsHeld;
                break;
            case "pctLance":
                amount = (+expense.pct || 0) * bid;
                break;
            case "pctVenda":
                amount = (+expense.pct || 0) * salePrice;
                saleCommissionsTotal += amount;
                break;
        }
        userExpensesTotal += amount;
        expenseLines.push({ expense, amount });
    }

    // Financing: pay a down payment now, installments over the holding
    // period, and settle the remaining balance at sale.
    const isFinanced = !!state.financiado;
    const downPayment = isFinanced ? (+state.pctEntrada || 0) * bid : 0;
    const financedAmount = isFinanced ? Math.max(bid - downPayment, 0) : 0;
    const acquisitionCost = isFinanced ? downPayment : bid;

    const estimatedMonthlyPayment = financedAmount * ESTIMATED_INSTALLMENT_RATE;
    const estimatedOutstandingBalance =
        financedAmount * (1 - monthsHeld / FINANCING_TERM_MONTHS);

    const monthlyPayment = isFinanced
        ? overrideOr(state.parcelaOverride, estimatedMonthlyPayment)
        : 0;
    const outstandingBalance = isFinanced
        ? overrideOr(state.saldoOverride, estimatedOutstandingBalance)
        : 0;
    const totalInstallments = monthlyPayment * monthsHeld;

    // Profit waterfall.
    const totalExpenses = userExpensesTotal + totalInstallments;
    const grossProfit = salePrice - acquisitionCost - totalExpenses - outstandingBalance;
    const incomeTax = Math.max(grossProfit, 0) * (+state.aliquotaIR || 0);
    const netProfit = grossProfit - incomeTax;
    const investedCapital = acquisitionCost + totalExpenses - saleCommissionsTotal;
    const roi = investedCapital > 0 ? netProfit / investedCapital : 0;

    return {
        expenseLines,
        userExpensesTotal,
        totalExpenses,
        acquisitionCost,
        downPayment,
        financedAmount,
        monthlyPayment,
        estimatedMonthlyPayment,
        outstandingBalance,
        estimatedOutstandingBalance,
        totalInstallments,
        grossProfit,
        incomeTax,
        netProfit,
        investedCapital,
        roi,
        isFinanced,
        salePrice,
    };
}

/* ---------------- expenses table ---------------- */
const EXPENSE_TYPE_OPTIONS = [
    ["fixo", "Valor fixo"],
    ["mensal", "Mensal (× prazo)"],
    ["pctLance", "% do lance"],
    ["pctVenda", "% da venda"],
];

function isPercentType(type) {
    return type === "pctLance" || type === "pctVenda";
}

function renderExpenses() {
    const result = calculateDeal();
    const container = document.getElementById("despList");
    container.innerHTML = "";

    state.despesas.forEach((expense, index) => {
        const isPercent = isPercentType(expense.tipo);
        const line = result.expenseLines.find((l) => l.expense === expense);
        const computedAmount = line ? line.amount : 0;
        // Percent and monthly rows show what they resolve to in R$.
        const showComputed = isPercent || expense.tipo === "mensal";
        const valueField = isPercent ? "pct" : "valor";
        const displayValue = isPercent
            ? decimalFormatter.format((expense.pct || 0) * 100)
            : decimalFormatter.format(expense.valor || 0);

        const row = document.createElement("div");
        row.className = "desp-row";
        row.innerHTML = `
      <input value="${escapeAttr(expense.nome)}" data-di="${index}" data-df="nome" placeholder="Descrição">
      <select data-di="${index}" data-df="tipo">${EXPENSE_TYPE_OPTIONS.map(
          ([value, label]) =>
              `<option value="${value}" ${expense.tipo === value ? "selected" : ""}>${label}</option>`,
      ).join("")}</select>
      <div class="valwrap">
        ${isPercent ? "" : '<span class="aff l">R$</span>'}
        <input class="rowval ${isPercent ? "pct" : "money"}" inputmode="decimal" data-di="${index}" data-df="${valueField}"
          value="${displayValue}">
        ${isPercent ? '<span class="aff r">%</span>' : ""}
      </div>
      <button class="del" title="Remover" onclick="delDesp(${index})">×</button>
      ${showComputed ? `<div style="grid-column:1/-1" class="comp">${escapeHtml(expense.nome || "—")} = <span class="num">${formatBRL(computedAmount)}</span></div>` : ""}
    `;
        container.appendChild(row);
    });

    document.getElementById("despTotal").textContent = formatBRL(result.userExpensesTotal);
    bindExpenseInputs();
}

function bindExpenseInputs() {
    document.querySelectorAll("#despList [data-di]").forEach((element) => {
        const index = +element.dataset.di;
        const field = element.dataset.df;

        if (element.tagName === "SELECT") {
            element.onchange = () => {
                state.despesas[index].tipo = element.value;
                renderExpenses();
                save();
                renderOutput();
            };
        } else if (field === "nome") {
            element.oninput = () => {
                state.despesas[index].nome = element.value;
                save();
                renderOutput();
            };
        } else {
            element.oninput = () => {
                const value = parseNumber(element.value);
                if (field === "pct") state.despesas[index].pct = value / 100;
                else state.despesas[index].valor = value;
                save();
                renderOutput();

                // Update just this row's amount and the grand total in place —
                // re-rendering the whole list here would drop input focus.
                const result = calculateDeal();
                document.getElementById("despTotal").textContent = formatBRL(result.userExpensesTotal);
                const line = result.expenseLines.find((l) => l.expense === state.despesas[index]);
                const computedEl = element.closest(".desp-row").querySelector(".comp .num");
                if (computedEl && line) computedEl.textContent = formatBRL(line.amount);
            };
            element.onblur = () => {
                const expense = state.despesas[index];
                element.value =
                    field === "pct"
                        ? decimalFormatter.format((expense.pct || 0) * 100)
                        : decimalFormatter.format(expense.valor || 0);
            };
        }
    });
}

window.addDesp = function () {
    state.despesas.push({ id: createId(), nome: "", tipo: "fixo", valor: 0 });
    renderExpenses();
    save();
    renderOutput();
};

window.delDesp = function (index) {
    state.despesas.splice(index, 1);
    renderExpenses();
    save();
    renderOutput();
};

/* ---------------- output panel ---------------- */

function renderOutput() {
    const result = calculateDeal();
    renderHeaderSummary();
    renderVerdict(result);
    renderCascade(result);
    document.getElementById("vCapital").textContent = formatBRL(result.investedCapital);
    renderFinancingFields(result);
}

// The "type · city · auction date" line in the header.
function renderHeaderSummary() {
    const parts = [];
    if (state.tipo) parts.push(`<strong>${escapeHtml(state.tipo)}</strong>`);
    if (state.cidade) parts.push(escapeHtml(state.cidade));
    if (state.dataLeilao) parts.push("leilão " + formatDate(state.dataLeilao));
    document.getElementById("idline").innerHTML = parts.join(" · ");
}

// The VIÁVEL / INVIÁVEL stamp, ROI and margin against the target ROI.
function renderVerdict(result) {
    const top = document.getElementById("vTop");
    const stamp = document.getElementById("vStamp");
    const roiEl = document.getElementById("vRoi");
    const targetEl = document.getElementById("vTarget");
    const marginEl = document.getElementById("vMargin");

    targetEl.textContent = formatPercent(state.roiMin);

    const hasData = +state.lance > 0 && +state.venda > 0;
    if (!hasData) {
        top.className = "top neutral";
        stamp.innerHTML = "Aguardando dados";
        roiEl.textContent = "—";
        marginEl.textContent = "";
        return;
    }

    const meetsTarget = result.roi >= (+state.roiMin || 0);
    top.className = "top " + (meetsTarget ? "go" : "no");
    stamp.innerHTML = meetsTarget ? "●&nbsp; VIÁVEL" : "●&nbsp; INVIÁVEL";
    roiEl.textContent = formatPercent(result.roi);

    const marginOverTarget = result.roi - (+state.roiMin || 0);
    marginEl.innerHTML =
        (marginOverTarget >= 0 ? "+" : "") +
        (marginOverTarget * 100).toFixed(1) +
        " p.p. vs régua";
}

// The sale → costs → profit waterfall.
function renderCascade(result) {
    const rows = [];
    rows.push(cascadeRow("Valor de venda", formatBRL(result.salePrice), "", ""));
    rows.push(
        cascadeRow(
            result.isFinanced ? "Entrada" : "Lance",
            "− " + formatBRL(result.acquisitionCost),
            "minus",
            "",
        ),
    );
    rows.push(
        cascadeRow(
            "Total de despesas",
            "− " + formatBRL(result.totalExpenses),
            "minus",
            result.isFinanced ? `inclui ${formatBRL(result.totalInstallments)} de prestações` : "",
        ),
    );
    if (result.isFinanced) {
        rows.push(
            cascadeRow(
                "Saldo do financiamento",
                "− " + formatBRL(result.outstandingBalance),
                "minus",
                "quitado na venda",
            ),
        );
    }
    rows.push('<div class="rule strong"></div>');
    rows.push(cascadeResult("Lucro bruto", formatBRL(result.grossProfit), result.grossProfit >= 0));
    rows.push(
        cascadeRow(
            "Imposto de renda (est.)",
            "− " + formatBRL(result.incomeTax),
            "minus sub",
            formatPercent(state.aliquotaIR) + " sobre o lucro",
        ),
    );
    rows.push('<div class="rule"></div>');
    rows.push(cascadeResult("Lucro líquido", formatBRL(result.netProfit), result.netProfit >= 0));
    document.getElementById("cascade").innerHTML = rows.join("");
}

// The financing block: toggle state, financed amount, and the
// auto-estimated installment / balance hints.
function renderFinancingFields(result) {
    document.getElementById("finBlock").style.display = result.isFinanced ? "block" : "none";
    document.querySelector('#finseg [data-fin="0"]').classList.toggle("on", !result.isFinanced);
    document.querySelector('#finseg [data-fin="1"]').classList.toggle("on", result.isFinanced);
    if (!result.isFinanced) return;

    const financedField = document.getElementById("finVal");
    if (financedField) {
        financedField.value = formatBRL(result.financedAmount).replace("R$", "").trim();
    }
    document.getElementById("parcAuto").textContent =
        state.parcelaOverride !== "" ? "" : "· auto " + formatBRL(result.estimatedMonthlyPayment);
    document.getElementById("saldoAuto").textContent =
        state.saldoOverride !== "" ? "" : "· auto " + formatBRL(result.estimatedOutstandingBalance);
}

function cascadeRow(label, value, modifier, sub) {
    return `<div class="row ${modifier}"><span class="k">${label}${sub ? `<small>${sub}</small>` : ""}</span><span class="v num">${value}</span></div>`;
}

function cascadeResult(label, value, positive) {
    return `<div class="row result ${positive ? "pos" : "neg"}"><span class="k">${label}</span><span class="v num">${value}</span></div>`;
}

function formatPercent(fraction) {
    return ((+fraction || 0) * 100).toFixed(1).replace(".", ",") + "%";
}

/* ---------------- main form bindings ---------------- */

function bindMainInputs() {
    document.querySelectorAll("[data-k]").forEach((element) => {
        const key = element.dataset.k;
        const format = element.dataset.fmt;

        // Populate the field from state in the format it expects.
        if (element.type === "date" || element.tagName === "SELECT") {
            element.value = state[key] || "";
        } else if (format === "money" || format === "plain") {
            element.value = state[key] ? decimalFormatter.format(state[key]) : "";
        } else if (format === "pct") {
            element.value =
                state[key] !== "" && state[key] != null ? decimalFormatter.format(+state[key] * 100) : "";
        } else {
            element.value = state[key] || "";
        }

        const handleChange = () => {
            if (format === "money" || format === "plain") state[key] = parseNumber(element.value);
            else if (format === "pct") state[key] = parseNumber(element.value) / 100;
            else state[key] = element.value;
            save();
            renderOutput();
            // Bid, sale price and holding period feed the per-expense
            // computations, so the expense list must be refreshed too.
            if (key === "lance" || key === "venda" || key === "prazo") {
                renderExpenses();
            }
        };

        if (element.tagName === "SELECT" || element.type === "date") {
            element.onchange = handleChange;
        } else {
            element.oninput = handleChange;
            // Reformat the number once the user leaves the field.
            if (format === "money" || format === "plain") {
                element.onblur = () => {
                    element.value = state[key] ? decimalFormatter.format(state[key]) : "";
                };
            } else if (format === "pct") {
                element.onblur = () => {
                    element.value =
                        state[key] !== "" && state[key] != null
                            ? decimalFormatter.format(+state[key] * 100)
                            : "";
                };
            }
        }
    });

    // Cash vs financed toggle.
    document.querySelectorAll("#finseg button").forEach((button) => {
        button.onclick = () => {
            state.financiado = +button.dataset.fin;
            save();
            renderOutput();
            renderExpenses();
        };
    });
}

/* ---------------- persistence ---------------- */

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
}

function loadStoredState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

window.resetAll = function () {
    if (confirm("Limpar tudo e começar uma nova análise?")) {
        state = createDefaultState();
        save();
        boot();
    }
};

window.exportJSON = function () {
    const fileName =
        (state.tipo || "analise") + "_" + (state.cidade || "").replace(/\W+/g, "") + ".json";
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName.replace(/^_+/, "");
    link.click();
};

window.importJSON = function (event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            state = Object.assign(createDefaultState(), JSON.parse(reader.result));
            if (!Array.isArray(state.despesas) || !state.despesas.length) {
                state.despesas = createDefaultExpenses();
            }
            save();
            boot();
        } catch (e) {
            alert("Arquivo inválido.");
        }
    };
    reader.readAsText(file);
    event.target.value = "";
};

/* ---------------- helpers ---------------- */

function escapeHtml(value) {
    return String(value || "").replace(
        /[&<>"]/g,
        (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
    );
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
}

// "2026-07-20" -> "20/07/2026"
function formatDate(isoDate) {
    try {
        const [year, month, day] = isoDate.split("-");
        return `${day}/${month}/${year}`;
    } catch (e) {
        return isoDate;
    }
}

/* ---------------- bootstrap ---------------- */

function boot() {
    bindMainInputs();
    renderExpenses();
    renderOutput();
}

boot();
