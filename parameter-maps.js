import { mountNav } from "./shared/nav.js";
import { parseCsv } from "./shared/parse-csv.js";

mountNav("param-maps");

const markSelect = document.getElementById("pm-mark-select");
const filledOnly = document.getElementById("pm-filled-only");
const summaryEl = document.getElementById("pm-summary");
const thead = document.getElementById("pm-thead");
const tbody = document.getElementById("pm-tbody");
const rowCountEl = document.getElementById("pm-row-count");
const rawCsvEl = document.getElementById("pm-raw-csv");
const apiJsonEl = document.getElementById("pm-api-json");
const panelTable = document.getElementById("pm-panel-table");
const panelRaw = document.getElementById("pm-panel-raw");
const panelApi = document.getElementById("pm-panel-api");
const tabTable = document.getElementById("pm-tab-table");
const tabRaw = document.getElementById("pm-tab-raw");
const tabApi = document.getElementById("pm-tab-api");

let treMapIndex = null;
let currentMark = null;
let currentCsvText = "";
let currentJson = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rowHasValue(cells) {
  return [cells[1], cells[2], cells[3]].some((cell) => String(cell ?? "").trim());
}

function renderTableRows(rows, showFilledOnly) {
  const header = rows[0] ?? [];
  thead.innerHTML = `<tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr>`;

  const bodyRows = rows.slice(1).filter((cells) => {
    if (showFilledOnly) {
      return rowHasValue(cells);
    }
    return cells.some((cell) => String(cell ?? "").trim());
  });

  tbody.replaceChildren(
    ...bodyRows.map((cells) => {
      const tr = document.createElement("tr");
      const label = cells[0]?.trim() ?? "";

      if (rowHasValue(cells)) {
        tr.className = "pm-filled-row";
      } else if (!label) {
        tr.className = "pm-spacer-row";
      }

      tr.innerHTML = cells
        .map((cell, index) => {
          const text = cell ?? "";
          if (index === 0 && label) {
            return `<td class="pm-param">${escapeHtml(text)}</td>`;
          }
          if (index >= 1 && text.trim()) {
            const isYes = text.trim().toLowerCase() === "yes";
            return `<td class="pm-value">${isYes ? `<span class="pm-yes">${escapeHtml(text)}</span>` : `<strong>${escapeHtml(text)}</strong>`}</td>`;
          }
          return `<td>${escapeHtml(text)}</td>`;
        })
        .join("");

      return tr;
    }),
  );

  rowCountEl.textContent = `${bodyRows.length} rows shown (${rows.length - 1} total)`;
}

function setActiveTab(tab) {
  panelTable.classList.toggle("hidden", tab !== "table");
  panelRaw.classList.toggle("hidden", tab !== "raw");
  panelApi.classList.toggle("hidden", tab !== "api");
  tabTable.classList.toggle("active", tab === "table");
  tabRaw.classList.toggle("active", tab === "raw");
  tabApi.classList.toggle("active", tab === "api");
}

async function loadMark(mark) {
  if (!mark) return;

  currentMark = mark;
  const [csvResponse, jsonResponse] = await Promise.all([
    fetch(`/data/parameter-maps/${mark}.csv`),
    fetch(`/data/parameter-maps/${mark}.json`),
  ]);

  if (!csvResponse.ok) {
    summaryEl.textContent = `Missing CSV for ${mark}. Run npm run build-data first.`;
    tbody.replaceChildren();
    return;
  }

  currentCsvText = await csvResponse.text();
  currentJson = jsonResponse.ok ? await jsonResponse.json() : null;

  const meta = treMapIndex?.maps?.[mark];
  summaryEl.textContent = [
    mark,
    currentJson?.treFile,
    currentJson?.trussType,
    currentJson?.role ? `${currentJson.role} member` : null,
    currentJson?.suggestedConnection
      ? `suggested: ${currentJson.suggestedConnection} (pick Joist / Truss / Multi in Simpson HS)`
      : null,
    meta?.download != null ? `download ${meta.download} lb` : null,
    meta?.uplift != null ? `uplift ${meta.uplift} lb` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  rawCsvEl.textContent = currentCsvText;
  apiJsonEl.textContent = JSON.stringify(currentJson?.apiBodies ?? {}, null, 2);
  renderTableRows(parseCsv(currentCsvText), filledOnly.checked);

  const url = new URL(window.location.href);
  url.searchParams.set("mark", mark);
  history.replaceState(null, "", url);
}

async function init() {
  const indexResponse = await fetch("/data/parameter-maps/index.json");
  if (!indexResponse.ok) {
    summaryEl.textContent = "No parameter maps found. Run: cd viewer && npm run build-data";
    return;
  }

  treMapIndex = await indexResponse.json();
  markSelect.replaceChildren(
    ...treMapIndex.marks.map((mark) => {
      const option = document.createElement("option");
      option.value = mark;
      const meta = treMapIndex.maps[mark];
      option.textContent = `${mark} — ${meta.trussType} (suggested: ${meta.suggestedConnection})`;
      return option;
    }),
  );

  const requestedMark = new URLSearchParams(window.location.search).get("mark")?.toUpperCase();
  const initialMark = treMapIndex.marks.includes(requestedMark) ? requestedMark : treMapIndex.marks[0];
  markSelect.value = initialMark;
  await loadMark(initialMark);
}

markSelect.addEventListener("change", () => loadMark(markSelect.value));
filledOnly.addEventListener("change", () => {
  if (currentCsvText) {
    renderTableRows(parseCsv(currentCsvText), filledOnly.checked);
  }
});

tabTable.addEventListener("click", () => setActiveTab("table"));
tabRaw.addEventListener("click", () => setActiveTab("raw"));
tabApi.addEventListener("click", () => setActiveTab("api"));

document.getElementById("pm-copy-csv")?.addEventListener("click", async () => {
  if (currentCsvText) await navigator.clipboard.writeText(currentCsvText);
});

document.getElementById("pm-download-csv")?.addEventListener("click", () => {
  if (!currentCsvText || !currentMark) return;
  const blob = new Blob([currentCsvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${currentMark}-Parameters-Map.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
});

init();
