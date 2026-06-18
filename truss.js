import { mountNav } from "./shared/nav.js";
import {
  cellDiffClass,
  compareTrussMark,
  loadTrussSources,
  splitCompareUrl,
  trussDetailUrl,
  viewerUrl,
} from "./shared/truss-links.js";

mountNav("compare");

const pageTitle = document.getElementById("page-title");
const markSelect = document.getElementById("mark-select");
const compareStatus = document.getElementById("compare-status");
const compareBody = document.getElementById("compare-body");
const mitekDetail = document.getElementById("mitek-detail");
const simpsonDetail = document.getElementById("simpson-detail");
const btnViewMitek = document.getElementById("btn-view-mitek");
const btnViewSimpson = document.getElementById("btn-view-simpson");

let sources = null;

try {
  sources = await loadTrussSources();
  markSelect.replaceChildren(
    ...sources.marks.map((mark) => {
      const option = document.createElement("option");
      option.value = mark;
      option.textContent = mark;
      return option;
    }),
  );
} catch (error) {
  compareStatus.innerHTML = `<p class="error">${error.message}</p>`;
}

const initialMark = new URLSearchParams(window.location.search).get("mark")?.toUpperCase()
  ?? sources?.marks[0]
  ?? "T01";

if (markSelect) {
  markSelect.value = initialMark;
  markSelect.addEventListener("change", () => {
    const mark = markSelect.value;
    history.replaceState(null, "", trussDetailUrl(mark));
    renderMark(mark);
  });
}

renderMark(initialMark);

function renderMark(mark) {
  if (!sources) {
    return;
  }

  const data = compareTrussMark(mark, sources);
  pageTitle.textContent = `Truss ${data.mark}`;

  btnViewMitek.href = viewerUrl({ mark: data.mark, model: "/models/mitek.ifc" });
  btnViewSimpson.href = viewerUrl({ mark: data.mark, model: "/models/simpson.ifc" });
  document.getElementById("btn-split").href = splitCompareUrl(data.mark);

  const status = data.bom?.status ?? "unknown";
  const statusLabels = {
    match: "Exact match between MiTek and Simpson schedules",
    "qty-diff": "Quantity differs — check 2-ply girder counting",
    "ply-diff": "Ply count differs between sources",
    missing: "Missing in one source",
    unknown: "Comparison status unavailable",
  };
  compareStatus.className = `compare-banner status-${status}`;
  compareStatus.textContent = statusLabels[status] ?? statusLabels.unknown;

  compareBody.replaceChildren(
    ...data.rows.map((row) => {
      const tr = document.createElement("tr");
      const diff = cellDiffClass(row.mitek, row.simpson);
      tr.innerHTML = `
        <td>${row.label}</td>
        <td class="mitek-col ${diff}">${formatValue(row.mitek)}</td>
        <td class="simpson-col ${diff}">${formatValue(row.simpson)}</td>
      `;
      return tr;
    }),
  );

  renderMitekPanel(data.mitek);
  renderSimpsonPanel(data.simpson, data.mark);
}

function formatValue(value) {
  return value == null || value === "" ? "—" : value;
}

function renderMitekPanel(truss) {
  if (!truss) {
    mitekDetail.innerHTML = `<p class="muted">No MiTek TRE data for this mark.</p>`;
    return;
  }

  const members = (truss.members ?? [])
    .map(
      (member) =>
        `<tr><td>${member.label}</td><td>${member.size}</td><td>${member.grade}</td><td>${member.length}</td></tr>`,
    )
    .join("");

  mitekDetail.innerHTML = `
    <dl class="job-dl compact-dl">
      <dt>File</dt><dd>${truss.file}</dd>
      <dt>Overhangs</dt><dd>${truss.overhangLeft ?? "—"} / ${truss.overhangRight ?? "—"}</dd>
      <dt>Lumber</dt><dd>${truss.topChordLumber ?? "—"}</dd>
      <dt>Board Feet</dt><dd>${truss.engineering?.boardFeet ?? "—"}</dd>
      <dt>Plates</dt><dd>${truss.plates?.areas ?? "—"}</dd>
    </dl>
    <div class="table-wrap">
      <table class="data-table compact">
        <thead><tr><th>Label</th><th>Size</th><th>Grade</th><th>Length</th></tr></thead>
        <tbody>${members || `<tr><td colspan="4">No members listed</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

async function renderSimpsonPanel(truss, mark) {
  if (!truss) {
    simpsonDetail.innerHTML = `<p class="muted">No Simpson DDP data for this mark.</p>`;
    return;
  }

  simpsonDetail.innerHTML = `
    <dl class="job-dl compact-dl">
      <dt>File</dt><dd>${truss.file}</dd>
      <dt>Spacing</dt><dd>${truss.spacing ?? "—"}</dd>
      <dt>Load Template</dt><dd>${truss.loadTemplate ?? "—"}</dd>
      <dt>Wind / Snow</dt><dd>${truss.windMph ? `${truss.windMph} mph` : "—"} / ${truss.snowPsf ? `${truss.snowPsf} psf` : "—"}</dd>
      <dt>Max CSI</dt><dd>${truss.engineering?.maxCsi ?? "—"}</dd>
      <dt>Weight</dt><dd>${truss.engineering?.weight ? `${truss.engineering.weight} lb` : "—"}</dd>
      <dt>Reactions</dt><dd>${truss.engineering?.reactions?.maxDown ? `${truss.engineering.reactions.maxDown} lb down` : "—"}${truss.engineering?.reactions?.maxUplift ? ` · ${truss.engineering.reactions.maxUplift} lb uplift` : ""}</dd>
    </dl>
    <pre id="simpson-script" class="script-preview">Loading script…</pre>
  `;

  const scriptEl = document.getElementById("simpson-script");
  try {
    const response = await fetch(`/data/ddp/Trusses/${truss.file}`);
    if (!response.ok) {
      scriptEl.textContent = "Script not available.";
      return;
    }
    const xml = await response.text();
    const scriptMatch = xml.match(/<Script>([\s\S]*?)<\/Script>/);
    const script = scriptMatch ? scriptMatch[1].trim() : "";
    scriptEl.textContent = script.split("\n").slice(0, 50).join("\n");
    if (script.split("\n").length > 50) {
      scriptEl.textContent += "\n…";
    }
  } catch {
    scriptEl.textContent = `Could not load ${mark} DDP script.`;
  }
}
