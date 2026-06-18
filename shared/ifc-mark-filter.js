import { IFCRELAGGREGATES, IFCELEMENTASSEMBLY } from "web-ifc";
import { Color, MeshLambertMaterial } from "three";
import { normalizeTrussMark } from "./truss-links.js";

export const FILTER_SUBSET_ID = "truss-mark-filter";
export const HIGHLIGHT_SUBSET_ID = "truss-mark-highlight";

const HIGHLIGHT_COLORS = {
  mitek: 0x60a5fa,
  simpson: 0x34d399,
  default: 0xf59e0b,
};

export function readIfcValue(field) {
  if (field == null) {
    return null;
  }
  if (typeof field === "object" && "value" in field) {
    return field.value;
  }
  return field;
}

export function getModelMesh(viewer, modelID) {
  return viewer.context.items.ifcModels.find((model) => model.modelID === modelID);
}

export function isTrussMark(mark) {
  return mark != null && /^[TJ]\d+[A-Z]*$/i.test(mark);
}

function isTrussRootAssembly(assembly, mark) {
  const rawName = readIfcValue(assembly?.Name);
  const predefined = String(readIfcValue(assembly?.PredefinedType) ?? "").toUpperCase();
  if (isTrussRootName(rawName, mark)) {
    return true;
  }
  return predefined.includes("TRUSS") && normalizeTrussMark(rawName) === mark.toUpperCase();
}

function isTrussRootName(name, mark) {
  return String(name ?? "").trim().toUpperCase() === mark.toUpperCase();
}

function getLineType(ifcAPI, modelID, expressId) {
  try {
    return ifcAPI.GetLineType(modelID, expressId);
  } catch {
    return null;
  }
}

function isElementAssembly(ifcAPI, modelID, expressId) {
  return getLineType(ifcAPI, modelID, expressId) === IFCELEMENTASSEMBLY;
}

function buildAggregateChildren(ifcAPI, modelID) {
  const children = new Map();
  const relIds = ifcAPI.GetLineIDsWithType(modelID, IFCRELAGGREGATES);

  for (let i = 0; i < relIds.size(); i += 1) {
    const rel = safeGetLine(ifcAPI, modelID, relIds.get(i));
    if (!rel) {
      continue;
    }

    const parentRef = rel.RelatingObject?.value ?? rel.RelatingObject;
    if (!parentRef) {
      continue;
    }

    if (!children.has(parentRef)) {
      children.set(parentRef, new Set());
    }

    for (const item of rel.RelatedObjects ?? []) {
      const childId = item.value ?? item;
      children.get(parentRef).add(childId);
    }
  }

  return children;
}

function expandAggregateDescendants(rootIds, aggregateChildren) {
  const result = new Set();
  const stack = [...rootIds];

  while (stack.length > 0) {
    const id = stack.pop();
    if (result.has(id)) {
      continue;
    }
    result.add(id);

    for (const childId of aggregateChildren.get(id) ?? []) {
      stack.push(childId);
    }
  }

  return result;
}

function getIfcManager(viewer) {
  return viewer.IFC.loader.ifcManager;
}

function safeGetLine(ifcAPI, modelID, expressId) {
  try {
    return ifcAPI.GetLine(modelID, expressId);
  } catch {
    return null;
  }
}

function indexAssemblyTree(
  ifcAPI,
  modelID,
  expressId,
  aggregateChildren,
  childToMark,
  markToIds,
  markToInstances,
) {
  if (!isElementAssembly(ifcAPI, modelID, expressId)) {
    return;
  }

  const assembly = safeGetLine(ifcAPI, modelID, expressId);
  if (!assembly) {
    return;
  }

  const rawName = readIfcValue(assembly.Name);
  const mark = normalizeTrussMark(rawName);
  if (!isTrussMark(mark)) {
    return;
  }

  const directChildren = [...(aggregateChildren.get(expressId) ?? [])];
  const allIds = expandAggregateDescendants([expressId, ...directChildren], aggregateChildren);

  for (const id of allIds) {
    childToMark.set(id, mark);
    if (!markToIds.has(mark)) {
      markToIds.set(mark, new Set());
    }
    markToIds.get(mark).add(id);
  }

  if (isTrussRootAssembly(assembly, mark)) {
    if (!markToInstances.has(mark)) {
      markToInstances.set(mark, []);
    }
    markToInstances.get(mark).push(new Set(allIds));
  }
}

export async function buildMarkIndex(viewer, modelID) {
  const childToMark = new Map();
  const markToIds = new Map();
  const markToInstances = new Map();
  const ifcAPI = viewer.IFC.loader.ifcManager.ifcAPI;

  try {
    const aggregateChildren = buildAggregateChildren(ifcAPI, modelID);

    const assemblyIds = ifcAPI.GetLineIDsWithType(modelID, IFCELEMENTASSEMBLY);
    for (let i = 0; i < assemblyIds.size(); i += 1) {
      indexAssemblyTree(
        ifcAPI,
        modelID,
        assemblyIds.get(i),
        aggregateChildren,
        childToMark,
        markToIds,
        markToInstances,
      );
    }

    for (const [mark, idSet] of markToIds) {
      if (!markToInstances.has(mark) || markToInstances.get(mark).length === 0) {
        markToInstances.set(mark, [new Set(idSet)]);
      }
    }
  } catch (error) {
    console.warn("Could not build truss map from aggregates", error);
  }

  return { childToMark, markToIds, markToInstances };
}

function removeHighlightSubset(viewer, modelID) {
  try {
    getIfcManager(viewer).removeSubset(modelID, undefined, HIGHLIGHT_SUBSET_ID);
  } catch {
    // ignore
  }
}

function restoreModelOpacity(viewer, modelID) {
  const modelMesh = getModelMesh(viewer, modelID);
  if (!modelMesh) {
    return;
  }

  modelMesh.traverse((child) => {
    if (!child.material) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material.userData?._markFilterDimmed) {
        material.opacity = material.userData._markFilterOriginalOpacity ?? 1;
        material.transparent = material.userData._markFilterOriginalTransparent ?? false;
        delete material.userData._markFilterDimmed;
      }
    }
  });
}

function dimModel(viewer, modelID, opacity = 0.2) {
  const modelMesh = getModelMesh(viewer, modelID);
  if (!modelMesh) {
    return;
  }

  modelMesh.traverse((child) => {
    if (!child.material) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material.userData?._markFilterDimmed) {
        material.userData._markFilterOriginalOpacity = material.opacity;
        material.userData._markFilterOriginalTransparent = material.transparent;
        material.userData._markFilterDimmed = true;
      }
      material.transparent = true;
      material.opacity = opacity;
      material.needsUpdate = true;
    }
  });
}

export function clearMarkFilter(viewer, modelID, subsetId = FILTER_SUBSET_ID) {
  if (modelID == null) {
    return;
  }

  const manager = getIfcManager(viewer);
  try {
    manager.removeSubset(modelID, undefined, subsetId);
  } catch {
    // subset may not exist
  }

  removeHighlightSubset(viewer, modelID);
  restoreModelOpacity(viewer, modelID);

  try {
    manager.showAllItems(modelID);
  } catch (error) {
    console.warn("Could not restore all IFC items", error);
  }

  const modelMesh = getModelMesh(viewer, modelID);
  if (modelMesh) {
    modelMesh.visible = true;
  }
}

function resolveFilterIds(mark, markToIds, markToInstances, options = {}) {
  const normalized = mark.toUpperCase();
  const { singleInstance = false, instanceIndex = 0 } = options;

  if (singleInstance && markToInstances?.has(normalized)) {
    const instances = markToInstances.get(normalized);
    if (instances.length) {
      const index = Math.min(Math.max(instanceIndex, 0), instances.length - 1);
      const instanceSet = instances[index];
      if (instanceSet?.size) {
        return { normalized, ids: [...instanceSet] };
      }
    }
  }

  const ids = markToIds.get(normalized);
  return { normalized, ids: ids ? [...ids] : [] };
}

async function fitViewerToFrame(viewer) {
  try {
    await viewer.context.fitToFrame();
  } catch {
    // ignore fit errors
  }
}

function createHighlightSubset(viewer, modelID, ids, colorKey = "default") {
  removeHighlightSubset(viewer, modelID);
  const material = new MeshLambertMaterial({
    color: new Color(HIGHLIGHT_COLORS[colorKey] ?? HIGHLIGHT_COLORS.default),
    transparent: false,
  });

  getIfcManager(viewer).createSubset({
    modelID,
    ids,
    removePrevious: true,
    customID: HIGHLIGHT_SUBSET_ID,
    material,
    scene: viewer.context.getScene(),
    applyBVH: true,
  });
}

async function applyIsolateFilter(viewer, modelID, ids, subsetId) {
  const manager = getIfcManager(viewer);
  const modelMesh = getModelMesh(viewer, modelID);
  if (modelMesh) {
    modelMesh.visible = true;
  }

  try {
    manager.hideAllItems(modelID);
    manager.showItems(modelID, ids);
    return true;
  } catch (error) {
    console.warn("hide/show filter failed, falling back to subset", error);
    if (modelMesh) {
      modelMesh.visible = false;
    }
    manager.createSubset({
      modelID,
      ids,
      removePrevious: true,
      customID: subsetId,
      scene: viewer.context.getScene(),
      applyBVH: true,
    });
    return true;
  }
}

async function applyHighlightFilter(viewer, modelID, ids, colorKey = "default") {
  const manager = getIfcManager(viewer);
  manager.showAllItems(modelID);

  const modelMesh = getModelMesh(viewer, modelID);
  if (modelMesh) {
    modelMesh.visible = true;
  }

  dimModel(viewer, modelID, 0.18);
  createHighlightSubset(viewer, modelID, ids, colorKey);
}

export async function applyMarkFilter(
  viewer,
  modelID,
  mark,
  markToIds,
  subsetId = FILTER_SUBSET_ID,
  options = {},
) {
  const { normalized, ids } = resolveFilterIds(mark, markToIds, options.markToInstances, options);
  const mode = options.mode ?? "auto";
  const colorKey = options.colorKey ?? "default";

  if (!ids.length) {
    return { mark: normalized, count: 0, instanceCount: 0, instanceIndex: 0, mode: "none" };
  }

  clearMarkFilter(viewer, modelID, subsetId);

  let appliedMode = "isolate";
  if (mode === "highlight") {
    await applyHighlightFilter(viewer, modelID, ids, colorKey);
    appliedMode = "highlight";
  } else if (mode === "isolate") {
    await applyIsolateFilter(viewer, modelID, ids, subsetId);
    appliedMode = "isolate";
  } else {
    await applyIsolateFilter(viewer, modelID, ids, subsetId);
    appliedMode = "isolate";
  }

  await fitViewerToFrame(viewer);

  const instanceCount = options.markToInstances?.get(normalized)?.length ?? 1;
  return {
    mark: normalized,
    count: ids.length,
    instanceCount,
    instanceIndex: options.singleInstance
      ? Math.min(Math.max(options.instanceIndex ?? 0, 0), Math.max(instanceCount - 1, 0))
      : null,
    mode: appliedMode,
  };
}

export function syncMarkParam(mark, instanceIndex = null) {
  const params = new URLSearchParams(window.location.search);
  if (mark) {
    params.set("mark", mark);
    if (instanceIndex != null && instanceIndex > 0) {
      params.set("instance", String(instanceIndex));
    } else {
      params.delete("instance");
    }
  } else {
    params.delete("mark");
    params.delete("instance");
  }
  const query = params.toString();
  history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
}

export function getInstanceCount(markToInstances, mark) {
  return markToInstances?.get(mark?.toUpperCase())?.length ?? 0;
}
