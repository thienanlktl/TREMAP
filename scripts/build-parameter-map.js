import fs from "fs";
import path from "path";
import { parseCsv } from "../shared/parse-csv.js";
import { parseTreAnalyzer } from "./parse-tre-analyzer.js";

const PLACEHOLDER = "update this value with your caculation data in tre file";
const LUMBER_DEPTHS = { 4: 3.5, 6: 5.5, 8: 7.25, 10: 9.25, 12: 11.25 };

const SECTION_NAMES = new Set([
  "CONNECTION TYPE",
  "JOB SETTINGS",
  "HEADER / GIRDER (CARRYING MEMBER)",
  "JOIST / TRUSS / JACK (CARRIED MEMBER)",
  "LEFT HIP (CARRIED MEMBER)",
  "RIGHT HIP (CARRIED MEMBER)",
  "HANGER OPTIONS",
]);

/** Original Parameters Map.csv — which Joist / Truss / Multi column applies per parameter */
const COLUMN_APPLIES = {
  "CONNECTION TYPE": { joist: true, truss: true, multi: true },
  "Connection Type": { joist: true, truss: true, multi: true },
  "Hanger Type": { joist: true, truss: true, multi: true },
  "Fastener Type": { joist: true, truss: true, multi: true },
  Configuration: { multi: true },
  "ANSI/TPI 1 Evaluation": { truss: true, multi: true },
  "Download Duration": { joist: true, truss: true, multi: true },
  "Uplift Duration": { joist: true, truss: true, multi: true },
  "Job ID": { joist: true, truss: true, multi: true },
  Quantity: { joist: true, truss: true, multi: true },
  "Member Type": { joist: true, truss: true, multi: true },
  Type: { truss: true, multi: true },
  "Lumber Species": { joist: true, truss: true, multi: true },
  Width: { joist: true, truss: true, multi: true },
  "Bottom Chord Width": { truss: true, multi: true },
  Depth: { joist: true, truss: true, multi: true },
  "Bottom Chord Height": { truss: true, multi: true },
  "Heel Height": { truss: true, multi: true },
  "Number of Plies": { joist: true, truss: true, multi: true },
  "Vertical Width (King Post)": { truss: true, multi: true },
  "Total Height": { truss: true, multi: true },
  "Member ID": { joist: true, truss: true, multi: true },
  "Lumber Finish": { joist: true, truss: true, multi: true },
  "Download (ASD)": { joist: true, truss: true, multi: true },
  "Upload (ASD)": { joist: true, truss: true, multi: true },
  "Uplift (ASD)": { joist: true, truss: true, multi: true },
  "Slope (Degrees)": { multi: true },
  Skew: { joist: true, truss: true },
  Slope: { joist: true, truss: true },
  "Top Flange Bend": { joist: true, truss: true },
  "Top Flange Slope": { joist: true, truss: true },
  "Offset Direction (Top Flange Only)": { joist: true, truss: true },
  "High, Low, Center Flush": { joist: true, truss: true },
  "Member Type (Controlled by Jack inputs)": { multi: true },
  "Lumber Species (Controlled by Jack inputs)": { multi: true },
  "Skew (Degrees)": { multi: true },
};

function readTreField(content, fieldName) {
  const match = content.match(
    new RegExp(`^${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=(.+)$`, "m"),
  );
  return match ? match[1].trim() : null;
}

function parseLumberSize(lumberStr) {
  const match = lumberStr?.match(/(\d+)x(\d+)/i);
  if (!match) {
    return { width: 1.5, depth: null, nominal: null };
  }
  const nominalDepth = Number.parseInt(match[2], 10);
  return {
    width: 1.5,
    depth: LUMBER_DEPTHS[nominalDepth] ?? null,
    nominal: `${match[1]}x${match[2]}`,
  };
}

function parseSpecies(lumberStr) {
  const upper = (lumberStr ?? "").toUpperCase();
  if (upper.includes("SPF")) return "SPF";
  if (upper.includes("SP")) return "SP";
  if (upper.includes("DF") || upper.includes("D.FIR")) return "DF";
  if (upper.includes("HF")) return "HF";
  return "SP";
}

function trussMaterialEnum(species) {
  return { SP: 7, DF: 5, HF: 6, SPF: 8 }[species] ?? 7;
}

function materialLabel(enumValue) {
  return (
    { 5: "Truss — DF", 6: "Truss — HF", 7: "Truss — SP", 8: "Truss — SPF" }[enumValue] ??
    `material:${enumValue}`
  );
}

function pitchToSlopeDegrees(pitchStr) {
  const match = pitchStr?.match(/([\d.]+)\/12/);
  if (!match) return 0;
  return Math.round((Math.atan(Number.parseFloat(match[1]) / 12) * 180) / Math.PI * 10) / 10;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function isPlaceholder(value) {
  return String(value ?? "").trim().toLowerCase() === PLACEHOLDER.toLowerCase();
}

function inferConnectionType(tre) {
  const trussType = tre.trussType ?? "";

  if (/joist|i-joist|floor joist/i.test(trussType) && !/truss/i.test(trussType)) {
    return { id: "joist", column: "joist", label: "Joist (Flush Top)", flushOption: "TOP" };
  }

  if (tre.girder && tre.carriedLoads.length > 0) {
    const marks = new Set(tre.carriedLoads.map((entry) => entry.mark));
    if (marks.size >= 2) {
      return {
        id: "multi",
        column: "multi",
        label: "Multi-Truss (Flush Bottom)",
        flushOption: "BOTTOM",
      };
    }
  }

  if (/^J/.test(tre.mark) && /jack|hip|valley/i.test(trussType)) {
    return { id: "multi", column: "multi", label: "Multi-Truss (Flush Bottom)", flushOption: "BOTTOM" };
  }

  return { id: "truss", column: "truss", label: "Truss (Flush Bottom)", flushOption: "BOTTOM" };
}

function groupCarriedBySeat(carriedLoads) {
  const byMark = new Map();
  for (const entry of carriedLoads) {
    const existing = byMark.get(entry.mark);
    if (!existing) {
      byMark.set(entry.mark, { ...entry });
      continue;
    }
    existing.reactionDown = Math.max(existing.reactionDown, entry.reactionDown);
    existing.uplift = Math.max(existing.uplift, entry.uplift);
    existing.xFeet = Math.min(existing.xFeet, entry.xFeet);
  }

  const sorted = [...byMark.values()].sort((a, b) => a.xFeet - b.xFeet);
  if (sorted.length === 0) return { left: null, center: null, right: null };
  if (sorted.length === 1) return { left: null, center: sorted[0], right: null };
  if (sorted.length === 2) return { left: sorted[0], center: null, right: sorted[1] };
  return {
    left: sorted[0],
    center: sorted[Math.floor(sorted.length / 2)],
    right: sorted[sorted.length - 1],
  };
}

function buildTreContext(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const tre = parseTreAnalyzer(filePath);
  const bcSize = parseLumberSize(tre.bottomChordLumber);
  const tcSize = parseLumberSize(tre.topChordLumber);
  const species = parseSpecies(tre.bottomChordLumber ?? tre.topChordLumber);
  const material = trussMaterialEnum(species);
  const heelHeight = Number.parseFloat(readTreField(content, "Left Heel Height") ?? "");
  const trussHeight = Number.parseFloat(readTreField(content, "Truss Height") ?? "");
  const slopeDeg = pitchToSlopeDegrees(tre.pitch);
  const download =
    tre.engineering.reactionMax ?? Number.parseInt(readTreField(content, "Reaction1") ?? "", 10);
  const upliftRaw = tre.engineering.maxUplift1 ?? readTreField(content, "Max Uplift1");
  const uplift = upliftRaw != null ? Math.abs(Number.parseInt(String(upliftRaw), 10)) : null;
  const connection = inferConnectionType(tre);
  const seats = groupCarriedBySeat(tre.carriedLoads);

  const bcMember = tre.members.find((member) => member.role === "bc");
  const bcFromMember = parseLumberSize(bcMember?.size);
  const width = bcSize.width ?? bcFromMember.width ?? 1.5;
  const depth = bcSize.depth ?? bcFromMember.depth ?? (Number.isNaN(heelHeight) ? null : heelHeight);

  return {
    tre,
    content,
    connection,
    species,
    material,
    width,
    depth,
    heelHeight: Number.isNaN(heelHeight) ? depth : heelHeight,
    carryingWidth: width,
    carryingDepth: tcSize.depth ?? depth,
    carryingPly: tre.ply,
    slopeDeg,
    download: Number.isNaN(download) ? null : download,
    uplift: Number.isNaN(uplift) ? null : uplift,
    trussHeight: Number.isNaN(trussHeight) ? null : trussHeight,
    seats,
    role: tre.girder && tre.carriedLoads.length > 0 ? "carrying" : "carried",
  };
}

function hipSeat(ctx, section) {
  if (section.includes("LEFT HIP")) return ctx.seats.left;
  if (section.includes("RIGHT HIP")) return ctx.seats.right;
  return null;
}

function hipContext(ctx, seat, treCatalog) {
  if (!seat) return null;
  return treCatalog[seat.mark] ?? ctx;
}

function columnAllowed(label, column) {
  const applies = COLUMN_APPLIES[label];
  if (!applies) return SECTION_NAMES.has(label);
  return Boolean(applies[column]);
}

function computeCellValue(ctx, section, label, column, treCatalog) {
  const active = ctx.connection.column;
  if (column !== active) {
    return "";
  }

  if (!columnAllowed(label, column)) {
    return "";
  }

  if (SECTION_NAMES.has(label) || label.startsWith("LEFT HIP") || label.startsWith("RIGHT HIP")) {
    if ((label.startsWith("LEFT HIP") || label.startsWith("RIGHT HIP")) && active !== "multi") {
      return "";
    }
    if (label === "HANGER OPTIONS" && active === "multi") {
      return "";
    }
    return "Yes";
  }

  const { tre } = ctx;
  const inCarrying = section.includes("CARRYING");
  const inCarried = section.includes("CARRIED") && !section.includes("HIP");
  const inHip = section.includes("HIP");
  const seat = inHip ? hipSeat(ctx, section) : null;
  const hipCtx = hipContext(ctx, seat, treCatalog);

  if (inHip && !seat) {
    return "";
  }

  if (inCarrying && ctx.role === "carried") {
    return "";
  }

  if (inCarried && ctx.role === "carrying" && ctx.connection.id === "multi") {
    return "";
  }

  switch (label) {
    case "Connection Type":
      return ctx.connection.label;
    case "Hanger Type":
    case "Fastener Type":
      return "All Types";
    case "Configuration":
      return describeConfiguration(ctx.seats);
    case "ANSI/TPI 1 Evaluation":
      return "No";
    case "Download Duration":
      return "Floor (CD=1.0)";
    case "Uplift Duration":
      return "Wind / Seismic (CD=1.6)";
    case "Job ID":
    case "Member ID":
      if (inHip && seat) return seat.mark;
      return tre.mark;
    case "Quantity":
      return tre.quantity;
    case "Member Type":
    case "Member Type (Controlled by Jack inputs)":
      return materialLabel(inHip ? (hipCtx?.material ?? ctx.material) : ctx.material);
    case "Type":
      return "Truss";
    case "Lumber Species":
    case "Lumber Species (Controlled by Jack inputs)":
      return inHip ? (hipCtx?.species ?? ctx.species) : ctx.species;
    case "Width":
      if (inCarrying || (ctx.role === "carrying" && !inCarried && !inHip)) {
        return ctx.carryingWidth;
      }
      return inHip ? (hipCtx?.width ?? ctx.width) : ctx.width;
    case "Bottom Chord Width":
      return inHip ? (hipCtx?.width ?? ctx.width) : ctx.width;
    case "Depth":
      if (inCarrying || ctx.role === "carrying") {
        return ctx.carryingDepth;
      }
      return inHip ? (hipCtx?.depth ?? ctx.depth) : ctx.depth;
    case "Bottom Chord Height":
    case "Heel Height":
      return inHip ? (hipCtx?.heelHeight ?? ctx.heelHeight) : ctx.heelHeight;
    case "Number of Plies":
      if (inCarrying || ctx.role === "carrying") {
        return ctx.carryingPly;
      }
      return inHip ? (hipCtx?.tre?.ply ?? ctx.tre.ply) : tre.ply;
    case "Vertical Width (King Post)":
      return ctx.width;
    case "Total Height":
      return ctx.trussHeight;
    case "Lumber Finish":
      return "Rough Sawn";
    case "Download (ASD)":
      if (inHip && seat) return seat.reactionDown || "";
      return ctx.download ?? "";
    case "Upload (ASD)":
    case "Uplift (ASD)":
      if (inHip && seat) return seat.uplift ? Math.abs(seat.uplift) : "";
      return ctx.uplift ?? "";
    case "Slope (Degrees)":
      return inHip ? (hipCtx?.slopeDeg ?? ctx.slopeDeg) : ctx.slopeDeg;
    case "Skew (Degrees)":
    case "Skew":
      return 0;
    case "Slope":
      return ctx.slopeDeg;
    default:
      return "";
  }
}

function describeConfiguration(seats) {
  const parts = [];
  if (seats.left) parts.push(`Left=${seats.left.mark}`);
  if (seats.center) parts.push(`Center=${seats.center.mark}`);
  if (seats.right) parts.push(`Right=${seats.right.mark}`);
  return parts.join("; ");
}

function buildCsvFromTemplate(templateRows, ctx, treCatalog) {
  let currentSection = "";
  const out = [];

  for (const row of templateRows) {
    if (row.label && SECTION_NAMES.has(row.label)) {
      currentSection = row.label;
    } else if (row.label.startsWith("LEFT HIP") || row.label.startsWith("RIGHT HIP")) {
      currentSection = row.label;
    }

    const cells = [row.label];

    for (const column of ["joist", "truss", "multi"]) {
      const raw = row[column];
      if (!isPlaceholder(raw)) {
        cells.push(raw);
        continue;
      }

      if (!row.label && isPlaceholder(raw)) {
        cells.push("");
        continue;
      }

      if (SECTION_NAMES.has(row.label) || row.label.startsWith("LEFT HIP") || row.label.startsWith("RIGHT HIP")) {
        cells.push(computeCellValue(ctx, currentSection, row.label, column, treCatalog));
        continue;
      }

      if (!row.label) {
        cells.push("");
        continue;
      }

      cells.push(computeCellValue(ctx, currentSection, row.label, column, treCatalog));
    }

    out.push(cells.map(csvEscape).join(","));
  }

  return out.join("\n");
}

function buildApiBody(ctx, treCatalog = {}) {
  const { tre } = ctx;
  const carriedFromCtx = (seat, baseCtx) => {
    const carried = seat ? treCatalog[seat.mark] : null;
    const source = carried ?? baseCtx;
    return {
      width: source.width,
      depth: source.heelHeight ?? source.depth,
      material: source.material,
      ply: source.tre?.ply ?? source.tre.ply,
      loads: {
        load: seat ? seat.reactionDown : source.download ?? 0,
        uplift: seat ? Math.abs(seat.uplift ?? 0) : source.uplift ?? 0,
      },
      angle: {
        skewAngle: 0,
        skewType: 0,
        slopeAngle: source.slopeDeg,
        slopeType: source.slopeDeg > 0 ? 1 : 0,
      },
      memberId: seat?.mark ?? tre.mark,
    };
  };

  const body = {
    flushOption: ctx.connection.flushOption,
    ansitpi: 0,
    buildingCode: 21,
    concealed: 0,
    fastenerType: 0,
    style: 0,
    ledger: 0,
    sort: 12,
    designInformations: { downloadDurationType: 100, upliftLoadDurationType: 160 },
    filters: { depth: 0, width: 0, series: "", model: "", webStiffeners: 0 },
    hangerOptions: null,
  };

  if (ctx.role === "carrying") {
    body.carryingMember = {
      width: ctx.carryingWidth,
      depth: ctx.carryingDepth,
      material: ctx.material,
      ply: ctx.carryingPly,
      kingHeight: ctx.trussHeight ?? 0,
      kingWidth: ctx.width,
      topChordPly: tre.ply,
    };
    body.carriedMembers = [ctx.seats.left, ctx.seats.center, ctx.seats.right].map((seat) =>
      seat ? carriedFromCtx(seat, ctx) : null,
    );
  } else {
    body.carryingMember = null;
    body.carriedMembers = [carriedFromCtx(null, ctx)];
  }

  return body;
}

export function buildParameterMaps(projectRoot, dataOutDir, options = {}) {
  const templatePath = options.templatePath ?? path.join(projectRoot, "Parameters Map.csv");
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Parameters Map template not found: ${templatePath}`);
  }

  const templateRows = parseCsv(fs.readFileSync(templatePath, "utf8")).map((parts) => ({
    label: (parts[0] ?? "").trim(),
    joist: (parts[1] ?? "").trim(),
    truss: (parts[2] ?? "").trim(),
    multi: (parts[3] ?? "").trim(),
  }));

  const mapsDir = path.join(dataOutDir, "parameter-maps");
  fs.mkdirSync(mapsDir, { recursive: true });

  const treFiles = fs
    .readdirSync(projectRoot)
    .filter((name) => /^[tj]\d+[a-z]*\.tre$/i.test(name))
    .sort();

  const treCatalog = {};
  for (const file of treFiles) {
    const ctx = buildTreContext(path.join(projectRoot, file));
    treCatalog[ctx.tre.mark] = ctx;
  }

  const index = {
    generatedAt: new Date().toISOString(),
    schemaReference: path.basename(templatePath),
    source: "Parameters Map.csv template + MiTek TRE calculations",
    count: 0,
    marks: [],
    maps: {},
  };

  for (const file of treFiles) {
    const ctx = treCatalog[path.basename(file, ".tre").toUpperCase()];
    const mark = ctx.tre.mark;
    const csv = buildCsvFromTemplate(templateRows, ctx, treCatalog);

    const json = {
      mark,
      treFile: file,
      trussType: ctx.tre.trussType,
      girder: ctx.tre.girder,
      role: ctx.role,
      connectionType: ctx.connection.id,
      connectionColumn: ctx.connection.column,
      connectionLabel: ctx.connection.label,
      spanDisplay: ctx.tre.spanDisplay,
      pitch: ctx.tre.pitch,
      apiBody: buildApiBody(ctx, treCatalog),
      filledCells: [],
    };

    let currentSection = "";
    for (const row of templateRows) {
      if (row.label && (SECTION_NAMES.has(row.label) || row.label.startsWith("LEFT HIP") || row.label.startsWith("RIGHT HIP"))) {
        currentSection = row.label;
      }
      if (!row.label) continue;
      for (const column of ["joist", "truss", "multi"]) {
        if (!isPlaceholder(row[column])) continue;
        const value = computeCellValue(ctx, currentSection, row.label, column, treCatalog);
        if (value !== "") {
          json.filledCells.push({ section: currentSection, parameter: row.label, column, value });
        }
      }
    }

    fs.writeFileSync(path.join(mapsDir, `${mark}.csv`), csv);
    fs.writeFileSync(path.join(mapsDir, `${mark}.json`), JSON.stringify(json, null, 2));

    index.marks.push(mark);
    index.maps[mark] = {
      file: `${mark}.csv`,
      json: `${mark}.json`,
      connectionType: ctx.connection.id,
      connectionColumn: ctx.connection.column,
      role: ctx.role,
      trussType: ctx.tre.trussType,
      download: ctx.download,
      uplift: ctx.uplift,
    };
  }

  index.count = index.marks.length;
  fs.writeFileSync(path.join(mapsDir, "index.json"), JSON.stringify(index, null, 2));

  const projectMapsDir = path.join(projectRoot, "parameter-maps");
  if (projectMapsDir !== mapsDir) {
    fs.mkdirSync(projectMapsDir, { recursive: true });
    for (const mark of index.marks) {
      fs.copyFileSync(path.join(mapsDir, `${mark}.csv`), path.join(projectMapsDir, `${mark}.csv`));
    }
    fs.copyFileSync(path.join(mapsDir, "index.json"), path.join(projectMapsDir, "index.json"));
  }

  return index;
}
