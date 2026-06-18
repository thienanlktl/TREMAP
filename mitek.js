import { mountNav } from "./shared/nav.js";
import { trussDetailUrl, viewerUrl, splitCompareUrl } from "./shared/truss-links.js";

mountNav("mitek");

const jobPanel = document.getElementById("job-panel");
const trussGrid = document.getElementById("truss-grid");
const detailPanel = document.getElementById("detail-panel");
const detailTitle = document.getElementById("detail-title");
const detailContent = document.getElementById("detail-content");
const memberBody = document.getElementById("member-body");
const plateSummary = document.getElementById("plate-summary");
const detailPreview = document.getElementById("detail-preview");
const trussSearch = document.getElementById("truss-search");

let catalog = null;

const catalogResponse = await fetch("/data/mitek-catalog.json");
if (!catalogResponse.ok) {
  jobPanel.innerHTML = `<p class="error">MiTek catalog not found. Run <code>npm run build-data</code> first.</p>`;
} else {
  catalog = await catalogResponse.json();
  renderJob(catalog);
  renderTrussGrid();
  openMarkFromUrl();
}

trussSearch?.addEventListener("input", renderTrussGrid);
document.getElementById("detail-close")?.addEventListener("click", () => {
  detailPanel.classList.add("hidden");
});

function renderJob(data) {
  const { job, summary } = data;
  jobPanel.innerHTML = `
    <h2>Job Information</h2>
    <dl class="job-dl">
      <dt>Job Number</dt><dd>${job.jobNumber ?? "—"}</dd>
      <dt>Project File</dt><dd>${job.projectFile ?? "—"}</dd>
      <dt>Project</dt><dd>${job.project ?? "—"}</dd>
      <dt>Customer</dt><dd>${job.customer ?? "—"}</dd>
      <dt>Software</dt><dd>${job.software ?? "MiTek X/AE Structure"}</dd>
      <dt>IFC Export</dt><dd>${job.exportDate ?? "—"}</dd>
      <dt>Design Code</dt><dd>${summary.designCode ?? "—"}</dd>
      <dt>Truss Designs</dt><dd>${summary.trussDesigns}</dd>
      <dt>Total Trusses</dt><dd>${summary.totalTrusses}</dd>
      <dt>Total Weight</dt><dd>${summary.totalWeight?.toLocaleString() ?? "—"} lb</dd>
      <dt>Board Feet</dt><dd>${summary.totalBoardFeet?.toLocaleString() ?? "—"} BF</dd>
    </dl>
    <div class="misc-inline">
      <span class="tag mitek-tag">Southern Pine (SP)</span>
      <span class="tag mitek-tag">2×4 @ 24" O.C.</span>
      <span class="tag mitek-tag">6/12 pitch</span>
    </div>
  `;
}

function renderTrussGrid() {
  const query = trussSearch?.value.trim().toUpperCase() ?? "";
  const rows = catalog.trusses.filter((truss) => !query || truss.mark.includes(query));

  trussGrid.replaceChildren(
    ...rows.map((truss) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "truss-card mitek-card";
      const girderBadge = truss.girder || truss.ply > 1 ? ` · ${truss.ply}-ply` : "";
      card.innerHTML = `
        <div class="truss-mark">${truss.mark}</div>
        <div class="truss-meta">${truss.trussType ?? "Truss"} · Qty ${truss.quantity ?? "—"}${girderBadge}</div>
        <div class="truss-meta">${truss.spanDisplay ?? "—"} · ${truss.spacing ?? "—"}</div>
        <div class="truss-meta">${truss.engineering?.weight ?? "—"} lb · ${truss.plates?.count ?? 0} plates</div>
      `;
      card.addEventListener("click", () => showDetail(truss));
      return card;
    }),
  );
}

async function showDetail(truss) {
  detailTitle.textContent = truss.mark;
  detailContent.replaceChildren();

  const actions = document.getElementById("detail-actions");
  if (actions) {
    actions.replaceChildren();
    actions.append(
      createActionLink("View in 3D (MiTek)", viewerUrl({ mark: truss.mark, model: "/models/mitek.ifc" })),
      createActionLink("View in 3D (Simpson)", viewerUrl({ mark: truss.mark, model: "/models/simpson.ifc" })),
      createActionLink("Split 3D Compare", splitCompareUrl(truss.mark)),
      createActionLink("Truss Analyzer", `/analyzer.html?mark=${truss.mark}`),
      createActionLink("Compare sources", trussDetailUrl(truss.mark)),
    );
  }

  const fields = [
    ["Type", truss.trussType],
    ["Quantity", truss.quantity],
    ["Ply", truss.ply],
    ["Span", truss.spanDisplay],
    ["Pitch", truss.pitch],
    ["Spacing", truss.spacing],
    ["Left OH", truss.overhangLeft],
    ["Right OH", truss.overhangRight],
    ["Girder", truss.girder ? "Yes" : "No"],
    ["Top Chord", truss.topChordLumber],
    ["Bottom Chord", truss.bottomChordLumber],
    ["TCLL", truss.loads?.tcLive ? `${truss.loads.tcLive} psf` : null],
    ["TCDL", truss.loads?.tcDead ? `${truss.loads.tcDead} psf` : null],
    ["Max TC CSI", truss.engineering?.maxTcCsi],
    ["Max BC CSI", truss.engineering?.maxBcCsi],
    ["SSI", truss.engineering?.ssi],
    ["Defl (TL)", truss.engineering?.deflectionTL ? `${truss.engineering.deflectionTL}"` : null],
    ["Reaction 1", truss.engineering?.reaction1 ? `${truss.engineering.reaction1} lb` : null],
    ["Max Uplift", truss.engineering?.maxUplift1 ? `${truss.engineering.maxUplift1} lb` : null],
    ["Weight", truss.engineering?.weight ? `${truss.engineering.weight} lb` : null],
    ["Board Feet", truss.engineering?.boardFeet],
    ["Design Date", truss.designDate],
    ["File", truss.file],
  ];

  for (const [label, value] of fields) {
    if (value == null || value === "") {
      continue;
    }
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    detailContent.append(dt, dd);
  }

  memberBody.replaceChildren(
    ...(truss.members ?? []).map((member) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${member.label}</td>
        <td>${member.size}</td>
        <td>${member.grade}</td>
        <td>${member.length}</td>
      `;
      return tr;
    }),
  );

  if (!truss.members?.length) {
    memberBody.innerHTML = `<tr><td colspan="4">No member cutting list found</td></tr>`;
  }

  plateSummary.innerHTML = `
    <p><strong>${truss.plates?.count ?? 0}</strong> plates</p>
    <p>${truss.plates?.areas ?? "—"}</p>
    <p>${(truss.plates?.types ?? []).join(", ") || "—"}</p>
  `;

  detailPreview.textContent = "Loading TRE preview…";
  detailPanel.classList.remove("hidden");

  try {
    const response = await fetch(`/data/tre/${truss.file}`);
    if (!response.ok) {
      detailPreview.textContent = "TRE file not available.";
      return;
    }
    const text = await response.text();
    detailPreview.textContent = text.split("\n").slice(0, 45).join("\n");
    if (text.split("\n").length > 45) {
      detailPreview.textContent += "\n…";
    }
  } catch {
    detailPreview.textContent = "Could not load TRE preview.";
  }
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
  if (!mark || !catalog) {
    return;
  }
  const truss = catalog.trusses.find((row) => row.mark === mark);
  if (truss) {
    showDetail(truss);
  }
}
