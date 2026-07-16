/**
 * Data-source accessor used by every page.
 *
 * If the user has loaded their own project (project-store), the SST datasets are
 * computed in the browser from their TRE text via the shared cores. Otherwise the
 * pages read the bundled sample JSON/CSV baked at build time (today's behavior).
 *
 * All accessors are async and return the same shapes the pages already consume.
 */
import { getProject } from "./project-store.js";
import { buildTrussAnalysisCatalogFromTexts } from "./tre-core.js";
import { computeParameterDataset } from "./param-map-core.js";
import { parseSimpsonIfcBearingsText } from "./simpson-ifc-core.js";

let _projectPromise = null; // memoized getProject()
let _datasetPromise = null; // memoized computed user dataset (per page load)

function project() {
  if (!_projectPromise) _projectPromise = getProject();
  return _projectPromise;
}

async function fetchJson(url) {
  const r = await fetch(url);
  return r.ok ? r.json() : null;
}

async function fetchText(url) {
  const r = await fetch(url);
  return r.ok ? r.text() : null;
}

async function computeUserDataset(proj) {
  const [templateCsv, hsReference] = await Promise.all([
    fetchText("/data/parameters-map-template.csv"),
    fetchJson("/data/hanger-selector-reference.json"),
  ]);

  const treFiles = proj.treFiles ?? [];

  // Simpson IFC bearing validation is optional. Only worth parsing a Simpson
  // export (which carries the "Connection Type" psets) — skip the expensive scan
  // on a MiTek IFC that doesn't have them.
  let simpsonBearings = { byMark: {}, found: false };
  if (proj.ifcBlob) {
    try {
      const ifcText = await proj.ifcBlob.text();
      if (/Connection Type/i.test(ifcText) && /\.TRUSS\./.test(ifcText)) {
        simpsonBearings = parseSimpsonIfcBearingsText(ifcText, proj.ifcName ?? "user.ifc");
      }
    } catch {
      /* ignore — bearing validation is optional */
    }
  }

  const trussAnalysis = buildTrussAnalysisCatalogFromTexts(treFiles);
  const ds = computeParameterDataset({ treFiles, templateCsv, hsReference, simpsonBearings });
  return { trussAnalysis, ...ds };
}

async function userDataset() {
  const proj = await project();
  if (!proj || !(proj.treFiles?.length)) return null;
  if (!_datasetPromise) _datasetPromise = computeUserDataset(proj);
  return _datasetPromise;
}

/** "sample" | "user" — which source is active right now. */
export async function activeSource() {
  const proj = await project();
  return proj && proj.treFiles?.length ? "user" : "sample";
}

/** Human label for the toolbar chip. */
export async function sourceLabel() {
  const proj = await project();
  if (proj && proj.treFiles?.length) {
    const n = proj.treFiles.length;
    return proj.label || `My project — ${n} TRE file${n === 1 ? "" : "s"}`;
  }
  return "Sample — McBride Plan 193";
}

// --- Truss Analyzer ---
export async function getTrussAnalysis() {
  const ds = await userDataset();
  if (ds) return ds.trussAnalysis;
  return fetchJson("/data/truss-analysis.json");
}

// --- Parameter maps ---
export async function getParameterIndex() {
  const ds = await userDataset();
  if (ds) return ds.parameterIndex;
  return fetchJson("/data/parameter-maps/index.json");
}

export async function getParameterMap(mark) {
  const ds = await userDataset();
  if (ds) {
    const m = ds.parameterMaps[mark];
    return m ? { csvText: m.csv, json: m.json } : { csvText: null, json: null };
  }
  const [csvText, json] = await Promise.all([
    fetchText(`/data/parameter-maps/${mark}.csv`),
    fetchJson(`/data/parameter-maps/${mark}.json`),
  ]);
  return { csvText, json };
}

// --- Connections ---
export async function getConnectionIndex() {
  const ds = await userDataset();
  if (ds) return ds.connectionIndex;
  return fetchJson("/data/connection-maps/index.json");
}

export async function getConnection(id) {
  const ds = await userDataset();
  if (ds) return ds.connectionRecords[id] ?? null;
  return fetchJson(`/data/connection-maps/${id}.json`);
}

export async function getHsReference() {
  return fetchJson("/data/hanger-selector-reference.json");
}
