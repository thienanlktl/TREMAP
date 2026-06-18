import { Color } from "three";
import { IfcViewerAPI } from "web-ifc-viewer";
import { mountNav } from "./shared/nav.js";
import {
  applyMarkFilter as applyViewerMarkFilter,
  buildMarkIndex,
  clearMarkFilter as clearViewerMarkFilter,
  FILTER_SUBSET_ID,
  readIfcValue,
  syncMarkParam,
} from "./shared/ifc-mark-filter.js";
import { splitCompareUrl, trussDetailUrl } from "./shared/truss-links.js";

const MODELS = {
  "/models/mitek.ifc": "MiTek — 2214703-08T",
  "/models/simpson.ifc": "Simpson — McBride Plan 193 IFC",
};

const container = document.getElementById("viewer-container");
const statusText = document.getElementById("status-text");
const loadingEl = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const infoPanel = document.getElementById("info-panel");
const infoContent = document.getElementById("info-content");
const fileInput = document.getElementById("ifc-input");
const modelSelect = document.getElementById("model-select");
const hoverTooltip = document.getElementById("hover-tooltip");
const tooltipTitle = document.getElementById("tooltip-title");
const tooltipContent = document.getElementById("tooltip-content");

mountNav("viewer");

let currentModelId = null;
let currentModelUrl = "/models/mitek.ifc";
let shadowsEnabled = false;
let gridVisible = true;
let axesVisible = true;
let assemblyMap = new Map();
let markToIds = new Map();
let markToInstances = new Map();
let activeMarkFilter = null;
let propertyCache = new Map();
let lastHoverKey = null;
let hoverFrame = null;
let hoverFetchToken = 0;

const viewer = new IfcViewerAPI({
  container,
  backgroundColor: new Color(0x1a1f26),
});

viewer.axes.setAxes();
viewer.grid.setGrid();

await viewer.IFC.setWasmPath("/wasm/");

setupControls();
setupPicking();

const initialParams = new URLSearchParams(window.location.search);
const initialModel = initialParams.get("model") ?? "/models/mitek.ifc";
const initialMark = initialParams.get("mark")?.toUpperCase() ?? null;
if (modelSelect) {
  modelSelect.value = initialModel;
}
setStatus("Ready — loading project model…");
await loadModel(initialModel, MODELS[initialModel] ?? "IFC Model");
if (initialMark) {
  await applyMarkFilter(initialMark);
}

function getCanvas() {
  return viewer.context.getDomElement();
}

async function loadModel(url, label) {
  showLoading(`Loading ${label}…`);
  const pendingMark = new URLSearchParams(window.location.search).get("mark")?.toUpperCase() ?? null;

  try {
    clearMarkFilter(false);

    if (currentModelId !== null) {
      viewer.IFC.removeIfcModel(currentModelId);
      currentModelId = null;
    }

    assemblyMap = new Map();
    markToIds = new Map();
    markToInstances = new Map();
    propertyCache = new Map();
    lastHoverKey = null;
    hideTooltip();

    const model = await viewer.IFC.loadIfcUrl(url, true);
    if (!model) {
      throw new Error("Model returned null");
    }

    currentModelId = model.modelID;
    currentModelUrl = url;
    const index = await buildMarkIndex(viewer, model.modelID);
    assemblyMap = index.childToMark;
    markToIds = index.markToIds;
    markToInstances = index.markToInstances;

    if (shadowsEnabled) {
      await viewer.shadowDropper.renderShadow(model.modelID);
    }

    await viewer.context.fitToFrame();
    viewer.context.getRenderer().render(viewer.context.getScene(), viewer.context.getCamera());

    if (pendingMark) {
      await applyMarkFilter(pendingMark);
    } else {
      setStatus(`Loaded: ${label} — hover members for properties`);
    }
  } catch (error) {
    console.error(error);
    setStatus(`Failed to load ${label}. Use Open IFC or check the server.`);
  } finally {
    hideLoading();
  }
}

async function applyMarkFilter(mark) {
  if (currentModelId === null) {
    return;
  }

  clearMarkFilter(false);

  const isSimpson = currentModelUrl.includes("simpson");
  const result = await applyViewerMarkFilter(
    viewer,
    currentModelId,
    mark,
    markToIds,
    FILTER_SUBSET_ID,
    {
      markToInstances,
      singleInstance: isSimpson,
      mode: isSimpson ? "highlight" : "isolate",
      colorKey: isSimpson ? "simpson" : "mitek",
    },
  );

  if (!result.count) {
    setStatus(`No IFC geometry found for truss mark ${result.mark}`);
    updateFilterBanner(result.mark, 0);
    return;
  }

  activeMarkFilter = result.mark;
  updateFilterBanner(result.mark, result.count, result.mode);
  syncMarkParam(result.mark);
  const modeNote = result.mode === "highlight" ? " (highlighted in green)" : "";
  setStatus(`Showing truss ${result.mark} — ${result.count} elements${modeNote}`);
}

function clearMarkFilter(updateUrl = true) {
  clearViewerMarkFilter(viewer, currentModelId, FILTER_SUBSET_ID);
  activeMarkFilter = null;
  updateFilterBanner(null);

  if (updateUrl) {
    syncMarkParam(null);
  }
}

function updateFilterBanner(mark, count = 0, mode = "isolate") {
  const banner = document.getElementById("filter-banner");
  if (!banner) {
    return;
  }

  if (!mark) {
    banner.classList.add("hidden");
    banner.replaceChildren();
    return;
  }

  banner.classList.remove("hidden");
  banner.replaceChildren();

  const label = document.createElement("span");
  const modeLabel = mode === "highlight" ? "highlighted" : "isolated";
  label.textContent = `Filtered: ${mark} (${count} elements, ${modeLabel})`;
  banner.append(label);

  const compareLink = document.createElement("a");
  compareLink.href = trussDetailUrl(mark);
  compareLink.className = "banner-link";
  compareLink.textContent = "Data compare";
  banner.append(compareLink);

  const splitLink = document.createElement("a");
  splitLink.href = splitCompareUrl(mark);
  splitLink.className = "banner-link";
  splitLink.textContent = "Split 3D";
  banner.append(splitLink);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn secondary banner-btn";
  clearBtn.textContent = "Show all";
  clearBtn.addEventListener("click", async () => {
    clearMarkFilter(true);
    await viewer.context.fitToFrame();
    setStatus("Showing full model");
  });
  banner.append(clearBtn);
}

function readValue(field) {
  return readIfcValue(field);
}

function setupControls() {
  document.getElementById("btn-fit").addEventListener("click", () => {
    viewer.context.fitToFrame();
  });

  document.getElementById("btn-grid").addEventListener("click", (event) => {
    gridVisible = !gridVisible;
    event.currentTarget.classList.toggle("active", gridVisible);
    if (gridVisible) {
      viewer.grid.setGrid();
    } else {
      viewer.grid.dispose();
    }
  });

  document.getElementById("btn-axes").addEventListener("click", (event) => {
    axesVisible = !axesVisible;
    event.currentTarget.classList.toggle("active", axesVisible);
    if (axesVisible) {
      viewer.axes.setAxes();
    } else {
      viewer.axes.dispose();
    }
  });

  const shadowBtn = document.getElementById("btn-shadow");
  shadowBtn.classList.remove("active");

  shadowBtn.addEventListener("click", async (event) => {
    shadowsEnabled = !shadowsEnabled;
    event.currentTarget.classList.toggle("active", shadowsEnabled);
    if (currentModelId === null) {
      return;
    }
    if (shadowsEnabled) {
      await viewer.shadowDropper.renderShadow(currentModelId);
    } else {
      viewer.context.getRenderer().shadowMap.enabled = false;
    }
  });

  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    await loadModel(objectUrl, file.name);
    URL.revokeObjectURL(objectUrl);
    fileInput.value = "";
    if (modelSelect) {
      modelSelect.value = "";
    }
  });

  modelSelect?.addEventListener("change", async (event) => {
    const url = event.target.value;
    if (!url) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set("model", url);
    history.replaceState(null, "", `?${params.toString()}`);
    await loadModel(url, MODELS[url] ?? url);
  });

  document.getElementById("info-close").addEventListener("click", () => {
    infoPanel.classList.add("hidden");
    viewer.IFC.selector.unpickIfcItems();
  });
}

function setupPicking() {
  const canvas = getCanvas();
  if (!canvas) {
    console.error("Viewer canvas not found");
    return;
  }

  canvas.addEventListener("mousemove", (event) => {
    if (hoverFrame) {
      cancelAnimationFrame(hoverFrame);
    }
    hoverFrame = requestAnimationFrame(() => {
      handleHover(event);
    });
  });

  canvas.addEventListener("mouseleave", () => {
    lastHoverKey = null;
    hideTooltip();
    viewer.IFC.selector.unPrepickIfcItems();
  });

  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape") {
      infoPanel.classList.add("hidden");
      hideTooltip();
      viewer.IFC.selector.unpickIfcItems();
      viewer.IFC.selector.unPrepickIfcItems();
    }
  });

  canvas.addEventListener("dblclick", async () => {
    const result = await viewer.IFC.selector.pickIfcItem(true);
    if (!result) {
      infoPanel.classList.add("hidden");
      return;
    }
    await showElementInfo(result.id, result.modelID);
  });
}

async function handleHover(event) {
  if (currentModelId === null) {
    hideTooltip();
    return;
  }

  await viewer.IFC.selector.prePickIfcItem();

  const found = viewer.context.castRayIfc();
  if (!found || found.faceIndex === undefined) {
    lastHoverKey = null;
    hideTooltip();
    return;
  }

  const mesh = found.object;
  const modelID = mesh.modelID;
  const expressId = viewer.IFC.loader.ifcManager.getExpressId(
    mesh.geometry,
    found.faceIndex,
  );

  if (expressId === undefined || expressId === null) {
    hideTooltip();
    return;
  }

  const hoverKey = `${modelID}:${expressId}`;
  if (hoverKey === lastHoverKey) {
    positionTooltip(event.clientX, event.clientY);
    return;
  }

  lastHoverKey = hoverKey;
  const token = ++hoverFetchToken;

  showTooltipLoading(event.clientX, event.clientY, expressId);

  try {
    const rows = await getTechnicalProperties(modelID, expressId);
    if (token !== hoverFetchToken) {
      return;
    }
    renderTooltip(rows, event.clientX, event.clientY);
  } catch (error) {
    console.warn("Hover lookup failed", error);
    hideTooltip();
  }
}

async function getTechnicalProperties(modelID, expressId) {
  const cacheKey = `${modelID}:${expressId}`;
  if (propertyCache.has(cacheKey)) {
    return propertyCache.get(cacheKey);
  }

  const props = await viewer.IFC.getProperties(modelID, expressId, true, false);
  const rows = extractTechnicalProperties(props, expressId, modelID);
  propertyCache.set(cacheKey, rows);
  return rows;
}

function extractTechnicalProperties(props, expressId, modelID) {
  const rows = [];
  const trussMark = assemblyMap.get(expressId);

  if (trussMark) {
    rows.push(["Truss Mark", trussMark]);
  }

  const ifcType = formatIfcType(props?.type);
  rows.push(["IFC Type", ifcType]);

  const name = readValue(props?.Name);
  if (name) {
    rows.push(["Member", name]);
  }

  const objectType = readValue(props?.ObjectType);
  if (objectType) {
    rows.push(["Object Type", objectType]);
  }

  const tag = readValue(props?.Tag);
  if (tag) {
    rows.push(["Tag", tag]);
  }

  const psetValues = collectPropertySetValues(props?.psets ?? []);
  for (const [label, value] of psetValues) {
    rows.push([label, value]);
  }

  if (props?.mats?.length) {
    for (const mat of props.mats) {
      const matName = readValue(mat.Name);
      if (matName) {
        rows.push(["Material", matName]);
      }
    }
  }

  rows.push(["Express ID", expressId]);
  rows.push(["Model ID", modelID]);

  return rows;
}

function collectPropertySetValues(psets) {
  const rows = [];
  const seen = new Set();

  for (const pset of psets) {
    const properties = pset.HasProperties ?? pset.hasProperties ?? [];
    for (const property of properties) {
      const label = readValue(property.Name) ?? property.name;
      const rawValue = readValue(property.NominalValue) ?? readValue(property.value);
      if (!label || rawValue == null || rawValue === "") {
        continue;
      }

      const displayLabel = formatPropertyLabel(label);
      const displayValue = formatPropertyValue(label, rawValue);
      const key = `${displayLabel}:${displayValue}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push([displayLabel, displayValue]);
    }
  }

  return rows;
}

function formatPropertyLabel(label) {
  const normalized = String(label).trim();
  const map = {
    Material: "Material",
    Grade: "Grade",
    X: "End X",
    Y: "End Y",
    Z: "End Z",
  };
  return map[normalized] ?? normalized;
}

function formatPropertyValue(label, value) {
  const text = String(value).trim();
  if (["X", "Y", "Z", "End X", "End Y", "End Z"].includes(label)) {
    const inches = Number(text);
    if (!Number.isNaN(inches)) {
      return `${inches.toFixed(3)} in`;
    }
  }
  return text;
}

function showTooltipLoading(x, y, expressId) {
  tooltipTitle.textContent = "Loading…";
  tooltipContent.replaceChildren();
  const dt = document.createElement("dt");
  dt.textContent = "Express ID";
  const dd = document.createElement("dd");
  dd.textContent = String(expressId);
  tooltipContent.append(dt, dd);
  hoverTooltip.classList.remove("hidden");
  positionTooltip(x, y);
}

function renderTooltip(rows, x, y) {
  tooltipContent.replaceChildren();

  const titleParts = [];
  const truss = rows.find(([label]) => label === "Truss Mark");
  const member = rows.find(([label]) => label === "Member");
  if (truss) {
    titleParts.push(truss[1]);
  }
  if (member) {
    titleParts.push(member[1]);
  }
  tooltipTitle.textContent = titleParts.length ? titleParts.join(" · ") : "Element Properties";

  for (const [label, value] of rows) {
    if (label === "Truss Mark" || label === "Member") {
      continue;
    }
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    tooltipContent.append(dt, dd);
  }

  hoverTooltip.classList.remove("hidden");
  positionTooltip(x, y);
}

function positionTooltip(x, y) {
  const offset = 14;
  const maxX = window.innerWidth - hoverTooltip.offsetWidth - 8;
  const maxY = window.innerHeight - hoverTooltip.offsetHeight - 8;
  hoverTooltip.style.left = `${Math.min(x + offset, maxX)}px`;
  hoverTooltip.style.top = `${Math.min(y + offset, maxY)}px`;
}

function hideTooltip() {
  hoverTooltip.classList.add("hidden");
}

async function showElementInfo(expressId, modelId) {
  const rows = await getTechnicalProperties(modelId, expressId);
  infoContent.replaceChildren();

  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    infoContent.append(dt, dd);
  }

  infoPanel.classList.remove("hidden");
}

function formatIfcType(type) {
  if (type == null) {
    return "—";
  }
  if (typeof type === "string") {
    return type.replace(/^IFC/, "Ifc");
  }
  if (typeof type === "number") {
    return `Type ${type}`;
  }
  const name = type.name ?? readValue(type);
  if (name) {
    return String(name).replace(/^IFC/, "Ifc");
  }
  return String(type);
}

function setStatus(message) {
  statusText.textContent = message;
}

function showLoading(message) {
  if (!loadingEl || !loadingText) {
    return;
  }
  loadingText.textContent = message;
  loadingEl.classList.remove("hidden");
}

function hideLoading() {
  if (!loadingEl) {
    return;
  }
  loadingEl.classList.add("hidden");
}
