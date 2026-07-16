/**
 * Node file-I/O wrapper over the pure param-map core (shared/param-map-core.js).
 *
 * Reads the TRE files, CSV template, HS reference, and Simpson IFC off disk,
 * calls computeParameterDataset (pure — also used in the browser), and writes the
 * parameter-maps/ and connection-maps/ output. Keeps the buildParameterMaps
 * signature that build-data.js depends on.
 */
import fs from "fs";
import path from "path";
import { resolveParameterMapTemplate } from "./resolve-project-root.js";
import { parseSimpsonIfcBearings } from "./parse-simpson-ifc-bearings.js";
import { loadHsReference } from "./hs-reference.js";
import { computeParameterDataset } from "../shared/param-map-core.js";

export function buildParameterMaps(projectRoot, dataOutDir, options = {}) {
  const viewerRoot = options.viewerRoot ?? dataOutDir.replace(/[/\\]data[/\\]?$/, "");
  const templatePath =
    options.templatePath ?? resolveParameterMapTemplate(projectRoot, viewerRoot);
  if (!templatePath) {
    throw new Error(
      `Parameters Map template not found. Checked project root (${projectRoot}), ` +
        `project-data/, and parent folder. Run npm run sync-project-data to copy the template.`,
    );
  }

  const templateCsv = fs.readFileSync(templatePath, "utf8");
  const hsReference = loadHsReference(dataOutDir);

  const treFiles = fs
    .readdirSync(projectRoot)
    .filter((name) => /^[tj]\d+[a-z]*\.tre$/i.test(name))
    .sort()
    .map((name) => ({ name, text: fs.readFileSync(path.join(projectRoot, name), "utf8") }));

  const simpsonIfcPath =
    options.simpsonIfcPath ??
    [
      path.join(projectRoot, "McBride-Plan 193-Elev D-Std. 2nd FL plan - IFC.ifc"),
      path.join(viewerRoot, "project-data", "McBride-Plan 193-Elev D-Std. 2nd FL plan - IFC.ifc"),
      path.join(viewerRoot, "..", "McBride-Plan 193-Elev D-Std. 2nd FL plan - IFC.ifc"),
    ].find((candidate) => fs.existsSync(candidate));
  const simpsonBearings = simpsonIfcPath
    ? parseSimpsonIfcBearings(simpsonIfcPath)
    : { byMark: {}, found: false };

  const dataset = computeParameterDataset({
    treFiles,
    templateCsv,
    hsReference,
    simpsonBearings,
    templateName: path.basename(templatePath),
  });

  // --- Write parameter maps ---
  const mapsDir = path.join(dataOutDir, "parameter-maps");
  fs.mkdirSync(mapsDir, { recursive: true });
  for (const [mark, { csv, json }] of Object.entries(dataset.parameterMaps)) {
    fs.writeFileSync(path.join(mapsDir, `${mark}.csv`), csv);
    fs.writeFileSync(path.join(mapsDir, `${mark}.json`), JSON.stringify(json, null, 2));
  }
  fs.writeFileSync(path.join(mapsDir, "index.json"), JSON.stringify(dataset.parameterIndex, null, 2));
  fs.writeFileSync(
    path.join(mapsDir, "truss-connections.json"),
    JSON.stringify(dataset.trussConnections, null, 2),
  );

  // Also emit the CSV template so the browser runtime can fetch it for
  // client-side parameter-map generation from user-uploaded TRE.
  fs.writeFileSync(path.join(dataOutDir, "parameters-map-template.csv"), templateCsv);

  // --- Write connection maps (clear stale first: ids are per-hanger-instance) ---
  const connDir = path.join(dataOutDir, "connection-maps");
  fs.mkdirSync(connDir, { recursive: true });
  for (const name of fs.readdirSync(connDir)) {
    if (name.endsWith(".json")) fs.rmSync(path.join(connDir, name));
  }
  for (const [id, record] of Object.entries(dataset.connectionRecords)) {
    fs.writeFileSync(path.join(connDir, `${id}.json`), JSON.stringify(record, null, 2));
  }
  fs.writeFileSync(path.join(connDir, "index.json"), JSON.stringify(dataset.connectionIndex, null, 2));

  // --- Mirror CSVs + index into project-data/ for the standalone git deploy ---
  const projectMapsDir = path.join(projectRoot, "parameter-maps");
  if (projectMapsDir !== mapsDir) {
    fs.mkdirSync(projectMapsDir, { recursive: true });
    for (const mark of dataset.parameterIndex.marks) {
      fs.copyFileSync(path.join(mapsDir, `${mark}.csv`), path.join(projectMapsDir, `${mark}.csv`));
    }
    fs.copyFileSync(path.join(mapsDir, "index.json"), path.join(projectMapsDir, "index.json"));
  }

  return { ...dataset.parameterIndex, connectionCount: dataset.connectionIndex.count };
}
