import { mountNav } from "./shared/nav.js";
import { mountSSTPanel } from "./shared/sst-panel.js";
import { prepareSSTPayload } from "./shared/sst-payload.js";

mountNav("connections");

const connectionSelect = document.getElementById("cn-connection-select");
const summaryEl = document.getElementById("cn-summary");
const detailEl = document.getElementById("cn-detail");
const apiJsonEl = document.getElementById("cn-api-json");

let connectionIndex = null;
let currentConnection = null;
let sstPanel = null;

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

  const url = new URL(window.location.href);
  url.searchParams.set("id", connectionId);
  history.replaceState(null, "", url);

  sstPanel?.notifySelectionChanged();
}

async function init() {
  const response = await fetch("/data/connection-maps/index.json");
  if (!response.ok) {
    summaryEl.textContent = "No connection maps found. Run: cd viewer && npm run build-data";
    return;
  }

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
