# Viabilidade de Leilão — Auction Property Viability Calculator

A single-file, dependency-free web app that answers one question honestly: **is this auction property worth the bid?**

You describe the opportunity, your buy/sell thesis, the payment method (cash or financed) and every expense involved, and the app returns the **net profit, invested capital and ROI**, stamping a **VIÁVEL / INVIÁVEL** (viable / not viable) verdict against the minimum ROI you set.

> The interface is in **Portuguese (pt-BR)**, aimed at investors in the Brazilian real-estate auction (*leilão*) market. The code, this README and the internals are documented in English.

---

## Highlights

- **No build, no dependencies, no backend.** The whole app is one `index.html` file. No network calls.
- **Everything counts.** Add unlimited expense lines; every one flows into the total — no silent leaks.
- **Live verdict.** Net profit, invested capital and ROI recalculate on every keystroke, with a viable / not-viable stamp against your target ROI.
- **Cash & financed modes.** Installment and outstanding balance are estimated and can be overridden with the bank's real numbers.
- **Your data stays local.** Everything is stored in the browser (`localStorage`). Nothing leaves the machine.
- **Save & export.** Export the analysis to PDF or to a `.json` file per property.

---

## Run it locally

Because the app is a single static HTML file, running it on your PC takes seconds. Pick whichever option fits you.

First, get the code:

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
```

### Option 1 — Just open the file (simplest)

Double-click `index.html`, or open it from your browser with **File → Open**. That's it — the app runs entirely in the browser.

> If your browser restricts `localStorage` on `file://` URLs (so your data doesn't persist between refreshes), use Option 2 instead.

### Option 2 — Serve it locally (recommended)

Serving over `http://localhost` behaves exactly like the hosted version and guarantees that saving/persistence works. Use any one of these:

**With Python (already installed on macOS/Linux; on Windows install from python.org):**
```bash
# macOS / Linux
python3 -m http.server 8000

# Windows
py -m http.server 8000
```
Then open **http://localhost:8000** in your browser.

**With Node.js:**
```bash
npx serve .
# or
npx http-server -p 8000
```

**With VS Code:** install the *Live Server* extension, right-click `index.html` → **Open with Live Server**.

### Option 3 — Docker

```bash
docker build -t viabilidade-leilao .
docker run -d -p 8080:80 --name viab viabilidade-leilao
```
Then open **http://localhost:8080**. Stop it with `docker rm -f viab`.

---

## How the calculation works

All values recalculate in real time.

| Result | Formula |
|---|---|
| Acquisition | `financed ? downPayment : bid` |
| Installment | override, or `financedAmount × 0.0097` *(estimate)* |
| Outstanding balance | override, or `financedAmount × (1 − months/420)` *(linear amortization)* |
| **Total expenses** | `Σ(all expense lines) + installments` |
| **Gross profit** | `salePrice − acquisition − totalExpenses − outstandingBalance` |
| Income tax (est.) | `taxRate × max(grossProfit, 0)` |
| **Net profit** | `grossProfit − incomeTax` |
| **Invested capital** | `acquisition + totalExpenses − sale commissions` |
| **ROI** | `netProfit ÷ investedCapital` |
| Verdict | `ROI ≥ minimumROI ? VIÁVEL : INVIÁVEL` |

Each expense line is one of four types: **fixed** amount, **monthly** (× months held), **% of the bid**, or **% of the sale price**. These four cover every cost in an auction deal.

> **Income tax is a screening estimate**, not a tax filing. Capital gains on resale follow their own rules in Brazil — confirm with an accountant before deciding. Financing figures are approximations you can override.

---

## Project structure

```
.
├── index.html    # the entire application (HTML + CSS + JS)
├── Dockerfile    # optional: serve the file via nginx
└── README.md
```

## Tech

Vanilla JavaScript, HTML and CSS. No framework, no build step, no runtime dependencies. Persistence via the browser's `localStorage`. Numbers formatted with `Intl.NumberFormat` (pt-BR / BRL).

## Privacy

There is no backend and no telemetry. Every analysis lives in the browser where it was typed. Nothing is uploaded anywhere.

## License

MIT. Add a `LICENSE` file to the repo if you want it explicit.
