/**
 * Node file-I/O wrapper over the pure TRE core (shared/tre-core.js).
 *
 * The parsing/calc logic lives in shared/tre-core.js so it runs in the browser
 * too (shared/dataset.js). This module just reads files off disk for the Node
 * build (build-data.js) and re-exports the core functions the build scripts use.
 */
import fs from "fs";
import path from "path";
import {
  parseTreAnalyzerText,
  buildTrussAnalysisCatalogFromTexts,
} from "../shared/tre-core.js";

export {
  parseReactionAtBearing,
  bearingReactionForSeat,
  buildGirderIndex,
  readTreField,
  formatFeetInches,
  parseTreAnalyzerText,
} from "../shared/tre-core.js";

export function parseTreAnalyzer(filePath) {
  return parseTreAnalyzerText(path.basename(filePath), fs.readFileSync(filePath, "utf8"));
}

export function buildTrussAnalysisCatalog(treDir) {
  const files = fs
    .readdirSync(treDir)
    .filter((name) => /^[tj]\d+[a-z]*\.tre$/i.test(name))
    .sort()
    .map((name) => ({ name, text: fs.readFileSync(path.join(treDir, name), "utf8") }));

  return buildTrussAnalysisCatalogFromTexts(files);
}
