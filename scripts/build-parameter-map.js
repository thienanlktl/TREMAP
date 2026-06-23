import fs from "fs";
import path from "path";
import { parseCsv } from "../shared/parse-csv.js";
import {
  parseTreAnalyzer,
} from "./parse-tre-analyzer.js";
import { resolveParameterMapTemplate } from "./resolve-project-root.js";
import { parseSimpsonIfcBearings } from "./parse-simpson-ifc-bearings.js";
import { buildConnectionMaps } from "./build-connection-maps.js";
import {
  buildCarriedByIndex,
  buildTrussConnectionGraph,
  connectionId,
  primaryParentLink,
  resolveConnectionType,
} from "./truss-connections.js";
import {
  buildParameterFieldMap,
  connectionUiLabel,
  defaultApiBody,
  describeMultiConfiguration,
  jobSettingDefaults,
  loadHsReference,
  materialLabelFromRef,
  resolveFieldMeta,
} from "./hs-reference.js";

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

/** Simpson HS — which Joist / Truss / Multi column each parameter uses (from Parameters Map.csv schema) */
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

function joistMaterialEnum(species) {
  return { SP: 3, DF: 1, HF: 2, SPF: 4 }[species] ?? 3;
}

function materialLabel(column, species, hsRef) {
  if (hsRef) {
    return materialLabelFromRef(hsRef, column, species);
  }
  if (column === "joist") {
    return (
      { SP: "Solid Sawn — SP", DF: "Solid Sawn — DF", HF: "Solid Sawn — HF", SPF: "Solid Sawn — SPF" }[
        species
      ] ?? "Solid Sawn — SP"
    );
  }
  return (
    { SP: "Truss — SP", DF: "Truss — DF", HF: "Truss — HF", SPF: "Truss — SPF" }[species] ?? "Truss — SP"
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

function groupCarriedBySeat(carriedLoads, hangerSeats = []) {
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

  for (const seat of hangerSeats) {
    const existing = byMark.get(seat.mark);
    if (!existing) {
      byMark.set(seat.mark, {
        mark: seat.mark,
        xFeet: seat.xFeet,
        xInches: seat.xInches,
        reactionDown: 0,
        uplift: 0,
        skewAngle: seat.skewAngle,
        skewType: seat.skewType,
        hangerDepth: seat.depth,
        hangerWidth: seat.width,
        hangerPly: seat.ply,
      });
      continue;
    }
    existing.skewAngle = seat.skewAngle ?? existing.skewAngle;
    existing.skewType = seat.skewType ?? existing.skewType;
    existing.hangerDepth = seat.depth ?? existing.hangerDepth;
    existing.hangerWidth = seat.width ?? existing.hangerWidth;
    existing.hangerPly = seat.ply ?? existing.hangerPly;
    existing.xFeet = Math.min(existing.xFeet ?? seat.xFeet, seat.xFeet);
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

function enrichContext(ctx, carriedByIndex, treCatalog) {
  const parentLinks = carriedByIndex[ctx.tre.mark] ?? [];
  const primary = primaryParentLink(parentLinks);

  if (!primary) {
    return { ...ctx, parentLinks };
  }

  const girderCtx = treCatalog[primary.carryingMark];
  return {
    ...ctx,
    parentLinks,
    carryingGirder: girderCtx,
    carryingGirderMark: primary.carryingMark,
    seatDownload: primary.download,
    seatUplift: primary.uplift,
    seatPosition: primary.position,
    skewAngle: primary.skewAngle ?? ctx.skewAngle ?? 0,
    skewType: primary.skewType ?? ctx.skewType ?? 0,
  };
}

function carryingContext(ctx) {
  if (ctx.role === "carrying") {
    return ctx;
  }
  return ctx.carryingGirder ?? null;
}

function buildTreContext(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const tre = parseTreAnalyzer(filePath);
  const bcSize = parseLumberSize(tre.bottomChordLumber);
  const tcSize = parseLumberSize(tre.topChordLumber);
  const species = parseSpecies(tre.bottomChordLumber ?? tre.topChordLumber);
  const heelHeight = Number.parseFloat(readTreField(content, "Left Heel Height") ?? "");
  const trussHeight = Number.parseFloat(readTreField(content, "Truss Height") ?? "");
  const slopeDeg = pitchToSlopeDegrees(tre.pitch);
  const download =
    tre.engineering.reactionMax ?? Number.parseInt(readTreField(content, "Reaction1") ?? "", 10);
  const upliftRaw = tre.engineering.maxUplift1 ?? readTreField(content, "Max Uplift1");
  const uplift = upliftRaw != null ? Math.abs(Number.parseInt(String(upliftRaw), 10)) : null;
  const seats = groupCarriedBySeat(tre.carriedLoads, tre.hangerSeats);
  const role =
    tre.girder && (tre.carriedLoads.length > 0 || tre.hangerSeats.length > 0)
      ? "carrying"
      : "carried";

  const bcMember = tre.members.find((member) => member.role === "bc");
  const bcFromMember = parseLumberSize(bcMember?.size);
  const width = bcSize.width ?? bcFromMember.width ?? 1.5;
  const depth = bcSize.depth ?? bcFromMember.depth ?? (Number.isNaN(heelHeight) ? null : heelHeight);

  return {
    tre,
    content,
    species,
    trussMaterial: trussMaterialEnum(species),
    joistMaterial: joistMaterialEnum(species),
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
    role,
    connectionType: null,
    hangerRole: "standalone",
    connectionReason: "",
    skewAngle: 0,
    skewType: 0,
    carryingGirder: null,
    carryingGirderMark: null,
    girderSeat: null,
    girderLoad: null,
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

function columnAllowed(label, column, section) {
  if (section.includes("HIP") && column !== "multi") {
    return false;
  }
  if (section === "HANGER OPTIONS" && column === "multi") {
    return false;
  }
  const applies = COLUMN_APPLIES[label];
  if (!applies) {
    return SECTION_NAMES.has(label) || label.startsWith("LEFT HIP") || label.startsWith("RIGHT HIP");
  }
  return Boolean(applies[column]);
}

function sectionHeaderVisible(ctx, section, column, seat) {
  const inCarrying = section.includes("CARRYING");
  const inCarried = section.includes("CARRIED") && !section.includes("HIP");
  const inHip = section.includes("HIP");

  if (inHip) {
    return Boolean(seat);
  }
  if (inCarrying) {
    return ctx.role === "carrying" || Boolean(carryingContext(ctx));
  }
  if (inCarried) {
    return ctx.role !== "carrying";
  }
  return true;
}

function computeCellValue(ctx, section, label, column, treCatalog, hsRef) {
  if (!ctx.connectionType || column !== ctx.connectionType) {
    return "";
  }

  if (!columnAllowed(label, column, section)) {
    return "";
  }

  const seat = section.includes("HIP") ? hipSeat(ctx, section) : null;

  if (SECTION_NAMES.has(label) || label.startsWith("LEFT HIP") || label.startsWith("RIGHT HIP")) {
    return sectionHeaderVisible(ctx, section, column, seat) ? "Yes" : "";
  }

  const { tre } = ctx;
  const inCarrying = section.includes("CARRYING");
  const inCarried = section.includes("CARRIED") && !section.includes("HIP");
  const inHip = section.includes("HIP");
  const hipSeatEntry = inHip ? seat : null;
  const hipCtx = hipContext(ctx, hipSeatEntry, treCatalog);
  const carryCtx = carryingContext(ctx);
  const jobDefaults = jobSettingDefaults(hsRef, column);

  if (inHip && !hipSeatEntry) {
    return "";
  }

  if (inCarrying && ctx.role === "carried" && !carryCtx) {
    return "";
  }

  if (inCarried && ctx.role === "carrying" && column === "multi") {
    return "";
  }

  switch (label) {
    case "Connection Type":
      return connectionUiLabel(hsRef, column) ?? "";
    case "Hanger Type":
      return jobDefaults.hangerType;
    case "Fastener Type":
      return jobDefaults.fastenerType;
    case "Configuration":
      return ctx.role === "carrying" ? describeMultiConfiguration(ctx.seats) : "";
    case "ANSI/TPI 1 Evaluation":
      return jobDefaults.ansiTpi;
    case "Download Duration":
      return jobDefaults.downloadDuration;
    case "Uplift Duration":
      return jobDefaults.upliftDuration;
    case "Job ID":
    case "Member ID":
      if (inHip && hipSeatEntry) return hipSeatEntry.mark;
      if (inCarrying && carryCtx) return carryCtx.tre.mark;
      return tre.mark;
    case "Quantity":
      return tre.quantity;
    case "Member Type":
    case "Member Type (Controlled by Jack inputs)":
      if (inCarrying && carryCtx) {
        return materialLabel(column, carryCtx.species, hsRef);
      }
      return materialLabel(
        column,
        inHip ? (hipCtx?.species ?? ctx.species) : ctx.species,
        hsRef,
      );
    case "Type":
      return "Truss";
    case "Lumber Species":
    case "Lumber Species (Controlled by Jack inputs)":
      if (inCarrying && carryCtx) return carryCtx.species;
      return inHip ? (hipCtx?.species ?? ctx.species) : ctx.species;
    case "Width":
      if (inCarrying && carryCtx) return carryCtx.carryingWidth;
      if (ctx.role === "carrying" && !inCarried && !inHip) {
        return ctx.carryingWidth;
      }
      return inHip ? (hipCtx?.width ?? ctx.width) : ctx.width;
    case "Bottom Chord Width":
      return inHip ? (hipCtx?.width ?? ctx.width) : ctx.width;
    case "Depth":
      if (inCarrying && carryCtx) return carryCtx.carryingDepth;
      if (ctx.role === "carrying" && !inCarried && !inHip) {
        return ctx.carryingDepth;
      }
      if (column === "joist") {
        return inHip ? (hipCtx?.depth ?? ctx.depth) : ctx.depth;
      }
      return inHip ? (hipCtx?.heelHeight ?? ctx.heelHeight) : ctx.heelHeight;
    case "Bottom Chord Height":
    case "Heel Height":
      if (inCarrying && carryCtx) return carryCtx.heelHeight;
      return inHip ? (hipCtx?.heelHeight ?? ctx.heelHeight) : ctx.heelHeight;
    case "Number of Plies":
      if (inCarrying && carryCtx) return carryCtx.carryingPly;
      if (ctx.role === "carrying" && !inCarried && !inHip) {
        return ctx.carryingPly;
      }
      return inHip ? (hipCtx?.tre?.ply ?? ctx.tre.ply) : tre.ply;
    case "Vertical Width (King Post)":
      if (inCarrying && carryCtx) return carryCtx.width;
      return ctx.width;
    case "Total Height":
      if (inCarrying && carryCtx) return carryCtx.trussHeight;
      return ctx.trussHeight;
    case "Lumber Finish":
      return "Rough Sawn";
    case "Download (ASD)":
      if (inHip && hipSeatEntry) return hipSeatEntry.reactionDown || "";
      if (inCarried && ctx.seatDownload) return ctx.seatDownload;
      return ctx.download ?? "";
    case "Upload (ASD)":
    case "Uplift (ASD)":
      if (inHip && hipSeatEntry) return hipSeatEntry.uplift ? Math.abs(hipSeatEntry.uplift) : "";
      if (inCarried && ctx.seatUplift) return ctx.seatUplift;
      return ctx.uplift ?? "";
    case "Slope (Degrees)":
      return inHip ? (hipCtx?.slopeDeg ?? ctx.slopeDeg) : ctx.slopeDeg;
    case "Skew (Degrees)":
      if (inHip && hipSeatEntry) return hipSeatEntry.skewAngle ?? 0;
      return ctx.skewAngle ?? 0;
    case "Skew":
      if (inHip && hipSeatEntry) return hipSeatEntry.skewAngle ?? 0;
      return ctx.skewAngle ?? 0;
    case "Slope":
      return ctx.slopeDeg;
    default:
      return "";
  }
}

function buildCsvFromTemplate(templateRows, ctx, treCatalog, hsRef) {
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

      if (!row.label) {
        cells.push("");
        continue;
      }

      cells.push(computeCellValue(ctx, currentSection, row.label, column, treCatalog, hsRef));
    }

    out.push(cells.map(csvEscape).join(","));
  }

  return out.join("\n");
}

function buildApiBodyForColumn(ctx, column, treCatalog, hsRef) {
  const { tre } = ctx;
  const material = column === "joist" ? ctx.joistMaterial : ctx.trussMaterial;
  const carryCtx = carryingContext(ctx);
  const base = defaultApiBody(hsRef, column) ?? {};
  const connectionLabel = connectionUiLabel(hsRef, column) ?? column;

  const carriedFromCtx = (seat, sourceCtx) => ({
    width: sourceCtx.width,
    depth: sourceCtx.heelHeight ?? sourceCtx.depth,
    material,
    ply: sourceCtx.tre?.ply ?? sourceCtx.tre.ply,
    loads: {
      load: seat
        ? seat.reactionDown
        : sourceCtx.seatDownload ?? sourceCtx.download ?? 0,
      uplift: seat
        ? Math.abs(seat.uplift ?? 0)
        : sourceCtx.seatUplift ?? sourceCtx.uplift ?? 0,
    },
    angle: {
      skewAngle: seat?.skewAngle ?? sourceCtx.skewAngle ?? 0,
      skewType: seat?.skewType ?? sourceCtx.skewType ?? 0,
      slopeAngle: sourceCtx.slopeDeg,
      slopeType: sourceCtx.slopeDeg > 0 ? 1 : 0,
    },
    memberId: seat?.mark ?? tre.mark,
  });

  const body = {
    ...base,
    simpsonHsUrl: "https://app.strongtie.com/hs",
    connectionLabel,
    hangerOptions: column === "joist" ? base.hangerOptions ?? { topFlangeOptions: {} } : null,
  };

  if (column === "multi" && ctx.role === "carrying") {
    body.carryingMember = {
      width: ctx.carryingWidth,
      depth: ctx.carryingDepth,
      material: ctx.trussMaterial,
      ply: ctx.carryingPly,
      kingHeight: ctx.trussHeight ?? 0,
      kingWidth: ctx.width,
      topChordPly: tre.ply,
    };
    body.carriedMembers = [ctx.seats.left, ctx.seats.center, ctx.seats.right].map((seat) =>
      seat ? carriedFromCtx(seat, treCatalog[seat.mark] ?? ctx) : null,
    );
  } else if (column === "multi") {
    body.carryingMember = null;
    body.carriedMembers = [null, carriedFromCtx(null, ctx), null];
  } else {
    body.carryingMember =
      ctx.role === "carrying"
        ? {
            width: ctx.carryingWidth,
            depth: ctx.carryingDepth,
            material,
            ply: ctx.carryingPly,
            kingHeight: column === "truss" ? ctx.trussHeight ?? 0 : 0,
            kingWidth: column === "truss" ? ctx.width : 0,
            topChordPly: column === "truss" ? tre.ply : 0,
            topChord: column === "joist" ? 1 : 0,
          }
        : carryCtx
          ? {
              width: carryCtx.carryingWidth,
              depth: carryCtx.carryingDepth,
              material: column === "joist" ? carryCtx.joistMaterial : carryCtx.trussMaterial,
              ply: carryCtx.carryingPly,
              kingHeight: column === "truss" ? carryCtx.trussHeight ?? 0 : 0,
              kingWidth: column === "truss" ? carryCtx.width : 0,
              topChordPly: column === "truss" ? carryCtx.tre.ply : 0,
              topChord: column === "joist" ? 1 : 0,
            }
          : null;
    body.carriedMembers = [carriedFromCtx(null, ctx)];
  }

  return body;
}

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

  const templateRows = parseCsv(fs.readFileSync(templatePath, "utf8")).map((parts) => ({
    label: (parts[0] ?? "").trim(),
    joist: (parts[1] ?? "").trim(),
    truss: (parts[2] ?? "").trim(),
    multi: (parts[3] ?? "").trim(),
  }));

  const mapsDir = path.join(dataOutDir, "parameter-maps");
  fs.mkdirSync(mapsDir, { recursive: true });

  const hsReference = loadHsReference(dataOutDir);
  const parameterFieldMap = buildParameterFieldMap(hsReference);

  const treFiles = fs
    .readdirSync(projectRoot)
    .filter((name) => /^[tj]\d+[a-z]*\.tre$/i.test(name))
    .sort();

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

  const treCatalog = {};
  for (const file of treFiles) {
    const ctx = buildTreContext(path.join(projectRoot, file));
    treCatalog[ctx.tre.mark] = ctx;
  }

  const connectionGraph = buildTrussConnectionGraph(treCatalog);
  const carriedByIndex = buildCarriedByIndex(connectionGraph);

  for (const mark of Object.keys(treCatalog)) {
    const ctx = treCatalog[mark];
    const resolved = resolveConnectionType(
      ctx,
      simpsonBearings.byMark[mark],
      connectionGraph,
    );
    treCatalog[mark] = enrichContext(
      {
        ...ctx,
        connectionType: resolved.connectionType,
        hangerRole: resolved.hangerRole,
        connectionReason: resolved.reason,
      },
      carriedByIndex,
      treCatalog,
    );
  }

  const connectionOptions = {
    joist: connectionUiLabel(hsReference, "joist"),
    truss: connectionUiLabel(hsReference, "truss"),
    multi: connectionUiLabel(hsReference, "multi"),
  };

  const index = {
    generatedAt: new Date().toISOString(),
    schemaReference: path.basename(templatePath),
    simpsonHsUrl: "https://app.strongtie.com/hs",
    hsReferenceTitle: hsReference?.meta?.title ?? null,
    purpose:
      "Each TRE maps to one Simpson Hanger Selector connection type from TRE truss links + Simpson IFC bearings.",
    trussConnectionCount: connectionGraph.length,
    count: 0,
    marks: [],
    maps: {},
  };

  for (const file of treFiles) {
    const ctx = treCatalog[path.basename(file, ".tre").toUpperCase()];
    const mark = ctx.tre.mark;
    const connectionType = ctx.connectionType;
    const csv =
      connectionType == null
        ? buildCsvFromTemplate(templateRows, ctx, treCatalog, hsReference)
        : buildCsvFromTemplate(templateRows, ctx, treCatalog, hsReference);

    const json = {
      mark,
      treFile: file,
      trussType: ctx.tre.trussType,
      girder: ctx.tre.girder,
      role: ctx.role,
      hangerRole: ctx.hangerRole,
      connectionReason: ctx.connectionReason,
      carryingGirderMark: ctx.carryingGirderMark ?? null,
      parentLinks: ctx.parentLinks ?? [],
      simpsonIfcBearings: simpsonBearings.byMark[mark] ?? null,
      connectionType,
      suggestedConnection: connectionType,
      spanDisplay: ctx.tre.spanDisplay,
      pitch: ctx.tre.pitch,
      simpsonHsUrl: "https://app.strongtie.com/hs",
      usageNote:
        connectionType == null
          ? ctx.connectionReason
          : `Open Simpson Hanger Selector, choose "${connectionUiLabel(hsReference, connectionType) ?? connectionType}", then copy values from the filled column.`,
      connectionOptions,
      apiBody:
        connectionType == null
          ? null
          : buildApiBodyForColumn(ctx, connectionType, treCatalog, hsReference),
      apiBodies:
        connectionType == null
          ? {}
          : {
              [connectionType]: buildApiBodyForColumn(
                ctx,
                connectionType,
                treCatalog,
                hsReference,
              ),
            },
      hsReference: hsReference?.meta ?? null,
      parameterFieldMap,
      filledCells: [],
    };

    let currentSection = "";
    for (const row of templateRows) {
      if (row.label && (SECTION_NAMES.has(row.label) || row.label.startsWith("LEFT HIP") || row.label.startsWith("RIGHT HIP"))) {
        currentSection = row.label;
      }
      if (!row.label) continue;
      for (const column of ["joist", "truss", "multi"]) {
        if (column !== connectionType) continue;
        if (!isPlaceholder(row[column])) continue;
        const value = computeCellValue(ctx, currentSection, row.label, column, treCatalog, hsReference);
        if (value !== "") {
          const fieldMeta = resolveFieldMeta(parameterFieldMap, row.label, column);
          json.filledCells.push({
            section: currentSection,
            parameter: row.label,
            column,
            value,
            apiField: fieldMeta?.apiField ?? null,
            hsSection: fieldMeta?.sectionLabel ?? null,
          });
        }
      }
    }

    fs.writeFileSync(path.join(mapsDir, `${mark}.csv`), csv);
    fs.writeFileSync(path.join(mapsDir, `${mark}.json`), JSON.stringify(json, null, 2));

    index.marks.push(mark);
    index.maps[mark] = {
      file: `${mark}.csv`,
      json: `${mark}.json`,
      suggestedConnection: connectionType,
      connectionType,
      hangerRole: ctx.hangerRole,
      role: ctx.role,
      carryingGirderMark: ctx.carryingGirderMark ?? null,
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

  const connectionIndex = buildConnectionMaps({
    connectionGraph,
    treCatalog,
    simpsonBearings,
    hsReference,
    dataOutDir,
  });

  const enrichedLinks = connectionGraph.map((link) => ({
    ...link,
    connectionId: connectionId(link.carryingMark, link.carriedMark),
    connectionMapFile: `connection-maps/${connectionId(link.carryingMark, link.carriedMark)}.json`,
    simpsonHsConnectionType: "truss",
    simpsonHsConnectionLabel: connectionUiLabel(hsReference, "truss"),
  }));

  fs.writeFileSync(
    path.join(mapsDir, "truss-connections.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        simpsonIfcSource: simpsonBearings.source ?? null,
        purpose:
          "Truss-to-truss relationships from TRE. Each link has one connection map for Simpson Hanger Selector.",
        connectionMapIndex: "connection-maps/index.json",
        count: enrichedLinks.length,
        links: enrichedLinks,
        byCarriedMark: carriedByIndex,
      },
      null,
      2,
    ),
  );

  return { ...index, connectionCount: connectionIndex.count };
}
