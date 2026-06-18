import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { IFCRELAGGREGATES, IFCELEMENTASSEMBLY, IfcAPI } from "web-ifc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parentDir = path.resolve(__dirname, "..", "..");

function readIfcValue(field) {
  if (field == null) return null;
  if (typeof field === "object" && "value" in field) return field.value;
  return field;
}

function normalizeTrussMark(name) {
  if (name == null) return null;
  const upper = String(name).toUpperCase().trim();
  const match = upper.match(/^([TJ]\d+[A-Z]*)/);
  return match ? match[1] : upper.split(/\s+/)[0];
}

function isTrussMark(mark) {
  return mark != null && /^[TJ]\d+[A-Z]*$/i.test(mark);
}

function isTrussRootName(name, mark) {
  return String(name ?? "").trim().toUpperCase() === mark.toUpperCase();
}

function isTrussRootAssembly(assembly, mark) {
  const rawName = readIfcValue(assembly?.Name);
  const predefined = String(readIfcValue(assembly?.PredefinedType) ?? "").toUpperCase();
  if (isTrussRootName(rawName, mark)) return true;
  return predefined.includes("TRUSS") && normalizeTrussMark(rawName) === mark.toUpperCase();
}

function getLineType(ifcAPI, modelID, expressId) {
  try {
    return ifcAPI.GetLineType(modelID, expressId);
  } catch {
    return null;
  }
}

function buildAggregateChildren(ifcAPI, modelID) {
  const children = new Map();
  const relIds = ifcAPI.GetLineIDsWithType(modelID, IFCRELAGGREGATES);
  for (let i = 0; i < relIds.size(); i += 1) {
    const rel = ifcAPI.GetLine(modelID, relIds.get(i));
    const parentRef = rel.RelatingObject?.value ?? rel.RelatingObject;
    if (!parentRef) continue;
    if (!children.has(parentRef)) children.set(parentRef, new Set());
    for (const item of rel.RelatedObjects ?? []) {
      children.get(parentRef).add(item.value ?? item);
    }
  }
  return children;
}

function expandAggregateDescendants(rootIds, aggregateChildren) {
  const result = new Set();
  const stack = [...rootIds];
  while (stack.length > 0) {
    const id = stack.pop();
    if (result.has(id)) continue;
    result.add(id);
    for (const childId of aggregateChildren.get(id) ?? []) {
      stack.push(childId);
    }
  }
  return result;
}

function buildMarkIndex(ifcAPI, modelID) {
  const markToIds = new Map();
  const markToInstances = new Map();
  const aggregateChildren = buildAggregateChildren(ifcAPI, modelID);
  const assemblyIds = ifcAPI.GetLineIDsWithType(modelID, IFCELEMENTASSEMBLY);

  for (let i = 0; i < assemblyIds.size(); i += 1) {
    const expressId = assemblyIds.get(i);
    if (getLineType(ifcAPI, modelID, expressId) !== IFCELEMENTASSEMBLY) continue;

    const assembly = ifcAPI.GetLine(modelID, expressId);
    const rawName = readIfcValue(assembly.Name);
    const mark = normalizeTrussMark(rawName);
    if (!isTrussMark(mark)) continue;

    const directChildren = [...(aggregateChildren.get(expressId) ?? [])];
    const allIds = expandAggregateDescendants([expressId, ...directChildren], aggregateChildren);

    for (const id of allIds) {
      if (!markToIds.has(mark)) markToIds.set(mark, new Set());
      markToIds.get(mark).add(id);
    }

    if (isTrussRootAssembly(assembly, mark)) {
      if (!markToInstances.has(mark)) markToInstances.set(mark, []);
      markToInstances.get(mark).push(new Set(allIds));
    }
  }

  for (const [mark, idSet] of markToIds) {
    if (!markToInstances.has(mark) || markToInstances.get(mark).length === 0) {
      markToInstances.set(mark, [new Set(idSet)]);
    }
  }

  return { markToIds, markToInstances };
}

async function testFile(label, filePath) {
  console.log(`\n=== ${label} ===`);
  const ifcAPI = new IfcAPI();
  await ifcAPI.Init();
  const data = new Uint8Array(fs.readFileSync(filePath));
  let modelID;
  try {
    modelID = ifcAPI.OpenModel(data);
  } catch (error) {
    console.error("OpenModel failed:", error.message);
    return;
  }

  const { markToIds, markToInstances } = buildMarkIndex(ifcAPI, modelID);
  console.log("Marks indexed:", markToIds.size);
  for (const mark of ["T01", "T04", "J06"]) {
    const ids = markToIds.get(mark);
    const instances = markToInstances.get(mark);
    console.log(
      `  ${mark}: ${ids?.size ?? 0} ids, ${instances?.length ?? 0} instances` +
        (instances?.[0] ? `, instance[0]=${instances[0].size}` : ""),
    );
  }
  ifcAPI.CloseModel(modelID);
}

await testFile("MiTek", path.join(parentDir, "2214703-08T.ifc"));
await testFile(
  "Simpson",
  path.join(parentDir, "McBride-Plan 193-Elev D-Std. 2nd FL plan - IFC.ifc"),
);
