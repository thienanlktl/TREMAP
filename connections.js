import { mountNav } from "./shared/nav.js";
import { mountSSTPanel } from "./shared/sst-panel.js";
import { prepareSSTPayload } from "./shared/sst-payload.js";

mountNav("connections");

const connectionSelect = document.getElementById("cn-connection-select");
const summaryEl = document.getElementById("cn-summary");
const detailEl = document.getElementById("cn-detail");
const apiJsonEl = document.getElementById("cn-api-json");
const apiAnnotatedEl = document.getElementById("cn-api-annotated");

let connectionIndex = null;
let currentConnection = null;
let sstPanel = null;
let hsReference = null;

// Fields carried for the viewer/UI only — not part of the submitted payload.
const META_KEYS = new Set(["simpsonHsUrl", "connectionLabel", "hangerOptions", "memberId"]);

// Duration codes (CD x100) are not all enumerated in the HS reference — supply
// the full set so downloadDurationType/upliftLoadDurationType always decode.
const DURATION_LABELS = {
  90: "Dead (CD=0.9)",
  100: "Floor / standard (CD=1.0)",
  115: "Snow (CD=1.15)",
  125: "Roof (CD=1.25)",
  160: "Wind / seismic (CD=1.6)",
};

/** apiField path -> { labels[], section, enumKey } from the HS reference UI model. */
function buildFieldMeta(hsRef) {
  const map = new Map();
  for (const section of hsRef?.uiSections ?? []) {
    for (const field of section.fields ?? []) {
      if (!field.apiField) continue;
      if (!map.has(field.apiField)) {
        map.set(field.apiField, { labels: [], section: section.uiLabel, enumKey: field.enumKey ?? null });
      }
      map.get(field.apiField).labels.push(field.uiLabel);
    }
  }
  return map;
}

/** Section render order follows the HS input form. */
function sectionOrder(hsRef) {
  return (hsRef?.uiSections ?? []).map((section) => section.uiLabel);
}

/** Flatten the payload into leaf { disp, norm, value } rows (array indices normalized to []). */
function flattenPayload(obj, disp = "", norm = "", out = []) {
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (META_KEYS.has(key)) continue;
    const dispPath = disp ? `${disp}.${key}` : key;
    const normPath = norm ? `${norm}.${key}` : key;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === "object") {
          flattenPayload(item, `${dispPath}[${index}]`, `${normPath}[]`, out);
        } else {
          out.push({ disp: `${dispPath}[${index}]`, norm: `${normPath}[]`, value: item });
        }
      });
    } else if (value && typeof value === "object") {
      flattenPayload(value, dispPath, normPath, out);
    } else {
      out.push({ disp: dispPath, norm: normPath, value });
    }
  }
  return out;
}

/** Human label for a coded value, or null if the value is already plain. */
function decodeValue(leaf, meta, hsRef) {
  if (meta?.enumKey && hsRef?.enums?.[meta.enumKey]) {
    const match = hsRef.enums[meta.enumKey].find((entry) => String(entry.value) === String(leaf.value));
    if (match) return match.label;
  }
  if (/DurationType$/.test(leaf.norm)) return DURATION_LABELS[leaf.value] ?? null;
  return null;
}

function renderApiAnnotated(apiBody, hsRef) {
  if (!apiAnnotatedEl) return;
  if (!apiBody || !hsRef) {
    apiAnnotatedEl.innerHTML = "";
    return;
  }

  const fieldMeta = buildFieldMeta(hsRef);
  const leaves = flattenPayload(apiBody);
  const order = sectionOrder(hsRef);
  const OTHER = "Other (not a Hanger Selector input)";

  const groups = new Map();
  for (const leaf of leaves) {
    const meta = fieldMeta.get(leaf.norm);
    const section = meta?.section ?? OTHER;
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push({ leaf, meta });
  }

  const sortedSections = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  apiAnnotatedEl.innerHTML = sortedSections
    .map((section) => {
      const rows = groups
        .get(section)
        .map(({ leaf, meta }) => {
          const input = meta ? meta.labels.join(" / ") : "—";
          const decoded = decodeValue(leaf, meta, hsRef);
          const valueCell = decoded
            ? `${escapeHtml(leaf.value)} <span class="cn-decoded">→ ${escapeHtml(decoded)}</span>`
            : escapeHtml(leaf.value);
          return `
            <tr>
              <td class="cn-hs-input">${escapeHtml(input)}</td>
              <td class="cn-hs-value">${valueCell}</td>
              <td class="cn-hs-field muted">${escapeHtml(leaf.disp)}</td>
            </tr>`;
        })
        .join("");
      return `
        <h3 class="cn-api-section">${escapeHtml(section)}</h3>
        <table class="data-table cn-api-table">
          <thead>
            <tr><th>Simpson HS input</th><th>Value</th><th>API field</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    })
    .join("");
}

async function loadBatchConnections() {
  if (!connectionIndex?.connections?.length) {
    return [];
  }

  const items = [];
  for (const entry of connectionIndex.connections) {
    const response = await fetch(`/data/connection-maps/${entry.connectionId}.json`);
    if (!response.ok) {
      continue;
    }
    const data = await response.json();
    const payload = prepareSSTPayload(data.apiBody);
    if (!payload) {
      continue;
    }
    items.push({
      label: `${data.carryingMark} → ${data.carriedMark}`,
      payload,
    });
  }
  return items;
}

const sstPanelSlot = document.getElementById("sst-panel-slot");
if (sstPanelSlot) {
  sstPanel = mountSSTPanel(sstPanelSlot, {
    getPayload: () => currentConnection?.apiBody,
    getLabel: () =>
      currentConnection
        ? `${currentConnection.carryingMark} → ${currentConnection.carriedMark}`
        : "",
    getBatchItems: loadBatchConnections,
    batchLabel: "Query all connections",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kvRow(label, value) {
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

async function loadConnection(connectionId) {
  if (!connectionId) return;

  const response = await fetch(`/data/connection-maps/${connectionId}.json`);
  if (!response.ok) {
    summaryEl.textContent = `Missing connection map for ${connectionId}. Run npm run build-data.`;
    return;
  }

  currentConnection = await response.json();

  summaryEl.textContent = [
    currentConnection.connectionId,
    `${currentConnection.carryingMark} → ${currentConnection.carriedMark}`,
    currentConnection.simpsonHsConnectionLabel,
    `${currentConnection.loadsAsd.download} lb down / ${currentConnection.loadsAsd.uplift} lb uplift`,
    currentConnection.position ? `seat: ${currentConnection.position}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const tre = currentConnection.sources?.tre ?? {};
  const ifc = currentConnection.sources?.ifc ?? {};

  detailEl.innerHTML = [
    kvRow("Carrying truss (girder)", tre.carrying?.mark),
    kvRow("Carried truss", tre.carried?.mark),
    kvRow("Carrying type", tre.carrying?.trussType),
    kvRow("Carried type", tre.carried?.trussType),
    kvRow("Seat configuration", currentConnection.seatConfiguration),
    kvRow("Skew", `${currentConnection.geometry.skewAngle}° (type ${currentConnection.geometry.skewType})`),
    kvRow("Slope", `${currentConnection.geometry.slopeAngle}°`),
    kvRow("IFC hanger bearing", ifc.validated ? "Hanger-To-Truss confirmed" : "Check IFC bearings"),
    kvRow("Selection", currentConnection.selectionNote),
  ].join("");

  apiJsonEl.textContent = JSON.stringify(currentConnection.apiBody ?? {}, null, 2);
  renderApiAnnotated(currentConnection.apiBody, hsReference);

  const url = new URL(window.location.href);
  url.searchParams.set("id", connectionId);
  history.replaceState(null, "", url);

  sstPanel?.notifySelectionChanged();
}

async function init() {
  const [response, hsResponse] = await Promise.all([
    fetch("/data/connection-maps/index.json"),
    fetch("/data/hanger-selector-reference.json"),
  ]);
  if (!response.ok) {
    summaryEl.textContent = "No connection maps found. Run: cd viewer && npm run build-data";
    return;
  }
  hsReference = hsResponse.ok ? await hsResponse.json() : null;

  connectionIndex = await response.json();

  connectionSelect.replaceChildren(
    ...connectionIndex.connections.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.connectionId;
      option.textContent = `${entry.carryingMark} → ${entry.carriedMark} (${entry.download} lb)`;
      return option;
    }),
  );

  const requested = new URLSearchParams(window.location.search).get("id");
  const initial =
    connectionIndex.connections.find((entry) => entry.connectionId === requested)?.connectionId ??
    connectionIndex.connections[0]?.connectionId;

  if (initial) {
    connectionSelect.value = initial;
    await loadConnection(initial);
  }
}

connectionSelect?.addEventListener("change", () => loadConnection(connectionSelect.value));

document.getElementById("cn-copy-api")?.addEventListener("click", async () => {
  if (currentConnection?.apiBody) {
    await navigator.clipboard.writeText(JSON.stringify(currentConnection.apiBody, null, 2));
  }
});

init();
