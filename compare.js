import { mountNav } from "./shared/nav.js";
import { trussDetailUrl } from "./shared/truss-links.js";

mountNav("compare");

const summaryCards = document.getElementById("summary-cards");
const bomBody = document.getElementById("bom-body");
const miscGrid = document.getElementById("misc-grid");
const searchInput = document.getElementById("search");
const filterDiff = document.getElementById("filter-diff");

let bomData = null;

const response = await fetch("/data/bom-comparison.json");
if (!response.ok) {
  summaryCards.innerHTML = `<p class="error">BOM data not found. Run <code>npm run build-data</code> first.</p>`;
} else {
  bomData = await response.json();
  renderSummary(bomData.totals);
  renderMisc(bomData.misc);
  renderTable();
}

searchInput?.addEventListener("input", renderTable);
filterDiff?.addEventListener("change", renderTable);

document.getElementById("btn-export")?.addEventListener("click", exportCsv);

function renderSummary(totals) {
  const cards = [
    { label: "MiTek Trusses", value: totals.mitekTrusses, tone: "mitek" },
    { label: "Simpson Trusses", value: totals.simpsonTrusses, tone: "simpson" },
    { label: "Designs Compared", value: totals.designs, tone: "neutral" },
    { label: "Exact Matches", value: totals.matches, tone: "ok" },
    { label: "Differences", value: totals.differences, tone: "warn" },
  ];

  summaryCards.replaceChildren(
    ...cards.map((card) => {
      const el = document.createElement("article");
      el.className = `summary-card ${card.tone}`;
      el.innerHTML = `<div class="summary-value">${card.value}</div><div class="summary-label">${card.label}</div>`;
      return el;
    }),
  );
}

function renderMisc(misc) {
  miscGrid.replaceChildren(
    ...misc.map((item) => {
      const el = document.createElement("div");
      el.className = "misc-item";
      el.innerHTML = `<strong>${item.mark}</strong><span>Qty ${item.quantity}</span>`;
      return el;
    }),
  );
}

function renderTable() {
  if (!bomData) {
    return;
  }

  const query = searchInput?.value.trim().toUpperCase() ?? "";
  const diffOnly = filterDiff?.checked ?? false;

  const rows = bomData.rows.filter((row) => {
    if (query && !row.mark.includes(query)) {
      return false;
    }
    if (diffOnly && row.status === "match") {
      return false;
    }
    return true;
  });

  bomBody.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement("tr");
      tr.className = `status-${row.status}`;
      tr.innerHTML = `
        <td><a class="mark-link" href="${trussDetailUrl(row.mark)}"><strong>${row.mark}</strong></a></td>
        <td>${formatCell(row.mitekQty)}</td>
        <td>${formatCell(row.mitekPly)}</td>
        <td>${formatCell(row.mitekSpan)}</td>
        <td>${formatCell(row.simpsonQty)}</td>
        <td>${formatCell(row.simpsonPly)}</td>
        <td>${formatCell(row.simpsonSpan)}</td>
        <td>${formatCell(row.simpsonSpacing)}</td>
        <td>${statusLabel(row.status)}</td>
      `;
      return tr;
    }),
  );
}

function formatCell(value) {
  return value == null || value === "" ? "—" : value;
}

function statusLabel(status) {
  const labels = {
    match: "Match",
    "qty-diff": "Qty differs",
    "ply-diff": "Ply differs",
    missing: "Missing source",
  };
  return labels[status] ?? status;
}

function exportCsv() {
  if (!bomData) {
    return;
  }

  const header = [
    "Mark",
    "MiTek Qty",
    "MiTek Ply",
    "MiTek Span",
    "Simpson Qty",
    "Simpson Ply",
    "Simpson Span",
    "Spacing",
    "Status",
  ];

  const lines = [
    header.join(","),
    ...bomData.rows.map((row) =>
      [
        row.mark,
        row.mitekQty ?? "",
        row.mitekPly ?? "",
        csvEscape(row.mitekSpan),
        row.simpsonQty ?? "",
        row.simpsonPly ?? "",
        csvEscape(row.simpsonSpan),
        csvEscape(row.simpsonSpacing),
        row.status,
      ].join(","),
    ),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "plan193-bom-comparison.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  if (value == null) {
    return "";
  }
  const text = String(value);
  if (text.includes(",") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
