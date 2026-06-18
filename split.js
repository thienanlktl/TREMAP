import { Color } from "three";
import { IfcViewerAPI } from "web-ifc-viewer";
import { mountNav } from "./shared/nav.js";
import {
  applyMarkFilter,
  buildMarkIndex,
  clearMarkFilter,
  FILTER_SUBSET_ID,
  getInstanceCount,
  syncMarkParam,
} from "./shared/ifc-mark-filter.js";
import { loadTrussSources, trussDetailUrl } from "./shared/truss-links.js";

mountNav("split");

const leftContainer = document.getElementById("viewer-left");
const rightContainer = document.getElementById("viewer-right");
const statusText = document.getElementById("status-text");
const loadingEl = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const markSelect = document.getElementById("mark-select");
const instanceSelect = document.getElementById("instance-select");
const filterBanner = document.getElementById("filter-banner");
const leftLabel = document.getElementById("left-label");
const rightLabel = document.getElementById("right-label");

let syncEnabled = true;
let syncing = false;
let leftModelId = null;
let rightModelId = null;
let leftMarkToIds = new Map();
let rightMarkToIds = new Map();
let leftMarkToInstances = new Map();
let rightMarkToInstances = new Map();
let activeMark = null;
let activeInstance = 0;

const leftViewer = new IfcViewerAPI({
  container: leftContainer,
  backgroundColor: new Color(0x141a22),
});

const rightViewer = new IfcViewerAPI({
  container: rightContainer,
  backgroundColor: new Color(0x141a22),
});

leftViewer.axes.setAxes();
leftViewer.grid.setGrid();
rightViewer.axes.setAxes();
rightViewer.grid.setGrid();

await leftViewer.IFC.setWasmPath("/wasm/");
await rightViewer.IFC.setWasmPath("/wasm/");

setupSync();
setupControls();
await populateMarkSelect();

const initialParams = new URLSearchParams(window.location.search);
const initialMark = initialParams.get("mark")?.toUpperCase() ?? null;
const initialInstance = Number.parseInt(initialParams.get("instance") ?? "0", 10);

if (markSelect && initialMark) {
  markSelect.value = initialMark;
}

try {
  showLoading("Loading MiTek model (left)…");
  const leftModel = await leftViewer.IFC.loadIfcUrl("/models/mitek.ifc", true);
  if (!leftModel) {
    throw new Error("MiTek model failed to load");
  }
  leftModelId = leftModel.modelID;
  const leftIndex = await buildMarkIndex(leftViewer, leftModelId);
  leftMarkToIds = leftIndex.markToIds;
  leftMarkToInstances = leftIndex.markToInstances;

  showLoading("Loading Simpson model (right)…");
  const rightModel = await rightViewer.IFC.loadIfcUrl("/models/simpson.ifc", true);
  if (!rightModel) {
    throw new Error("Simpson model failed to load");
  }
  rightModelId = rightModel.modelID;
  const rightIndex = await buildMarkIndex(rightViewer, rightModelId);
  rightMarkToIds = rightIndex.markToIds;
  rightMarkToInstances = rightIndex.markToInstances;

  if (initialMark) {
    activeInstance = Number.isNaN(initialInstance) ? 0 : initialInstance;
    updateInstanceSelect(initialMark);
    await applySplitMarkFilter(initialMark, activeInstance);
  } else {
    await leftViewer.context.fitToFrame();
    await rightViewer.context.fitToFrame();
    setStatus(
      `Both models loaded — MiTek: ${leftMarkToIds.size} marks · Simpson: ${rightMarkToIds.size} marks — pick a truss to compare`,
    );
  }
} catch (error) {
  console.error(error);
  setStatus("Failed to load one or both models. Check that IFC files exist.");
} finally {
  hideLoading();
}

async function populateMarkSelect() {
  if (!markSelect) {
    return;
  }

  markSelect.replaceChildren(new Option("All trusses", ""));

  try {
    const sources = await loadTrussSources();
    for (const mark of sources.marks) {
      markSelect.append(new Option(mark, mark));
    }
  } catch (error) {
    console.warn("Could not load truss marks", error);
  }
}

function setupControls() {
  document.getElementById("btn-fit-both").addEventListener("click", async () => {
    await leftViewer.context.fitToFrame();
    await rightViewer.context.fitToFrame();
  });

  document.getElementById("btn-sync-cam").addEventListener("click", (event) => {
    syncEnabled = !syncEnabled;
    event.currentTarget.classList.toggle("active", syncEnabled);
    setStatus(syncEnabled ? "Camera sync enabled" : "Camera sync disabled");
  });

  document.getElementById("btn-show-all")?.addEventListener("click", async () => {
    await clearSplitMarkFilter(true);
    if (markSelect) {
      markSelect.value = "";
    }
    updateInstanceSelect(null);
    await leftViewer.context.fitToFrame();
    await rightViewer.context.fitToFrame();
    setStatus("Showing full models on both sides");
  });

  markSelect?.addEventListener("change", async (event) => {
    const mark = event.target.value;
    if (!mark) {
      await clearSplitMarkFilter(true);
      updateInstanceSelect(null);
      await leftViewer.context.fitToFrame();
      await rightViewer.context.fitToFrame();
      setStatus("Showing full models on both sides");
      return;
    }
    activeInstance = 0;
    updateInstanceSelect(mark);
    await applySplitMarkFilter(mark, 0);
  });

  instanceSelect?.addEventListener("change", async (event) => {
    if (!activeMark) {
      return;
    }
    activeInstance = Number.parseInt(event.target.value, 10) || 0;
    await applySplitMarkFilter(activeMark, activeInstance);
  });
}

function updateInstanceSelect(mark) {
  if (!instanceSelect) {
    return;
  }

  if (!mark) {
    instanceSelect.classList.add("hidden");
    instanceSelect.replaceChildren();
    return;
  }

  const leftCount = getInstanceCount(leftMarkToInstances, mark);
  const rightCount = getInstanceCount(rightMarkToInstances, mark);
  const count = Math.max(leftCount, rightCount, 1);

  if (count <= 1) {
    instanceSelect.classList.add("hidden");
    instanceSelect.replaceChildren(new Option("Instance 1", "0"));
    return;
  }

  instanceSelect.classList.remove("hidden");
  instanceSelect.replaceChildren(
    ...Array.from({ length: count }, (_, index) => {
      const option = new Option(`Instance ${index + 1} of ${count}`, String(index));
      return option;
    }),
  );
  instanceSelect.value = String(Math.min(activeInstance, count - 1));
}

async function applySplitMarkFilter(mark, instanceIndex = 0) {
  const filterOptions = {
    markToInstances: null,
    singleInstance: true,
    instanceIndex,
  };

  const leftResult = await applyMarkFilter(
    leftViewer,
    leftModelId,
    mark,
    leftMarkToIds,
    FILTER_SUBSET_ID,
    { ...filterOptions, markToInstances: leftMarkToInstances, mode: "isolate", colorKey: "mitek" },
  );
  const rightResult = await applyMarkFilter(
    rightViewer,
    rightModelId,
    mark,
    rightMarkToIds,
    FILTER_SUBSET_ID,
    { ...filterOptions, markToInstances: rightMarkToInstances, mode: "highlight", colorKey: "simpson" },
  );

  activeMark = mark.toUpperCase();
  activeInstance = instanceIndex;
  syncMarkParam(activeMark, activeInstance);
  updateInstanceSelect(activeMark);

  const instanceNote =
    Math.max(leftResult.instanceCount, rightResult.instanceCount, 1) > 1
      ? ` · instance ${instanceIndex + 1}`
      : "";

  const modeNote =
    rightResult.mode === "highlight"
      ? " · Simpson highlighted in green"
      : "";

  updateFilterBanner(activeMark, leftResult.count, rightResult.count, instanceIndex);
  updatePaneLabels(activeMark, instanceIndex);

  if (leftResult.count && !rightResult.count) {
    setStatus(
      `Split compare: ${activeMark}${instanceNote} — MiTek ${leftResult.count} el. · Simpson: mark not indexed in IFC`,
    );
    return;
  }

  if (!leftResult.count && rightResult.count) {
    setStatus(
      `Split compare: ${activeMark}${instanceNote} — MiTek: no geometry · Simpson ${rightResult.count} el.${modeNote}`,
    );
    return;
  }

  setStatus(
    `Split compare: ${activeMark}${instanceNote} — MiTek ${leftResult.count} el. (isolated) · Simpson ${rightResult.count} el.${modeNote}`,
  );
}

async function clearSplitMarkFilter(updateUrl = true) {
  clearMarkFilter(leftViewer, leftModelId, FILTER_SUBSET_ID);
  clearMarkFilter(rightViewer, rightModelId, FILTER_SUBSET_ID);
  activeMark = null;
  activeInstance = 0;
  updateFilterBanner(null);
  updatePaneLabels(null);
  if (updateUrl) {
    syncMarkParam(null);
  }
}

function updatePaneLabels(mark, instanceIndex = 0) {
  const instanceSuffix =
    mark && getInstanceCount(leftMarkToInstances, mark) > 1
      ? ` #${instanceIndex + 1}`
      : "";

  if (leftLabel) {
    leftLabel.textContent = mark
      ? `MiTek — ${mark}${instanceSuffix} (IFC2x3)`
      : "MiTek — 2214703-08T (IFC2x3)";
  }
  if (rightLabel) {
    rightLabel.textContent = mark
      ? `Simpson — ${mark}${instanceSuffix} (IFC4)`
      : "Simpson — McBride Plan 193 (IFC4)";
  }
}

function updateFilterBanner(mark, leftCount = 0, rightCount = 0, instanceIndex = 0) {
  if (!filterBanner) {
    return;
  }

  if (!mark) {
    filterBanner.classList.add("hidden");
    document.body.classList.remove("has-filter");
    filterBanner.replaceChildren();
    return;
  }

  const instanceCount = Math.max(
    getInstanceCount(leftMarkToInstances, mark),
    getInstanceCount(rightMarkToInstances, mark),
    1,
  );

  filterBanner.classList.remove("hidden");
  document.body.classList.add("has-filter");
  filterBanner.replaceChildren();

  const label = document.createElement("span");
  const instanceLabel =
    instanceCount > 1 ? ` · instance ${instanceIndex + 1}/${instanceCount}` : "";
  label.textContent = `Split filtered: ${mark}${instanceLabel} — MiTek ${leftCount} (isolated) · Simpson ${rightCount} (highlight)`;
  filterBanner.append(label);

  const detailLink = document.createElement("a");
  detailLink.href = trussDetailUrl(mark);
  detailLink.className = "banner-link";
  detailLink.textContent = "Data compare";
  filterBanner.append(detailLink);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.id = "banner-clear";
  clearBtn.className = "btn secondary banner-btn";
  clearBtn.textContent = "Show all";
  clearBtn.addEventListener("click", async () => {
    if (markSelect) {
      markSelect.value = "";
    }
    await clearSplitMarkFilter(true);
    updateInstanceSelect(null);
    await leftViewer.context.fitToFrame();
    await rightViewer.context.fitToFrame();
    setStatus("Showing full models on both sides");
  });
  filterBanner.append(clearBtn);
}

function setupSync() {
  const leftControls = leftViewer.context.ifcCamera.cameraControls;
  const rightControls = rightViewer.context.ifcCamera.cameraControls;

  leftControls.addEventListener("control", () => {
    if (!syncEnabled || syncing) {
      return;
    }
    syncing = true;
    copyCamera(leftViewer, rightViewer);
    syncing = false;
  });

  rightControls.addEventListener("control", () => {
    if (!syncEnabled || syncing) {
      return;
    }
    syncing = true;
    copyCamera(rightViewer, leftViewer);
    syncing = false;
  });
}

function copyCamera(fromViewer, toViewer) {
  const fromCam = fromViewer.context.getCamera();
  const toCam = toViewer.context.getCamera();
  toCam.position.copy(fromCam.position);
  toCam.quaternion.copy(fromCam.quaternion);
  toCam.updateProjectionMatrix();
  toViewer.context.getRenderer().render(
    toViewer.context.getScene(),
    toViewer.context.getCamera(),
  );
}

function setStatus(message) {
  statusText.textContent = message;
}

function showLoading(message) {
  loadingText.textContent = message;
  loadingEl.classList.remove("hidden");
}

function hideLoading() {
  loadingEl.classList.add("hidden");
}
