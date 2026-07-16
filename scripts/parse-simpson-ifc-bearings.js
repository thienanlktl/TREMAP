/**
 * Node file-I/O wrapper over the pure Simpson-IFC core (shared/simpson-ifc-core.js).
 */
import fs from "fs";
import path from "path";
import { parseSimpsonIfcBearingsText } from "../shared/simpson-ifc-core.js";

export { parseSimpsonIfcBearingsText } from "../shared/simpson-ifc-core.js";

/** Parse a Simpson IFC export file for per-truss bearing Connection Type. */
export function parseSimpsonIfcBearings(ifcPath) {
  if (!fs.existsSync(ifcPath)) {
    return { byMark: {}, source: ifcPath, found: false };
  }
  return parseSimpsonIfcBearingsText(fs.readFileSync(ifcPath, "utf8"), path.basename(ifcPath));
}
