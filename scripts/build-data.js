import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildParameterMaps } from "./build-parameter-map.js";
import { buildTrussAnalysisCatalog } from "./parse-tre-analyzer.js";
import { assertProjectData, resolveProjectRoot } from "./resolve-project-root.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerRoot = path.resolve(__dirname, "..");
const projectRoot = resolveProjectRoot(viewerRoot);
assertProjectData(projectRoot);
const ddpRoot = path.join(viewerRoot, "data", "ddp");
const dataOut = path.join(viewerRoot, "data");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function formatFeetInches(feet) {
  const wholeFeet = Math.floor(feet);
  const inches = (feet - wholeFeet) * 12;
  return `${wholeFeet}'-${inches.toFixed(2)}"`;
}

function formatDdpSpan(units) {
  if (!units) {
    return null;
  }
  return formatFeetInches(units / 10000);
}

function formatDdpSpacing(value) {
  if (!value) {
    return null;
  }
  const parts = value.split("-");
  if (parts.length >= 2) {
    return `${parts[0]}'-${parts[1]}"`;
  }
  return value;
}

function formatTreSpan(inches) {
  if (!inches) {
    return null;
  }
  return formatFeetInches(inches / 12);
}

function readTreField(content, fieldName) {
  const match = content.match(new RegExp(`^${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

function parseTreMembers(content) {
  const sectionMatch = content.match(/\[ADDITIONAL CUTTING INFO\][\s\S]*?(?=\n\[|$)/);
  if (!sectionMatch) {
    return [];
  }

  const members = [];
  for (const line of sectionMatch[0].split(/\r?\n/)) {
    if (!/^\d+,/.test(line)) {
      continue;
    }
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length < 9) {
      continue;
    }

    const label = parts[4];
    const sizeIndex = /^2x/i.test(parts[5]) ? 5 : 6;
    const size = parts[sizeIndex];
    const grade = `${parts[sizeIndex + 1] ?? ""} ${parts[sizeIndex + 2] ?? ""}`.trim();
    const length = parts[sizeIndex + 3] ?? "";

    if (!label || !size) {
      continue;
    }

    members.push({ label, size, grade, length });
  }
  return members;
}

function parseTrePlates(content) {
  const plateAreas = readTreField(content, "Plate Areas");
  const plateLines = content.match(/^Plate\d+=/gm) ?? [];
  const types = new Set();
  if (plateAreas) {
    for (const chunk of plateAreas.split(",")) {
      const type = chunk.trim().split(/\s+/)[0];
      if (type) {
        types.add(type);
      }
    }
  }
  return {
    count: plateLines.length,
    areas: plateAreas,
    types: [...types],
  };
}

function parseMitekJobFromIfc(ifcPath) {
  if (!fs.existsSync(ifcPath)) {
    return {
      jobNumber: "2214703-08T",
      projectFile: "2214703-08T.mmdl",
      customer: "Stark Truss",
      project: "Lot 17 Fox Creek Estates — Plan 193",
    };
  }

  const header = readText(ifcPath).slice(0, 4000);
  const projectMatch = header.match(/IFCPROJECT\([^,]+,[^,]+,'([^']+)'/);
  const dateMatch = header.match(/FILE_NAME \([^,]+, '([^']+)'/);
  const appMatch = header.match(/IFCAPPLICATION\([^,]+,'([^']+)'/);
  const projectFile = projectMatch?.[1] ?? "2214703-08T.mmdl";

  return {
    jobNumber: projectFile.replace(/\.mmdl$/i, ""),
    projectFile,
    exportDate: dateMatch?.[1]?.split("T")[0] ?? null,
    software: appMatch?.[1] ?? "MiTek X/AE Structure",
    customer: "Stark Truss",
    project: "Lot 17 Fox Creek Estates — Plan 193",
  };
}

function parseTreFile(filePath) {
  const content = readText(filePath);
  const base = path.basename(filePath, ".tre");
  const mark = base.toUpperCase();

  let spanInches = null;
  const lines = content.split(/\r?\n/);
  const roofIdx = lines.findIndex((line) => line.trim() === "ROOF BASICS");
  if (roofIdx >= 0 && lines[roofIdx + 1]) {
    const parts = lines[roofIdx + 1].trim().split(/\s+/);
    if (parts.length >= 2) {
      spanInches = Number.parseFloat(parts[1]);
    }
  }

  let quantity = null;
  let ply = null;
  for (const line of lines) {
    if (line.startsWith("Quantity=") && quantity === null) {
      quantity = Number.parseInt(line.slice("Quantity=".length), 10);
    }
    if (line.startsWith("Ply=") && ply === null) {
      ply = Number.parseInt(line.slice("Ply=".length), 10);
    }
    if (quantity !== null && ply !== null) {
      break;
    }
  }

  const pitchMatch = content.match(/^ROOF BASICS\r?\n[^\n]+\r?\n([^\n]+)/m);
  let pitch = null;
  if (pitchMatch) {
    const pitchParts = pitchMatch[1].trim().split(/\s+/);
    if (pitchParts.length >= 1) {
      const riseRun = Number.parseFloat(pitchParts[0]);
      if (!Number.isNaN(riseRun)) {
        pitch = `${riseRun.toFixed(2)}/12`;
      }
    }
  }

  const lumberMatch = content.match(/(2x\d,No\.[^,]+,SP)/);
  const spacingMatch = content.match(/0\.249971 0\.249998 24\.000000/);
  const spacingField = readTreField(content, "Spacing");
  const spacingDisplay = spacingField
    ? formatFeetInches(Number.parseFloat(spacingField) / 12)
    : spacingMatch
      ? '2\'-0"'
      : null;

  const leftOh = readTreField(content, "Left Overhang");
  const rightOh = readTreField(content, "Right Overhang");
  const trussType = readTreField(content, "TRUSS TYPE");
  const girder = readTreField(content, "Girder");
  const designCode = content.match(/(IRC\d{4}\/TPI\d{4})/)?.[1] ?? null;
  const weight = Number.parseFloat(readTreField(content, "Truss Weight") ?? "");
  const boardFeet = Number.parseFloat(readTreField(content, "Total Board Feet") ?? "");
  const spanField = readTreField(content, "Span");
  const spanFromInfo = spanField ? Number.parseFloat(spanField) : null;
  const resolvedSpanInches = spanFromInfo ?? spanInches;

  const members = parseTreMembers(content);
  const plates = parseTrePlates(content);

  return {
    mark,
    file: path.basename(filePath),
    source: "mitek-tre",
    quantity,
    ply,
    spanInches: resolvedSpanInches,
    spanDisplay: formatTreSpan(resolvedSpanInches),
    pitch,
    spacing: spacingDisplay,
    overhangLeft: leftOh ? formatFeetInches(Number.parseFloat(leftOh) / 12) : null,
    overhangRight: rightOh ? formatFeetInches(Number.parseFloat(rightOh) / 12) : null,
    trussType,
    girder: girder === "YES",
    designCode,
    lumber: lumberMatch ? lumberMatch[1] : "2x4, SP",
    species: "SP (Southern Pine)",
    topChordLumber: readTreField(content, "Top Chord Lumber"),
    bottomChordLumber: readTreField(content, "Bottom Chord Lumber"),
    loads: {
      tcLive: readTreField(content, "Top Chord Live Load"),
      tcDead: readTreField(content, "Top Chord Dead Load"),
      bcLive: readTreField(content, "Bottom Chord Live Load"),
      bcDead: readTreField(content, "Bottom Chord Dead Load"),
    },
    engineering: {
      maxTcCsi: readTreField(content, "Max Top Chord CSI"),
      maxBcCsi: readTreField(content, "Max Bottom Chord CSI"),
      ssi: readTreField(content, "SSI"),
      deflectionTL: readTreField(content, "Vertical (TL) Deflection"),
      deflectionLL: readTreField(content, "Vertical (LL) Deflection"),
      reaction1: readTreField(content, "Reaction1"),
      reaction2: readTreField(content, "Reaction2"),
      maxUplift1: readTreField(content, "Max Uplift1"),
      weight: Number.isNaN(weight) ? null : weight,
      boardFeet: Number.isNaN(boardFeet) ? null : boardFeet,
    },
    members,
    plates,
    designDate: readTreField(content, "Date"),
  };
}

function parseDdpTrussFile(filePath) {
  const content = readText(filePath);
  const mark = path.basename(filePath, ".tdlTruss").toUpperCase();
  const scriptMatch = content.match(/<Script>([\s\S]*?)<\/Script>/);
  const script = scriptMatch ? scriptMatch[1] : "";

  const readField = (name) => {
    const match = script.match(new RegExp(`^${name}:([^\\n\\r]+)`, "m"));
    return match ? match[1].trim() : null;
  };

  const spanUnits = Number.parseInt(readField("span") ?? "", 10);
  const plys = Number.parseInt(readField("plys") ?? "1", 10);
  const spacing = readField("spacing");
  const type = readField("type");

  const loadTemplate = script.match(/LoadTemplate:"([^"]+)"/);
  const loadTemplateLine = script.match(/LoadTemplate:([^\n]+)/);
  const windMatch = script.match(/wind:[^\n]*?\s(\d+\.\d+)\s/);
  const stdMatch = script.match(/^std:([^\n]+)/m);
  const snowLine = script.match(/^snow:([^\n]+)/m);

  let loads = null;
  if (stdMatch) {
    const parts = stdMatch[1].trim().split(/\s+/);
    loads = {
      tcLive: parts[0] ?? null,
      tcDead: parts[1] ?? null,
      bcLive: parts[2] ?? null,
      bcDead: parts[3] ?? null,
      total: parts[4] ?? null,
    };
  }

  let designCode = null;
  if (loadTemplateLine) {
    const codeMatch = loadTemplateLine[1].match(/"(IRC-\d{4})"/);
    designCode = codeMatch?.[1] ?? null;
  }

  const exportMatch = content.match(/<ExportData[^>]*Qty="([^"]*)"[^>]*weight="([^"]*)"[^>]*OCSpacing="([^"]*)"/);
  const maxCsiMatch = content.match(/<MaxCSI Val="([^"]+)"/);
  const reactionsMatch = content.match(/<Reactions Val="([^"]+)"/);
  const deflLlMatch = content.match(/<DeflectionControl_RoofDefl_LL_Truss Value="(\d+)"/);
  const deflTlMatch = content.match(/<DeflectionControl_RoofDefl_TL_Truss Value="(\d+)"/);

  let reactions = null;
  if (reactionsMatch) {
    const vMatches = [...reactionsMatch[1].matchAll(/V:(-?\d+)/g)];
    const uMatches = [...reactionsMatch[1].matchAll(/U:(-?\d+)/g)];
    reactions = {
      raw: reactionsMatch[1],
      maxDown: vMatches.length ? Math.max(...vMatches.map((m) => Number.parseInt(m[1], 10))) : null,
      maxUplift: uMatches.length ? Math.min(...uMatches.map((m) => Number.parseInt(m[1], 10))) : null,
    };
  }

  let snowPsf = null;
  if (snowLine) {
    const snowParts = snowLine[1].trim().split(/\s+/);
    snowPsf = Number.parseFloat(snowParts[3] ?? "");
    if (Number.isNaN(snowPsf)) snowPsf = null;
  }

  return {
    mark,
    source: "simpson-ddp",
    ply: plys,
    spanUnits: Number.isNaN(spanUnits) ? null : spanUnits,
    spanDisplay: formatDdpSpan(spanUnits),
    spacing: formatDdpSpacing(spacing),
    trussType: type,
    loadTemplate: loadTemplate ? loadTemplate[1] : null,
    designCode,
    windMph: windMatch ? Number.parseFloat(windMatch[1]) : null,
    snowPsf,
    loads,
    file: path.basename(filePath),
    engineering: {
      maxCsi: maxCsiMatch?.[1] ?? null,
      weight: exportMatch?.[2] ? Math.round(Number.parseFloat(exportMatch[2])) : null,
      deflectionLimitLl: deflLlMatch ? `L/${deflLlMatch[1]}` : null,
      deflectionLimitTl: deflTlMatch ? `L/${deflTlMatch[1]}` : null,
      reactions,
    },
  };
}

function parseManifest(manifestPath) {
  const xml = readText(manifestPath);
  const trusses = [];
  const miscItems = new Map();

  for (const match of xml.matchAll(/<DesignDataTruss>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<Name>([^<]+)<\/Name>/g)) {
    trusses.push({ key: match[1], name: match[2].toUpperCase() });
  }

  for (const match of xml.matchAll(/<DesignDataMiscItem>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<Name>([^<]+)<\/Name>/g)) {
    miscItems.set(match[1], match[2]);
  }

  const keyToName = new Map(trusses.map((item) => [item.key, item.name]));
  const stack = [];

  for (const match of xml.matchAll(/<DesignDataStackItem[^>]*Quantity="(\d+)"[^>]*(?:ComponentKey="([^"]+)"|MiscItemKey="([^"]+)")/g)) {
    const qty = Number.parseInt(match[1], 10);
    const componentKey = match[2];
    const miscKey = match[3];
    if (componentKey) {
      stack.push({
        mark: keyToName.get(componentKey) ?? componentKey,
        quantity: qty,
        kind: "truss",
      });
    } else if (miscKey) {
      stack.push({
        mark: miscItems.get(miscKey) ?? miscKey,
        quantity: qty,
        kind: "misc",
      });
    }
  }

  const trussQty = stack.filter((item) => item.kind === "truss");
  const miscQty = stack.filter((item) => item.kind === "misc");

  return {
    trussCount: trussQty.reduce((sum, item) => sum + item.quantity, 0),
    trussDesigns: trusses.length,
    stack: trussQty,
    misc: miscQty,
  };
}

function parseJobInfo(layoutXmlPath) {
  const xml = readText(layoutXmlPath);
  const pick = (tag) => {
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return match ? match[1] : null;
  };

  return {
    jobName: pick("job_name"),
    jobDesc: pick("job_desc"),
    planName: pick("plan_name"),
    customer: pick("customer_name"),
  };
}

function loadTreFiles() {
  const treDir = projectRoot;
  const files = fs
    .readdirSync(treDir)
    .filter((name) => /^[tj]\d+[a-z]*\.tre$/i.test(name))
    .map((name) => path.join(treDir, name));

  return files.map(parseTreFile).sort((a, b) => a.mark.localeCompare(b.mark, undefined, { numeric: true }));
}

function loadDdpTrusses() {
  const trussDir = path.join(ddpRoot, "Trusses");
  return fs
    .readdirSync(trussDir)
    .filter((name) => name.endsWith(".tdlTruss"))
    .map((name) => parseDdpTrussFile(path.join(trussDir, name)))
    .sort((a, b) => a.mark.localeCompare(b.mark, undefined, { numeric: true }));
}

function buildComparison(treRows, ddpTrusses, manifest) {
  const ddpQtyMap = new Map(manifest.stack.map((item) => [item.mark, item.quantity]));
  const ddpDetailMap = new Map(ddpTrusses.map((item) => [item.mark, item]));
  const treMap = new Map(treRows.map((item) => [item.mark, item]));

  const marks = new Set([
    ...treRows.map((item) => item.mark),
    ...ddpTrusses.map((item) => item.mark),
    ...manifest.stack.map((item) => item.mark),
  ]);

  const rows = [...marks]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((mark) => {
      const tre = treMap.get(mark);
      const ddp = ddpDetailMap.get(mark);
      const ddpQty = ddpQtyMap.get(mark) ?? null;
      const treQty = tre?.quantity ?? null;

      let status = "match";
      if (!tre || !ddp) {
        status = "missing";
      } else if (treQty !== ddpQty) {
        status = "qty-diff";
      } else if (tre.ply !== ddp.ply) {
        status = "ply-diff";
      }

      return {
        mark,
        mitekQty: treQty,
        mitekPly: tre?.ply ?? null,
        mitekSpan: tre?.spanDisplay ?? null,
        mitekPitch: tre?.pitch ?? null,
        simpsonQty: ddpQty,
        simpsonPly: ddp?.ply ?? null,
        simpsonSpan: ddp?.spanDisplay ?? null,
        simpsonSpacing: ddp?.spacing ?? null,
        status,
      };
    });

  const totals = {
    mitekTrusses: treRows.reduce((sum, row) => sum + (row.quantity ?? 0), 0),
    simpsonTrusses: manifest.trussCount,
    designs: rows.filter((row) => row.mitekQty || row.simpsonQty).length,
    matches: rows.filter((row) => row.status === "match").length,
    differences: rows.filter((row) => row.status !== "match" && row.status !== "missing").length,
    missing: rows.filter((row) => row.status === "missing").length,
  };

  return { rows, totals, misc: manifest.misc };
}

function buildMitekCatalog(treRows, jobInfo) {
  const totalWeight = treRows.reduce(
    (sum, row) => sum + (row.engineering.weight ?? 0) * (row.quantity ?? 0),
    0,
  );
  const totalBoardFeet = treRows.reduce(
    (sum, row) => sum + (row.engineering.boardFeet ?? 0) * (row.quantity ?? 0),
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    job: jobInfo,
    summary: {
      trussDesigns: treRows.length,
      totalTrusses: treRows.reduce((sum, row) => sum + (row.quantity ?? 0), 0),
      totalWeight: Math.round(totalWeight),
      totalBoardFeet: Math.round(totalBoardFeet * 100) / 100,
      designCode: treRows.find((row) => row.designCode)?.designCode ?? null,
    },
    trusses: treRows,
  };
}

function buildDdpCatalog(ddpTrusses, manifest, jobInfo) {
  const qtyMap = new Map(manifest.stack.map((item) => [item.mark, item.quantity]));
  const sample = ddpTrusses[0];

  const designCriteria = {
    code: sample?.designCode ?? "IRC-2015 / TPI-2014",
    standardLoads: "20-10-0-10",
    windMph: sample?.windMph ?? null,
    snowPsf: sample?.snowPsf ?? null,
    spacing: sample?.spacing ?? '2\'-0" O.C.',
    loadTemplate: sample?.loadTemplate ?? null,
  };

  return {
    generatedAt: new Date().toISOString(),
    job: jobInfo,
    summary: {
      trussDesigns: ddpTrusses.length,
      totalTrusses: manifest.trussCount,
      miscItems: manifest.misc.length,
      designCriteria,
    },
    layoutSchedule: manifest.stack.map((item) => ({
      mark: item.mark,
      quantity: item.quantity,
    })),
    trusses: ddpTrusses.map((truss) => ({
      ...truss,
      quantity: qtyMap.get(truss.mark) ?? null,
    })),
    misc: manifest.misc,
    layoutSvg: "/data/ddp/1-A/1-A.svg",
  };
}

function main() {
  if (!fs.existsSync(ddpRoot)) {
    console.error("DDP extract not found at", ddpRoot);
    console.error("Copy McBride DDP to viewer/data/ddp first.");
    process.exit(1);
  }

  const treRows = loadTreFiles();
  const ddpTrusses = loadDdpTrusses();
  const manifest = parseManifest(path.join(ddpRoot, "manifest.xml"));
  const jobInfo = parseJobInfo(path.join(ddpRoot, "1-A", "1-A.xml"));
  const mitekJob = parseMitekJobFromIfc(path.join(projectRoot, "2214703-08T.ifc"));

  const comparison = buildComparison(treRows, ddpTrusses, manifest);
  const catalog = buildDdpCatalog(ddpTrusses, manifest, jobInfo);
  const mitekCatalog = buildMitekCatalog(treRows, mitekJob);

  fs.mkdirSync(dataOut, { recursive: true });
  fs.writeFileSync(path.join(dataOut, "bom-comparison.json"), JSON.stringify(comparison, null, 2));
  fs.writeFileSync(path.join(dataOut, "ddp-catalog.json"), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(path.join(dataOut, "mitek-catalog.json"), JSON.stringify(mitekCatalog, null, 2));

  const trussAnalysis = buildTrussAnalysisCatalog(projectRoot);
  fs.writeFileSync(path.join(dataOut, "truss-analysis.json"), JSON.stringify(trussAnalysis, null, 2));

  const templateCandidates = [
    path.join(projectRoot, "Parameters Map.csv"),
    path.join(viewerRoot, "..", "Parameters Map.csv"),
  ];
  const templatePath = templateCandidates.find((candidate) => fs.existsSync(candidate));

  const parameterMaps = buildParameterMaps(projectRoot, dataOut, {
    templatePath: templatePath ?? templateCandidates[0],
  });
  console.log(`Parameter maps: ${parameterMaps.count} TRE files → data/parameter-maps/`);

  console.log(`Wrote ${comparison.rows.length} BOM rows (${comparison.totals.matches} matches)`);
  console.log(`Truss analysis: ${trussAnalysis.count} designs, ${trussAnalysis.girders.length} girders`);
  console.log(`MiTek total: ${comparison.totals.mitekTrusses}, Simpson total: ${comparison.totals.simpsonTrusses}`);
  console.log(`MiTek catalog: ${mitekCatalog.trusses.length} designs, ${mitekCatalog.summary.totalWeight} lb total weight`);
}

main();
