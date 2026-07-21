"use strict";

/* ---------------- estado ---------------- */
const DEFAULT_DESP = () => [
    { id: uid(), nome: "ITBI", tipo: "pctLance", pct: 0.02 },
    { id: uid(), nome: "Registro", tipo: "fixo", valor: 1600 },
    {
        id: uid(),
        nome: "Emolumentos / carta de arremat.",
        tipo: "fixo",
        valor: 2700,
    },
    {
        id: uid(),
        nome: "Comissão do leiloeiro",
        tipo: "pctLance",
        pct: 0.05,
    },
    { id: uid(), nome: "Reforma", tipo: "fixo", valor: 5000 },
    { id: uid(), nome: "IPTU", tipo: "mensal", valor: 30 },
    { id: uid(), nome: "Condomínio", tipo: "mensal", valor: 300 },
    {
        id: uid(),
        nome: "Comissão de venda (corretor)",
        tipo: "pctVenda",
        pct: 0.05,
    },
    { id: uid(), nome: "Advogado", tipo: "fixo", valor: 7000 },
    {
        id: uid(),
        nome: "Dívidas até a arrematação (IPTU/cond.)",
        tipo: "fixo",
        valor: 20000,
    },
];

const DEFAULT_STATE = () => ({
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
    despesas: DEFAULT_DESP(),
});

let S = load() || DEFAULT_STATE();

/* ---------------- utils ---------------- */
function uid() {
    return "d" + Math.random().toString(36).slice(2, 9);
}
const nf = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
});
const nf2 = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});
const brl = (n) => nf.format(isFinite(n) ? n : 0);
function parseNum(str) {
    if (typeof str === "number") return str;
    if (str == null || str === "") return 0;
    let s = String(str)
        .trim()
        .replace(/[^\d.,-]/g, "");
    if (s === "") return 0;
    const hasComma = s.indexOf(",") > -1,
        hasDot = s.indexOf(".") > -1;
    if (hasComma && hasDot)
        s = s.replace(/\./g, "").replace(",", "."); // 1.234,56 -> 1234.56
    else if (hasComma)
        s = s.replace(",", "."); // 1234,56 -> 1234.56
    else if (hasDot) {
        // só ponto: milhar ou decimal?
        const parts = s.split(".");
        const last = parts[parts.length - 1];
        if (parts.length > 2 || last.length === 3) s = s.replace(/\./g, ""); // 1.600 / 1.234.567 -> milhar
    } // 1.5 permanece decimal
    const v = parseFloat(s);
    return isNaN(v) ? 0 : v;
}

/* ---------------- modelo financeiro ---------------- */
function compute() {
    const lance = +S.lance || 0,
        venda = +S.venda || 0,
        prazo = +S.prazo || 0;
    let totalUser = 0,
        pctVendaTotal = 0;
    const lines = [];
    for (const d of S.despesas) {
        let v = 0;
        if (d.tipo === "fixo") v = +d.valor || 0;
        else if (d.tipo === "mensal") v = (+d.valor || 0) * prazo;
        else if (d.tipo === "pctLance") v = (+d.pct || 0) * lance;
        else if (d.tipo === "pctVenda") {
            v = (+d.pct || 0) * venda;
            pctVendaTotal += v;
        }
        totalUser += v;
        lines.push({ d, v });
    }
    const fin = !!S.financiado;
    const entrada = fin ? (+S.pctEntrada || 0) * lance : 0;
    const financiadoVal = fin ? Math.max(lance - entrada, 0) : 0;
    const aquisicao = fin ? entrada : lance;
    const parcelaAuto = financiadoVal * 0.0097;
    const saldoAuto = financiadoVal * (1 - 0.0023809375 * prazo);
    const parcela = fin
        ? S.parcelaOverride !== "" && S.parcelaOverride != null
            ? +S.parcelaOverride
            : parcelaAuto
        : 0;
    const saldo = fin
        ? S.saldoOverride !== "" && S.saldoOverride != null
            ? +S.saldoOverride
            : saldoAuto
        : 0;
    const prestacoes = parcela * prazo;

    const totalDespesas = totalUser + prestacoes;
    const lucroBruto = venda - aquisicao - totalDespesas - saldo;
    const ir = Math.max(lucroBruto, 0) * (+S.aliquotaIR || 0);
    const lucroLiquido = lucroBruto - ir;
    const capitalInvestido = aquisicao + totalDespesas - pctVendaTotal;
    const roi = capitalInvestido > 0 ? lucroLiquido / capitalInvestido : 0;

    return {
        lines,
        totalUser,
        totalDespesas,
        aquisicao,
        entrada,
        financiadoVal,
        parcela,
        parcelaAuto,
        saldo,
        saldoAuto,
        prestacoes,
        lucroBruto,
        ir,
        lucroLiquido,
        capitalInvestido,
        roi,
        fin,
        venda,
    };
}

/* ---------------- render ---------------- */
const TIPOS = [
    ["fixo", "Valor fixo"],
    ["mensal", "Mensal (× prazo)"],
    ["pctLance", "% do lance"],
    ["pctVenda", "% da venda"],
];

function renderDesp() {
    const R = compute();
    const wrap = document.getElementById("despList");
    wrap.innerHTML = "";
    S.despesas.forEach((d, i) => {
        const row = document.createElement("div");
        row.className = "desp-row";
        const isPct = d.tipo === "pctLance" || d.tipo === "pctVenda";
        const line = R.lines.find((l) => l.d === d);
        const comp = line ? line.v : 0;
        const showComp = isPct || d.tipo === "mensal";
        row.innerHTML = `
      <input value="${escapeAttr(d.nome)}" data-di="${i}" data-df="nome" placeholder="Descrição">
      <select data-di="${i}" data-df="tipo">${TIPOS.map((t) => `<option value="${t[0]}" ${d.tipo === t[0] ? "selected" : ""}>${t[1]}</option>`).join("")}</select>
      <div class="valwrap">
        ${isPct ? "" : '<span class="aff l">R$</span>'}
        <input class="rowval ${isPct ? "pct" : "money"}" inputmode="decimal" data-di="${i}" data-df="${isPct ? "pct" : "valor"}"
          value="${isPct ? nf2.format((d.pct || 0) * 100) : nf2.format(d.valor || 0)}">
        ${isPct ? '<span class="aff r">%</span>' : ""}
      </div>
      <button class="del" title="Remover" onclick="delDesp(${i})">×</button>
      ${showComp ? `<div style="grid-column:1/-1" class="comp">${escapeHtml(d.nome || "—")} = <span class="num">${brl(comp)}</span></div>` : ""}
    `;
        wrap.appendChild(row);
    });
    document.getElementById("despTotal").textContent = brl(R.totalUser);
    bindDespInputs();
}

function bindDespInputs() {
    document.querySelectorAll("#despList [data-di]").forEach((el) => {
        const i = +el.dataset.di,
            f = el.dataset.df;
        if (el.tagName === "SELECT") {
            el.onchange = () => {
                S.despesas[i].tipo = el.value;
                renderDesp();
                save();
                renderOut();
            };
        } else if (f === "nome") {
            el.oninput = () => {
                S.despesas[i].nome = el.value;
                save();
                renderOut();
            };
        } else {
            el.oninput = () => {
                const v = parseNum(el.value);
                if (f === "pct") S.despesas[i].pct = v / 100;
                else S.despesas[i].valor = v;
                save();
                renderOut();
                const R = compute();
                document.getElementById("despTotal").textContent = brl(
                    R.totalUser,
                );
                const line = R.lines.find((l) => l.d === S.despesas[i]);
                const comp = el.closest(".desp-row").querySelector(".comp .num");
                if (comp && line) comp.textContent = brl(line.v);
            };
            el.onblur = () => {
                const d = S.despesas[i];
                el.value =
                    f === "pct"
                        ? nf2.format((d.pct || 0) * 100)
                        : nf2.format(d.valor || 0);
            };
        }
    });
}

window.addDesp = function () {
    S.despesas.push({ id: uid(), nome: "", tipo: "fixo", valor: 0 });
    renderDesp();
    save();
    renderOut();
};
window.delDesp = function (i) {
    S.despesas.splice(i, 1);
    renderDesp();
    save();
    renderOut();
};

function renderOut() {
    const R = compute();
    // id line
    const parts = [];
    if (S.tipo) parts.push(`<strong>${escapeHtml(S.tipo)}</strong>`);
    if (S.cidade) parts.push(escapeHtml(S.cidade));
    if (S.dataLeilao) parts.push("leilão " + fmtDate(S.dataLeilao));
    document.getElementById("idline").innerHTML = parts.join(" · ");

    // verdict
    const hasData = +S.lance > 0 && +S.venda > 0;
    const top = document.getElementById("vTop"),
        stamp = document.getElementById("vStamp");
    const roiEl = document.getElementById("vRoi"),
        tgt = document.getElementById("vTarget"),
        mg = document.getElementById("vMargin");
    tgt.textContent = pct(S.roiMin);
    if (!hasData) {
        top.className = "top neutral";
        stamp.innerHTML = "Aguardando dados";
        roiEl.textContent = "—";
        mg.textContent = "";
    } else {
        const go = R.roi >= (+S.roiMin || 0);
        top.className = "top " + (go ? "go" : "no");
        stamp.innerHTML = go ? "●&nbsp; VIÁVEL" : "●&nbsp; INVIÁVEL";
        roiEl.textContent = pct(R.roi);
        const diff = R.roi - (+S.roiMin || 0);
        mg.innerHTML =
            (diff >= 0 ? "+" : "") + (diff * 100).toFixed(1) + " p.p. vs régua";
    }

    // cascade
    const c = document.getElementById("cascade");
    const rows = [];
    rows.push(cRow("Valor de venda", brl(R.venda), "", ""));
    rows.push(
        cRow(
            R.fin ? "Entrada" : "Lance",
            "− " + brl(R.aquisicao),
            "minus",
            "",
        ),
    );
    rows.push(
        cRow(
            "Total de despesas",
            "− " + brl(R.totalDespesas),
            "minus",
            R.fin ? `inclui ${brl(R.prestacoes)} de prestações` : "",
        ),
    );
    if (R.fin)
        rows.push(
            cRow(
                "Saldo do financiamento",
                "− " + brl(R.saldo),
                "minus",
                "quitado na venda",
            ),
        );
    rows.push('<div class="rule strong"></div>');
    rows.push(cResult("Lucro bruto", brl(R.lucroBruto), R.lucroBruto >= 0));
    rows.push(
        cRow(
            "Imposto de renda (est.)",
            "− " + brl(R.ir),
            "minus sub",
            pct(S.aliquotaIR) + " sobre o lucro",
        ),
    );
    rows.push('<div class="rule"></div>');
    rows.push(
        cResult("Lucro líquido", brl(R.lucroLiquido), R.lucroLiquido >= 0),
    );
    c.innerHTML = rows.join("");

    document.getElementById("vCapital").textContent = brl(
        R.capitalInvestido,
    );

    // financiamento fields
    document.getElementById("finBlock").style.display = R.fin
        ? "block"
        : "none";
    document
        .querySelector('#finseg [data-fin="0"]')
        .classList.toggle("on", !R.fin);
    document
        .querySelector('#finseg [data-fin="1"]')
        .classList.toggle("on", R.fin);
    if (R.fin) {
        const fv = document.getElementById("finVal");
        if (fv) fv.value = brl(R.financiadoVal).replace("R$", "").trim();
        document.getElementById("parcAuto").textContent =
            S.parcelaOverride !== "" ? "" : "· auto " + brl(R.parcelaAuto);
        document.getElementById("saldoAuto").textContent =
            S.saldoOverride !== "" ? "" : "· auto " + brl(R.saldoAuto);
    }
}

function cRow(k, v, cls, sub) {
    return `<div class="row ${cls}"><span class="k">${k}${sub ? `<small>${sub}</small>` : ""}</span><span class="v num">${v}</span></div>`;
}
function cResult(k, v, pos) {
    return `<div class="row result ${pos ? "pos" : "neg"}"><span class="k">${k}</span><span class="v num">${v}</span></div>`;
}
function pct(f) {
    return ((+f || 0) * 100).toFixed(1).replace(".", ",") + "%";
}

/* ---------------- bindings ---------------- */
function bindMain() {
    document.querySelectorAll("[data-k]").forEach((el) => {
        const k = el.dataset.k,
            fmt = el.dataset.fmt;
        // init value
        if (el.type === "date") {
            el.value = S[k] || "";
        } else if (el.tagName === "SELECT") {
            el.value = S[k] || "";
        } else if (fmt === "money" || fmt === "plain") {
            el.value = S[k] ? nf2.format(S[k]) : "";
        } else if (fmt === "pct") {
            el.value =
                S[k] !== "" && S[k] != null ? nf2.format(+S[k] * 100) : "";
        } else {
            el.value = S[k] || "";
        }

        const handler = () => {
            if (fmt === "money" || fmt === "plain") S[k] = parseNum(el.value);
            else if (fmt === "pct") S[k] = parseNum(el.value) / 100;
            else S[k] = el.value;
            save();
            renderOut();
            if (k === "lance" || k === "venda" || k === "prazo") {
                renderDesp();
            }
        };
        if (el.tagName === "SELECT" || el.type === "date")
            el.onchange = handler;
        else {
            el.oninput = handler;
            if (fmt === "money" || fmt === "plain")
                el.onblur = () => {
                    el.value = S[k] ? nf2.format(S[k]) : "";
                };
            if (fmt === "pct")
                el.onblur = () => {
                    el.value =
                        S[k] !== "" && S[k] != null ? nf2.format(+S[k] * 100) : "";
                };
        }
    });
    document.querySelectorAll("#finseg button").forEach((b) => {
        b.onclick = () => {
            S.financiado = +b.dataset.fin;
            save();
            renderOut();
            renderDesp();
        };
    });
}

/* ---------------- persistência ---------------- */
const KEY = "viab_leilao_v1";
function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify(S));
    } catch (e) { }
}
function load() {
    try {
        const r = localStorage.getItem(KEY);
        return r ? JSON.parse(r) : null;
    } catch (e) {
        return null;
    }
}
window.resetAll = function () {
    if (confirm("Limpar tudo e começar uma nova análise?")) {
        S = DEFAULT_STATE();
        save();
        boot();
    }
};
window.exportJSON = function () {
    const name =
        (S.tipo || "analise") +
        "_" +
        (S.cidade || "").replace(/\W+/g, "") +
        ".json";
    const blob = new Blob([JSON.stringify(S, null, 2)], {
        type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/^_+/, "");
    a.click();
};
window.importJSON = function (ev) {
    const f = ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
        try {
            S = Object.assign(DEFAULT_STATE(), JSON.parse(r.result));
            if (!Array.isArray(S.despesas) || !S.despesas.length)
                S.despesas = DEFAULT_DESP();
            save();
            boot();
        } catch (e) {
            alert("Arquivo inválido.");
        }
    };
    r.readAsText(f);
    ev.target.value = "";
};

/* ---------------- helpers ---------------- */
function escapeHtml(s) {
    return String(s || "").replace(
        /[&<>"]/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m],
    );
}

function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
}

function fmtDate(s) {
    try {
        const [y, m, d] = s.split("-");
        return `${d}/${m}/${y}`;
    } catch (e) {
        return s;
    }
}

function boot() {
    bindMain();
    renderDesp();
    renderOut();
}
boot();