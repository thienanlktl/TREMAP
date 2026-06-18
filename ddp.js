import { mountNav } from "./shared/nav.js";
import { splitCompareUrl, trussDetailUrl, viewerUrl } from "./shared/truss-links.js";

mountNav("ddp");

const jobPanel = document.getElementById("job-panel");
const trussGrid = document.getElementById("truss-grid");
const detailPanel = document.getElementById("detail-panel");
const detailTitle = document.getElementById("detail-title");
const detailContent = document.getElementById("detail-content");
const detailScript = document.getElementById("detail-script");
const trussSearch = document.getElementById("truss-search");
const scheduleBody = document.getElementById("schedule-body");

let catalog = null;
const trussScripts = new Map();

const catalogResponse = await fetch("/data/ddp-catalog.json");
if (!catalogResponse.ok) {
  jobPanel.innerHTML = `<p class="error">DDP catalog not found. Run <code>npm run build-data</code> first.</p>`;
} else {
  catalog = await catalogResponse.json();
  renderJob(catalog);
  renderSchedule();
  await loadTrussScripts();
  renderTrussGrid();
  openMarkFromUrl();
}

trussSearch?.addEventListener("input", renderTrussGrid);
document.getElementById("detail-close")?.addEventListener("click", () => {
  detailPanel.classList.add("hidden");
});

function renderJob(data) {
  const { job, summary } = data;
  const dc = summary.designCriteria ?? {};

  jobPanel.innerHTML = `
    <h2>Job Information</h2>
    <dl class="job-dl">
      <dt>Job</dt><dd>${job.jobDesc ?? job.jobName ?? "—"}</dd>
      <dt>Plan</dt><dd>${job.planName ?? "—"}</dd>
      <dt>Customer</dt><dd>${job.customer ?? "—"}</dd>
      <dt>Truss Designs</dt><dd>${summary.trussDesigns}</dd>
      <dt>Total Trusses</dt><dd>${summary.totalTrusses}</dd>
      <dt>Misc Items</dt><dd>${summary.miscItems}</dd>
    </dl>
    <h3 class="detail-subheading">Design Criteria</h3>
    <dl class="job-dl compact-dl">
      <dt>Code</dt><dd>${dc.code ?? "—"}</dd>
      <dt>Standard Loads</dt><dd>${dc.standardLoads ?? "20-10-0-10"} psf</dd>
      <dt>Wind</dt><dd>${dc.windMph ? `${dc.windMph} mph` : "—"}</dd>
      <dt>Snow</dt><dd>${dc.snowPsf ? `${dc.snowPsf} psf` : "—"}</dd>
      <dt>Spacing</dt><dd>${dc.spacing ?? "—"}</dd>
    </dl>
    <div class="misc-inline">
      ${data.misc.map((item) => `<span class="tag">${item.mark} ×${item.quantity}</span>`).join("")}
    </div>
  `;
}

function renderSchedule() {
  const trussMap = new Map(catalog.trusses.map((t) => [t.mark, t]));
  scheduleBody.replaceChildren(
    ...(catalog.layoutSchedule ?? []).map((row) => {
      const truss = trussMap.get(row.mark);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><button type="button" class="link-btn">${row.mark}</button></td>
        <td>${row.quantity}</td>
        <td>${truss?.spanDisplay ?? "—"}</td>
        <td>${truss?.trussType ?? "—"}</td>
      `;
      tr.querySelector("button").addEventListener("click", () => {
        if (truss) showDetail(truss);
      });
      return tr;
    }),
  );
}

async function loadTrussScripts() {
  const tasks = catalog.trusses.map(async (truss) => {
    const response = await fetch(`/data/ddp/Trusses/${truss.file}`);
    if (!response.ok) return;
    const xml = await response.text();
    const scriptMatch = xml.match(/<Script>([\s\S]*?)<\/Script>/);
    trussScripts.set(truss.mark, scriptMatch ? scriptMatch[1].trim() : "");
  });
  await Promise.all(tasks);
}

function renderTrussGrid() {
  const query = trussSearch?.value.trim().toUpperCase() ?? "";
  const rows = catalog.trusses.filter((truss) => !query || truss.mark.includes(query));

  trussGrid.replaceChildren(
    ...rows.map((truss) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "truss-card";
      const csi = truss.engineering?.maxCsi;
      card.innerHTML = `
        <div class="truss-mark">${truss.mark}</div>
        <div class="truss-meta">Qty ${truss.quantity ?? "—"} · ${truss.ply ?? 1}-ply</div>
        <div class="truss-meta">${truss.spanDisplay ?? "—"} · CSI ${csi ?? "—"}</div>
      `;
      card.addEventListener("click", () => showDetail(truss));
      return card;
    }),
  );
}

function showDetail(truss) {
  detailTitle.textContent = truss.mark;
  detailContent.replaceChildren();

  const actions = document.getElementById("detail-actions");
  if (actions) {
    actions.replaceChildren(
      createActionLink("View in 3D (Simpson)", viewerUrl({ mark: truss.mark, model: "/models/simpson.ifc" })),
      createActionLink("View in 3D (MiTek)", viewerUrl({ mark: truss.mark, model: "/models/mitek.ifc" })),
      createActionLink("Split 3D Compare", splitCompareUrl(truss.mark)),
      createActionLink("Compare sources", trussDetailUrl(truss.mark)),
      createActionLink("Truss Analyzer", `/analyzer.html?mark=${truss.mark}`),
    );
  }

  const eng = truss.engineering ?? {};
  const loads = truss.loads ?? {};
  const fields = [
    ["Quantity", truss.quantity],
    ["Ply", truss.ply],
    ["Span", truss.spanDisplay],
    ["Spacing", truss.spacing],
    ["Type", truss.trussType],
    ["Load Template", truss.loadTemplate],
    ["Design Code", truss.designCode],
    ["TCLL / TCDL", loads.tcLive ? `${loads.tcLive} / ${loads.tcDead} psf` : null],
    ["Wind Vult", truss.windMph ? `${truss.windMph} mph` : null],
    ["Snow", truss.snowPsf ? `${truss.snowPsf} psf` : null],
    ["Max CSI", eng.maxCsi],
    ["Weight", eng.weight ? `${eng.weight} lb` : null],
    ["Max Reaction", eng.reactions?.maxDown ? `${eng.reactions.maxDown} lb` : null],
    ["Max Uplift", eng.reactions?.maxUplift ? `${eng.reactions.maxUplift} lb` : null],
    ["Defl Limit LL", eng.deflectionLimitLl],
    ["Defl Limit TL", eng.deflectionLimitTl],
    ["File", truss.file],
  ];

  for (const [label, value] of fields) {
    if (value == null || value === "") continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    detailContent.append(dt, dd);
  }

  const script = trussScripts.get(truss.mark) ?? "";
  detailScript.textContent = script.split("\n").slice(0, 40).join("\n");
  if (script.split("\n").length > 40) {
    detailScript.textContent += "\n…";
  }

  detailPanel.classList.remove("hidden");
}

function createActionLink(label, href) {
  const link = document.createElement("a");
  link.href = href;
  link.className = "btn secondary detail-action";
  link.textContent = label;
  return link;
}

function openMarkFromUrl() {
  const mark = new URLSearchParams(window.location.search).get("mark")?.toUpperCase();
  if (!mark || !catalog) return;
  const truss = catalog.trusses.find((row) => row.mark === mark);
  if (truss) showDetail(truss);
}
