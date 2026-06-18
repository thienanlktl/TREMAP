import { mountNav } from "./shared/nav.js";
import { viewerUrl, splitCompareUrl, trussDetailUrl } from "./shared/truss-links.js";

mountNav("analyzer");

const trussSelect = document.getElementById("truss-select");
const exportBtn = document.getElementById("export-json");
const carriedTitle = document.getElementById("carried-title");
const carriedCount = document.getElementById("carried-count");
const carriedBody = document.getElementById("carried-body");
const carriedEmpty = document.getElementById("carried-empty");
const elevationSvg = document.getElementById("elevation-svg");
const planSvg = document.getElementById("plan-svg");
const elevationCaption = document.getElementById("elevation-caption");
const planCaption = document.getElementById("plan-caption");
const resultsDl = document.getElementById("results-dl");
const nodeDl = document.getElementById("node-dl");
const subtitle = document.getElementById("analyzer-subtitle");

const ROLE_COLORS = {
  tc: "#e85d5d",
  bc: "#5b9bd5",
  web: "#6abf69",
  bearing: "#9aa7b8",
  other: "#c9a227",
};

let catalog = null;
let current = null;
let selectedLoad = null;

const response = await fetch("/data/truss-analysis.json");
if (!response.ok) {
  subtitle.textContent = "Run build-data first to generate truss-analysis.json";
} else {
  catalog = await response.json();
  populateSelect();
  const mark = new URLSearchParams(location.search).get("mark")?.toUpperCase();
  const defaultMark = mark && catalog.trusses[mark] ? mark : catalog.girders[0] ?? "T01";
  trussSelect.value = defaultMark;
  loadTruss(defaultMark);
}

trussSelect?.addEventListener("change", () => {
  const mark = trussSelect.value;
  history.replaceState(null, "", `?mark=${mark}`);
  loadTruss(mark);
});

exportBtn?.addEventListener("click", () => {
  if (!current) return;
  const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${current.mark}-analysis.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

function populateSelect() {
  const marks = Object.keys(catalog.trusses).sort();
  trussSelect.replaceChildren(
    ...marks.map((mark) => {
      const truss = catalog.trusses[mark];
      const opt = document.createElement("option");
      opt.value = mark;
      const tag = truss.girder ? "Girder" : truss.trussType ?? "Truss";
      opt.textContent = `${mark} — ${tag}`;
      return opt;
    }),
  );
}

function loadTruss(mark) {
  current = catalog.trusses[mark];
  selectedLoad = null;
  renderCarriedLoads();
  renderResults();
  renderElevation();
  renderPlan();
  clearNodeSelection();
  subtitle.textContent = `${current.trussType ?? "Truss"} — ${current.spanDisplay ?? "—"} — ${current.designCode ?? "MiTek TRE"}`;
}

function formatOffset(inches) {
  const feet = Math.floor(inches / 12);
  const rem = inches - feet * 12;
  return `${feet}'-${rem.toFixed(2)}"`;
}

function renderCarriedLoads() {
  const loads = current.carriedLoads ?? [];
  carriedTitle.textContent = current.girder ? `Carried by ${current.mark}` : "Point Loads";
  carriedCount.textContent = loads.length ? `${loads.length} items` : "";

  if (!loads.length) {
    carriedBody.replaceChildren();
    carriedEmpty.classList.remove("hidden");
    carriedEmpty.textContent = current.girder
      ? "No carried truss loads parsed from this girder TRE."
      : "This truss has no girder load cases — select a girder (T06, T15) for carried-load view.";
    return;
  }

  carriedEmpty.classList.add("hidden");
  carriedBody.replaceChildren(
    ...loads.map((load, index) => {
      const row = document.createElement("tr");
      row.dataset.index = String(index);
      row.innerHTML = `
        <td><strong>${load.mark}</strong></td>
        <td>${formatOffset(load.xInches)}</td>
        <td class="col-down">${load.reactionDown ? `${load.reactionDown} lb` : "—"}</td>
        <td class="col-up">${load.uplift ? `${load.uplift} lb` : "—"}</td>
      `;
      row.addEventListener("click", () => selectLoad(load, index, row));
      return row;
    }),
  );
}

function renderResults() {
  const eng = current.engineering ?? {};
  const maxCsi = Math.max(
    Number.parseFloat(eng.maxTcCsi) || 0,
    Number.parseFloat(eng.maxBcCsi) || 0,
    Number.parseFloat(eng.ssi) || 0,
  );

  resultsDl.innerHTML = `
    <dt>Truss Type</dt><dd>${current.trussType ?? "—"}</dd>
    <dt>Span</dt><dd>${current.spanDisplay ?? "—"} (${current.spanInches?.toFixed(1) ?? "—"}")</dd>
    <dt>Pitch</dt><dd>${current.pitch ?? "—"}</dd>
    <dt>Spacing</dt><dd>${current.spacing ? `${current.spacing}" O.C.` : "—"}</dd>
    <dt>Top Chord</dt><dd>${current.topChordLumber ?? "—"}</dd>
    <dt>Bottom Chord</dt><dd>${current.bottomChordLumber ?? "—"}</dd>
    <dt>Max Reaction (down)</dt><dd>${eng.reactionMax != null ? `${eng.reactionMax} lb` : "—"}</dd>
    <dt>Max Uplift</dt><dd>${eng.maxUplift1 ? `${eng.maxUplift1} lb` : eng.reactionMin != null ? `${eng.reactionMin} lb` : "—"}</dd>
    <dt>Deflection (TL)</dt><dd>${eng.deflectionTL ?? "—"}</dd>
    <dt>Deflection (LL)</dt><dd>${eng.deflectionLL ?? "—"}</dd>
    <dt>Max CSI</dt><dd>${maxCsi ? maxCsi.toFixed(2) : "—"}</dd>
    <dt>TC CSI / BC CSI</dt><dd>${eng.maxTcCsi ?? "—"} / ${eng.maxBcCsi ?? "—"}</dd>
    <dt>Weight</dt><dd>${eng.weight ? `${eng.weight} lb` : "—"}</dd>
    <dt>Ply × Qty</dt><dd>${current.ply} × ${current.quantity}</dd>
    <dt>Links</dt>
    <dd class="analyzer-links">
      <a href="${viewerUrl(current.mark)}">3D</a>
      <a href="${splitCompareUrl(current.mark)}">Split</a>
      <a href="${trussDetailUrl(current.mark)}">Detail</a>
    </dd>
  `;
}

function clearNodeSelection() {
  nodeDl.innerHTML = `
    <dt>Status</dt>
    <dd id="node-status">Click a load point or member on the diagram</dd>
  `;
  elevationSvg.querySelectorAll(".selected-marker").forEach((el) => el.classList.remove("selected-marker"));
  carriedBody?.querySelectorAll("tr.selected").forEach((row) => row.classList.remove("selected"));
}

function selectLoad(load, index, row) {
  selectedLoad = { type: "load", load, index };
  carriedBody?.querySelectorAll("tr.selected").forEach((r) => r.classList.remove("selected"));
  row?.classList.add("selected");
  highlightLoadMarker(index);

  nodeDl.innerHTML = `
    <dt>Node Type</dt><dd>Carried Truss Reaction</dd>
    <dt>Truss Mark</dt><dd>${load.mark}</dd>
    <dt>Offset X</dt><dd>${formatOffset(load.xInches)} (${load.xInches.toFixed(2)}")</dd>
    <dt>Reaction Down</dt><dd class="col-down">${load.reactionDown ? `${load.reactionDown} lb` : "—"}</dd>
    <dt>Uplift</dt><dd class="col-up">${load.uplift ? `${load.uplift} lb` : "—"}</dd>
    <dt>On Girder</dt><dd>${current.mark}</dd>
  `;
}

function highlightLoadMarker(index) {
  elevationSvg.querySelectorAll(".load-marker").forEach((el, i) => {
    el.classList.toggle("selected-marker", i === index);
  });
}

function computeBounds(members, loads) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const member of members) {
    for (const pt of member.points) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }
  }

  for (const load of loads) {
    minX = Math.min(minX, load.xInches);
    maxX = Math.max(maxX, load.xInches);
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 100, minY: 0, maxY: 50 };
  }

  return { minX, maxX, minY, maxY };
}

function makeTransform(bounds, width, height, padX = 40, padY = 50) {
  const spanX = bounds.maxX - bounds.minX || 1;
  const spanY = bounds.maxY - bounds.minY || 1;
  const scale = Math.min((width - padX * 2) / spanX, (height - padY * 2) / spanY);
  const offsetX = padX - bounds.minX * scale;
  const offsetY = height - padY + bounds.minY * scale;

  return {
    scale,
    tx(x) {
      return x * scale + offsetX;
    },
    ty(y) {
      return offsetY - y * scale;
    },
  };
}

function renderElevation() {
  const members = (current.members ?? []).filter((m) => m.role !== "bearing" || m.points.some((p) => p.y > 0.5));
  const loads = current.carriedLoads ?? [];
  const bounds = computeBounds(members, loads);
  const width = 800;
  const height = 320;
  const t = makeTransform(bounds, width, height);

  const parts = [];

  for (const member of members) {
    if (member.points.length < 2) continue;
    const color = ROLE_COLORS[member.role] ?? ROLE_COLORS.other;
    const path = member.points.map((p, i) => `${i === 0 ? "M" : "L"}${t.tx(p.x).toFixed(2)},${t.ty(p.y).toFixed(2)}`).join(" ");
    parts.push(
      `<path class="member-line" data-label="${member.label}" d="${path}" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round" />`,
    );
    const mid = member.points[Math.floor(member.points.length / 2)];
    if (member.size && member.role !== "bearing") {
      parts.push(
        `<text class="member-label" x="${t.tx(mid.x).toFixed(1)}" y="${t.ty(mid.y).toFixed(1) - 6}" fill="${color}" font-size="9">${member.label} ${member.size}</text>`,
      );
    }
  }

  const bearings = (current.members ?? []).filter((m) => m.role === "bearing" && m.label.startsWith("BR"));
  for (const br of bearings) {
    const x = br.points[0]?.x ?? 0;
    parts.push(`<text x="${t.tx(x).toFixed(1)}" y="${t.ty(0) + 16}" fill="#9aa7b8" font-size="9" text-anchor="middle">BEARING</text>`);
  }

  loads.forEach((load, index) => {
    const x = t.tx(load.xInches);
    const y = t.ty(0) - 8;
    parts.push(`
      <g class="load-marker" data-index="${index}" style="cursor:pointer">
        <line x1="${x}" y1="${y}" x2="${x}" y2="${y - 22}" stroke="#f59e0b" stroke-width="2" marker-end="url(#arrow-down)" />
        <circle cx="${x}" cy="${y}" r="5" fill="#fff" stroke="#f59e0b" stroke-width="2" />
        <text x="${x}" y="${y - 28}" fill="#f59e0b" font-size="8" text-anchor="middle">${load.mark}</text>
      </g>
    `);
  });

  const axisY = t.ty(0) + 28;
  parts.push(`<line x1="${t.tx(bounds.minX)}" y1="${axisY}" x2="${t.tx(bounds.maxX)}" y2="${axisY}" stroke="#3a4454" />`);
  const tickCount = 5;
  for (let i = 0; i <= tickCount; i += 1) {
    const xVal = bounds.minX + ((bounds.maxX - bounds.minX) * i) / tickCount;
    const x = t.tx(xVal);
    parts.push(`<line x1="${x}" y1="${axisY}" x2="${x}" y2="${axisY + 5}" stroke="#3a4454" />`);
    parts.push(`<text x="${x}" y="${axisY + 16}" fill="#9aa7b8" font-size="8" text-anchor="middle">${Math.round(xVal)}"</text>`);
  }

  elevationSvg.innerHTML = `
    <defs>
      <marker id="arrow-down" markerWidth="6" markerHeight="6" refX="3" refY="0" orient="auto">
        <path d="M0,0 L3,6 L6,0" fill="#f59e0b" />
      </marker>
    </defs>
    ${parts.join("\n")}
  `;

  elevationCaption.textContent = `${current.mark} — ${current.spanDisplay ?? ""} ${current.girder ? "GIRDER" : ""}`.trim();

  elevationSvg.querySelectorAll(".load-marker").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      const index = Number.parseInt(el.dataset.index, 10);
      const load = loads[index];
      const row = carriedBody?.querySelector(`tr[data-index="${index}"]`);
      selectLoad(load, index, row);
    });
  });

  elevationSvg.querySelectorAll(".member-line").forEach((el) => {
    el.addEventListener("click", () => {
      const label = el.dataset.label;
      const member = current.members.find((m) => m.label === label);
      if (!member) return;
      nodeDl.innerHTML = `
        <dt>Node Type</dt><dd>Member</dd>
        <dt>Label</dt><dd>${member.label}</dd>
        <dt>Role</dt><dd>${member.role.toUpperCase()}</dd>
        <dt>Size / Grade</dt><dd>${member.size} ${member.grade}</dd>
        <dt>Points</dt><dd>${member.points.length}</dd>
      `;
    });
  });
}

function renderPlan() {
  const span = current.spanInches ?? 196;
  const spacing = Number.parseFloat(current.spacing) || 24;
  const loads = current.carriedLoads ?? [];
  const width = 800;
  const height = 180;
  const pad = 50;
  const lineY = 90;
  const scale = (width - pad * 2) / span;

  const parts = [];
  parts.push(`<line x1="${pad}" y1="${lineY}" x2="${width - pad}" y2="${lineY}" stroke="#5b9bd5" stroke-width="4" />`);
  parts.push(`<text x="${width / 2}" y="30" fill="#e8edf4" font-size="12" text-anchor="middle">${current.mark} GIRDER — ${current.spanDisplay ?? formatOffset(span)}</text>`);

  const uniqueMarks = [...new Set(loads.map((l) => l.mark))];
  uniqueMarks.forEach((mark, i) => {
    const load = loads.find((l) => l.mark === mark);
    if (!load) return;
    const x = pad + load.xInches * scale;
    const offset = (i % 2 === 0 ? -1 : 1) * 28;
    parts.push(`<line x1="${x}" y1="${lineY}" x2="${x}" y2="${lineY + offset}" stroke="#e85d5d" stroke-width="2" marker-end="url(#plan-arrow)" />`);
    parts.push(`<text x="${x}" y="${lineY + offset + (offset > 0 ? 14 : -6)}" fill="#e85d5d" font-size="8" text-anchor="middle">${mark}</text>`);
  });

  if (!loads.length) {
    let pos = spacing;
    while (pos < span) {
      const x = pad + pos * scale;
      parts.push(`<line x1="${x}" y1="${lineY - 20}" x2="${x}" y2="${lineY + 20}" stroke="#6abf69" stroke-width="1" stroke-dasharray="4 3" />`);
      pos += spacing;
    }
    parts.push(`<text x="${width / 2}" y="${height - 20}" fill="#9aa7b8" font-size="9" text-anchor="middle">${spacing}" O.C. lay spacing (no carried loads)</text>`);
  }

  parts.push(`<text x="${pad}" y="${lineY + 36}" fill="#9aa7b8" font-size="8">0"</text>`);
  parts.push(`<text x="${width - pad}" y="${lineY + 36}" fill="#9aa7b8" font-size="8" text-anchor="end">${Math.round(span)}"</text>`);

  planSvg.innerHTML = `
    <defs>
      <marker id="plan-arrow" markerWidth="6" markerHeight="6" refX="3" refY="6" orient="auto">
        <path d="M0,6 L3,0 L6,6" fill="#e85d5d" />
      </marker>
    </defs>
    ${parts.join("\n")}
  `;

  planCaption.textContent = loads.length
    ? `${loads.length} carried truss reactions along span`
    : `Typical ${spacing}" truss spacing`;
}
