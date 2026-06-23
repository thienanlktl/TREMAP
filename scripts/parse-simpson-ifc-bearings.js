import fs from "fs";
import path from "path";
import { normalizeTrussMark } from "../shared/truss-links.js";

/**
 * Parse Simpson IFC export for per-truss bearing Connection Type (Wall / Hanger-To-Truss).
 */
export function parseSimpsonIfcBearings(ifcPath) {
  if (!fs.existsSync(ifcPath)) {
    return { byMark: {}, source: ifcPath, found: false };
  }

  const text = fs.readFileSync(ifcPath, "utf8");
  const entities = new Map();

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^#(\d+)=([A-Z0-9_]+)\((.*)\);?\s*$/);
    if (!match) continue;
    entities.set(match[1], { type: match[2], raw: match[3] });
  }

  function refs(raw) {
    return [...raw.matchAll(/#(\d+)/g)].map((m) => m[1]);
  }

  function quotedStrings(raw) {
    return [...raw.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  }

  const singles = new Map();
  for (const [id, entity] of entities) {
    if (entity.type !== "IFCPROPERTYSINGLEVALUE") continue;
    const strings = quotedStrings(entity.raw);
    if (!strings[0]) continue;
    singles.set(id, { name: strings[0], value: strings[1] ?? "" });
  }

  const complexes = new Map();
  for (const [id, entity] of entities) {
    if (entity.type !== "IFCCOMPLEXPROPERTY") continue;
    const strings = quotedStrings(entity.raw);
    complexes.set(id, { name: strings[0] ?? "", children: refs(entity.raw) });
  }

  const psets = new Map();
  for (const [id, entity] of entities) {
    if (entity.type !== "IFCPROPERTYSET") continue;
    psets.set(id, { children: refs(entity.raw) });
  }

  function collectProperties(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);

    const single = singles.get(nodeId);
    if (single) return [single];

    const complex = complexes.get(nodeId);
    if (complex) {
      return complex.children.flatMap((child) => collectProperties(child, visited));
    }

    const pset = psets.get(nodeId);
    if (pset) {
      return pset.children.flatMap((child) => collectProperties(child, visited));
    }

    return [];
  }

  const assemblyIdsByMark = new Map();
  for (const [id, entity] of entities) {
    if (entity.type !== "IFCELEMENTASSEMBLY") continue;
    if (!entity.raw.includes(".TRUSS.")) continue;
    const strings = quotedStrings(entity.raw);
    const mark = normalizeTrussMark(strings[2] ?? strings[1]);
    if (!mark || !/^[TJ]\d/.test(mark)) continue;
    if (!assemblyIdsByMark.has(mark)) assemblyIdsByMark.set(mark, []);
    assemblyIdsByMark.get(mark).push(id);
  }

  const byMark = {};

  for (const [mark, assemblyIds] of assemblyIdsByMark) {
    const bearings = [];
    const seen = new Set();

    for (const [relId, rel] of entities) {
      if (rel.type !== "IFCRELDEFINESBYPROPERTIES") continue;
      const relRefs = refs(rel.raw);
      const related = relRefs.slice(0, -1);
      const psetId = relRefs[relRefs.length - 1];
      if (!related.some((id) => assemblyIds.includes(id))) continue;

      for (const prop of collectProperties(psetId)) {
        if (prop.name !== "Connection Type") continue;
        const key = prop.value;
        if (seen.has(key)) continue;
        seen.add(key);
        bearings.push({ connectionType: prop.value });
      }
    }

    const hasHangerToTruss = bearings.some(
      (b) => /hanger/i.test(b.connectionType) && /truss/i.test(b.connectionType),
    );

    byMark[mark] = {
      bearings,
      hasHangerToTruss,
      wallOnly: bearings.length > 0 && !hasHangerToTruss,
    };
  }

  return { byMark, source: path.basename(ifcPath), found: true };
}
