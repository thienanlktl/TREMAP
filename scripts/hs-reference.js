/**
 * Node file-I/O wrapper over the pure HS-reference core (shared/hs-reference.js).
 * The build reads hanger-selector-reference.json off disk; all label/field logic
 * lives in the shared core so the browser can reuse it.
 */
import fs from "fs";
import path from "path";

export * from "../shared/hs-reference.js";

export function loadHsReference(dataOutDir) {
  const refPath = path.join(dataOutDir, "hanger-selector-reference.json");
  if (!fs.existsSync(refPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(refPath, "utf8"));
}
