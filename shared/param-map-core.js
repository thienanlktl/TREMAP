/**
 * Pure parameter-map + connection-map compute — NO Node `fs`/`path`.
 *
 * Produces the in-memory dataset (parameter maps, connection maps, indexes,
 * truss-connections graph) from TRE file texts + the CSV template + the HS
 * reference + optional Simpson IFC bearings. The Node build (scripts/build-
 * parameter-map.js) wraps this with file I/O; the browser runtime
 * (shared/dataset.js) calls it directly on user-uploaded TRE text.
 */
import { parseCsv } from "./parse-csv.js";
import { parseTreAnalyzerText, bearingReactionForSeat, readTreField } from "./tre-core.js";
import {
  buildCarriedByIndex,
  buildTrussConnectionGraph,
  primaryParentLink,
  resolveConnectionType,
} from "./truss-connections.js";
import {
  buildParameterFieldMap,
  connectionUiLabel,
  defaultApiBody,
  describeMultiConfiguration,
  jobSettingDefaults,
  materialLabelFromRef,
  resolveFieldMeta,
} from "./hs-reference.js";
import {
  MATERIAL_TRUSS,
  ANSITPI_INTERIOR,
  BUILDING_CODE_IRC2018,
  STYLE_ALL,
  FASTENER_ALL,
  findBottomChord,
  findKingPost,
  deriveSkew,
  dolFactorToDownloadDuration,
  dolFactorToUpliftDuration,
} from "./sst-mapper.js";

const HS_URL = "https://app.strongtie.com/hs";
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

const PLACEHOLDER = "update this value with your caculation data in tre file";

/** Simpson HS — which Joist / Truss / Multi column each parameter uses. */
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

function trussMaterialEnum() {
  return MATERIAL_TRUSS;
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

/** Format a position along the girder (inches) as feet-inches for display. */
function feetInches(inches) {
  if (inches == null || Number.isNaN(inches)) return null;
  const ft = Math.floor(inches / 12);
  const inch = inches - ft * 12;
  return `${ft}'-${inch.toFixed(1)}"`;
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
        angle: seat.angle,
        skewType: seat.skewType,
        hangerDepth: seat.depth,
        hangerWidth: seat.width,
        hangerPly: seat.ply,
        bearingLocation: seat.bearingLocation,
      });
      continue;
    }
    existing.angle = seat.angle ?? existing.angle;
    existing.skewType = seat.skewType ?? existing.skewType;
    existing.hangerDepth = seat.depth ?? existing.hangerDepth;
    existing.hangerWidth = seat.width ?? existing.hangerWidth;
    existing.hangerPly = seat.ply ?? existing.hangerPly;
    existing.bearingLocation = seat.bearingLocation ?? existing.bearingLocation;
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
  const { skewAngle, skewType } = deriveSkew(primary.hangerAngle);
  return {
    ...ctx,
    parentLinks,
    carryingGirder: girderCtx,
    carryingGirderMark: primary.carryingMark,
    seatDownload: primary.download,
    seatUplift: primary.uplift,
    seatPosition: primary.position,
    seatLocalX: primary.localX ?? null,
    seatBearingSide: primary.bearingSide ?? null,
    seatHangerAngle: primary.hangerAngle ?? 90,
    seatDownDolFactor: primary.downDolFactor ?? null,
    seatUpliftDolFactor: primary.upliftDolFactor ?? null,
    skewAngle,
    skewType: skewType ?? primary.skewType ?? 0,
  };
}

function carryingContext(ctx) {
  if (ctx.role === "carrying") {
    return ctx;
  }
  return ctx.carryingGirder ?? null;
}

/**
 * Build the per-truss context (dimensions, role, seats, loads) from raw text.
 * @param {string} fileName Original .tre file name.
 * @param {string} content  Raw .tre text.
 */
export function buildTreContextFromText(fileName, content) {
  const tre = parseTreAnalyzerText(fileName, content);
  const bcSize = parseLumberSize(tre.bottomChordLumber);
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

  // Member dimensions come from the actual MEMBER INFO bottom chord (reference
  // findBottomChord), not the lumber string. Carrying depth = girder bottom chord.
  const bc = findBottomChord(tre.members);
  const bcMember = tre.members.find((member) => member.role === "bc");
  const bcFromMember = parseLumberSize(bcMember?.size);
  const width = bc?.width ?? bcSize.width ?? bcFromMember.width ?? 1.5;
  const depth =
    bc?.depth ?? bcSize.depth ?? bcFromMember.depth ?? (Number.isNaN(heelHeight) ? null : heelHeight);

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
    carryingDepth: depth,
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
      return 0;
    case "Skew (Degrees)":
    case "Skew":
      return 0;
    case "Slope":
      return 0;
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
  const material = column === "joist" ? ctx.joistMaterial : ctx.trussMaterial;
  const carryCtx = carryingContext(ctx);
  const base = defaultApiBody(hsRef, column) ?? {};
  const connectionLabel = connectionUiLabel(hsRef, column) ?? column;

  const carryingTrussMember = (girderCtx, connectionX, mat, ply) => {
    const bc = findBottomChord(girderCtx?.tre?.members);
    const width = bc?.width ?? girderCtx?.carryingWidth ?? 1.5;
    const depth = bc?.depth ?? girderCtx?.carryingDepth ?? 5.5;
    const kp = findKingPost(girderCtx?.tre?.members ?? [], connectionX ?? 0);
    const girderHeel = girderCtx?.tre?.leftHeel ?? 0;
    return {
      width,
      depth,
      material: mat,
      ply: ply ?? 1,
      topChord: 0,
      topChordPly: 0,
      kingWidth: kp.hasKingPost ? kp.kingWidth : 0,
      kingHeight: kp.hasKingPost ? kp.kingHeight : Math.max(girderHeel, depth),
    };
  };

  const joistHeaderMember = (girderCtx, mat, ply) => ({
    width: girderCtx?.carryingWidth ?? 1.5,
    depth: girderCtx?.carryingDepth ?? 5.5,
    material: mat,
    ply: ply ?? 1,
    kingHeight: 0,
    kingWidth: 0,
    topChordPly: 0,
    topChord: 1,
  });

  const carriedMember = (seat, sourceCtx) => {
    const bc = findBottomChord(sourceCtx.tre?.members);
    const width = bc?.width ?? sourceCtx.width ?? 1.5;
    const heel = seat
      ? seat.heel ?? sourceCtx.heelHeight
      : sourceCtx.seatBearingSide === "right"
        ? sourceCtx.tre.rightHeel ?? sourceCtx.tre.leftHeel ?? sourceCtx.heelHeight
        : sourceCtx.tre.leftHeel ?? sourceCtx.tre.rightHeel ?? sourceCtx.heelHeight;
    const depth = heel > 0 ? heel : 3.5;
    const { skewAngle, skewType } = deriveSkew(seat ? seat.angle : sourceCtx.seatHangerAngle);
    return {
      width,
      depth,
      material,
      ply: sourceCtx.tre?.ply ?? 1,
      loads: {
        load: seat ? seat.reactionDown : sourceCtx.seatDownload ?? sourceCtx.download ?? 0,
        uplift: seat
          ? Math.abs(seat.uplift ?? 0)
          : sourceCtx.seatUplift ?? sourceCtx.uplift ?? 0,
      },
      angle: { skewAngle, skewType, slopeAngle: 0, slopeType: 0 },
      memberId: seat?.mark ?? sourceCtx.tre.mark,
    };
  };

  let downDol = ctx.seatDownDolFactor ?? null;
  let upliftDol = ctx.seatUpliftDolFactor ?? null;
  if (ctx.role === "carrying") {
    const repSeat = ctx.seats.center ?? ctx.seats.left ?? ctx.seats.right;
    downDol = repSeat?.downDolFactor ?? downDol;
    upliftDol = repSeat?.upliftDolFactor ?? upliftDol;
  }

  const body = {
    ...base,
    style: STYLE_ALL,
    buildingCode: BUILDING_CODE_IRC2018,
    concealed: 0,
    fastenerType: FASTENER_ALL,
    sort: 0,
    ledger: 0,
    ansitpi: ANSITPI_INTERIOR,
    designInformations: {
      downloadDurationType: dolFactorToDownloadDuration(downDol),
      upliftLoadDurationType: dolFactorToUpliftDuration(upliftDol),
    },
    filters: { depth: 0, model: "", series: "", webStiffeners: 0, width: 0 },
    simpsonHsUrl: HS_URL,
    connectionLabel,
    hangerOptions: column === "joist" ? base.hangerOptions ?? { topFlangeOptions: {} } : null,
  };

  if (column === "multi" && ctx.role === "carrying") {
    const repX =
      ctx.seats.center?.xInches ?? ctx.seats.left?.xInches ?? ctx.seats.right?.xInches;
    body.carryingMember = carryingTrussMember(ctx, repX, ctx.trussMaterial, ctx.carryingPly);
    body.carriedMembers = [ctx.seats.left, ctx.seats.center, ctx.seats.right].map((seat) =>
      seat ? carriedMember(seat, treCatalog[seat.mark] ?? ctx) : null,
    );
  } else if (column === "multi") {
    body.carryingMember = null;
    body.carriedMembers = [null, carriedMember(null, ctx), null];
  } else if (column === "joist") {
    body.carryingMember =
      ctx.role === "carrying"
        ? joistHeaderMember(ctx, material, ctx.carryingPly)
        : carryCtx
          ? joistHeaderMember(carryCtx, carryCtx.joistMaterial, carryCtx.carryingPly)
          : null;
    body.carriedMembers = [carriedMember(null, ctx)];
  } else {
    if (ctx.role === "carrying") {
      const repX =
        ctx.seats.center?.xInches ?? ctx.seats.left?.xInches ?? ctx.seats.right?.xInches;
      body.carryingMember = carryingTrussMember(ctx, repX, material, ctx.carryingPly);
    } else if (carryCtx) {
      body.carryingMember = carryingTrussMember(
        carryCtx,
        ctx.seatLocalX,
        carryCtx.trussMaterial,
        carryCtx.carryingPly,
      );
    } else {
      body.carryingMember = null;
    }
    body.carriedMembers = [carriedMember(null, ctx)];
  }

  return body;
}

// --- Connection maps (per hanger instance) ---

function carriedHeelAtBearing(carriedTre, bearingSide) {
  const left = carriedTre?.leftHeel;
  const right = carriedTre?.rightHeel;
  if (bearingSide === "left") return left ?? right ?? 3.5;
  return right ?? left ?? 3.5;
}

function treTechnicalSummary(ctx) {
  if (!ctx) return null;
  return {
    mark: ctx.tre.mark,
    trussType: ctx.tre.trussType,
    spanDisplay: ctx.tre.spanDisplay,
    pitch: ctx.tre.pitch,
    ply: ctx.tre.ply,
    girder: ctx.tre.girder,
    width: ctx.width,
    depth: ctx.depth,
    heelHeight: ctx.heelHeight,
    slopeDeg: ctx.slopeDeg,
    trussHeight: ctx.trussHeight,
    species: ctx.tre.species ?? "SP",
  };
}

/** Import the sst-mapper builders lazily-inlined here to avoid a wide import list. */
import {
  sstTrussHangerBody,
  sstCarryingMember,
  sstCarriedMember,
} from "./sst-mapper.js";

export function buildApiBodyForConnection(link, carryingCtx, carriedCtx, hsRef) {
  const body = sstTrussHangerBody({
    carrying: sstCarryingMember({
      members: carryingCtx.tre.members,
      connectionX: link.localX,
      leftHeel: carryingCtx.tre.leftHeel,
      ply: carryingCtx.tre.ply,
    }),
    carried: [
      sstCarriedMember({
        members: carriedCtx.tre.members,
        heel: carriedHeelAtBearing(carriedCtx.tre, link.bearingSide),
        ply: carriedCtx.tre.ply,
        load: link.download,
        uplift: link.uplift,
        hangerAngle: link.hangerAngle,
        memberId: link.carriedMark,
      }),
    ],
    downDolFactor: link.downDolFactor,
    upliftDolFactor: link.upliftDolFactor,
  });

  body.simpsonHsUrl = HS_URL;
  body.connectionLabel = connectionUiLabel(hsRef, "truss") ?? "Truss (Flush Bottom)";
  body.hangerOptions = null;
  return body;
}

function computeConnectionRecords({ connectionGraph, treCatalog, simpsonBearings, hsReference, generatedAt }) {
  const records = {};
  const connections = [];

  for (const link of connectionGraph) {
    const id = link.connectionId;
    const carryingCtx = treCatalog[link.carryingMark];
    const carriedCtx = treCatalog[link.carriedMark];
    if (!carryingCtx || !carriedCtx) continue;

    const apiBody = buildApiBodyForConnection(link, carryingCtx, carriedCtx, hsReference);
    const carryingIfc = simpsonBearings.byMark?.[link.carryingMark] ?? null;
    const carriedIfc = simpsonBearings.byMark?.[link.carriedMark] ?? null;

    records[id] = {
      connectionId: id,
      carryingMark: link.carryingMark,
      carriedMark: link.carriedMark,
      hangerIndex: link.hangerIndex,
      localXInches: link.localX,
      localX: feetInches(link.localX),
      simpsonHsConnectionType: "truss",
      simpsonHsConnectionLabel:
        connectionUiLabel(hsReference, "truss") ?? "Truss (Flush Bottom)",
      position: link.position,
      seatConfiguration: link.configuration,
      loadsAsd: { download: link.download, uplift: link.uplift },
      geometry: {
        ...(() => {
          const { skewAngle, skewType } = deriveSkew(link.hangerAngle);
          return { skewAngle, skewType };
        })(),
        slopeAngle: 0,
        hangerAngle: link.hangerAngle,
        bearingSide: link.bearingSide,
        mitekSkewType: link.skewType,
        roofPitchDeg: carriedCtx.slopeDeg,
      },
      sources: {
        tre: {
          carrying: treTechnicalSummary(carryingCtx),
          carried: treTechnicalSummary(carriedCtx),
        },
        ifc: {
          carrying: carryingIfc,
          carried: carriedIfc,
          validated:
            carriedIfc?.hasHangerToTruss === true ||
            carryingIfc?.hasHangerToTruss === true,
        },
      },
      apiBody,
      selectedHanger: null,
      reactionSource: link.reactionSource,
      selectionNote:
        `One Simpson hanger for ${link.carryingMark} → ${link.carriedMark}` +
        `${feetInches(link.localX) ? ` at ${feetInches(link.localX)} along ${link.carryingMark}` : ""}. ` +
        "Open Hanger Selector → Truss (Flush Bottom), paste apiBody values, " +
        "then choose the recommended model from results.",
      simpsonHsUrl: HS_URL,
    };

    connections.push({
      connectionId: id,
      carryingMark: link.carryingMark,
      carriedMark: link.carriedMark,
      hangerIndex: link.hangerIndex,
      localX: feetInches(link.localX),
      position: link.position,
      download: link.download,
      uplift: link.uplift,
      skewAngle: deriveSkew(link.hangerAngle).skewAngle,
      simpsonHsConnectionType: "truss",
      file: `${id}.json`,
    });
  }

  const index = {
    generatedAt,
    purpose:
      "Each entry is one physical truss-to-truss hanger connection. " +
      "Technical inputs are merged from MiTek TRE (Truss Analyzer), Simpson IFC bearings, " +
      "and Simpson Hanger Selector fields — use apiBody to select one hanger per connection.",
    simpsonHsUrl: HS_URL,
    count: connections.length,
    connections,
  };

  return { index, records };
}

/**
 * Compute the full parameter-map + connection-map dataset in memory.
 *
 * @param {object} opts
 * @param {Array<{name:string,text:string}>} opts.treFiles   TRE files.
 * @param {string} opts.templateCsv       Parameters Map.csv template text.
 * @param {object} opts.hsReference       Parsed hanger-selector-reference.json.
 * @param {object} [opts.simpsonBearings] { byMark, source, found } (optional).
 * @param {string} [opts.templateName]    schemaReference label.
 * @param {string} [opts.generatedAt]     ISO timestamp (caller supplies).
 * @returns {{ parameterIndex, parameterMaps, connectionIndex, connectionRecords, trussConnections }}
 */
export function computeParameterDataset({
  treFiles,
  templateCsv,
  hsReference,
  simpsonBearings = { byMark: {}, found: false },
  templateName = "Parameters Map.csv",
  generatedAt = new Date().toISOString(),
}) {
  const templateRows = parseCsv(templateCsv).map((parts) => ({
    label: (parts[0] ?? "").trim(),
    joist: (parts[1] ?? "").trim(),
    truss: (parts[2] ?? "").trim(),
    multi: (parts[3] ?? "").trim(),
  }));

  const parameterFieldMap = buildParameterFieldMap(hsReference);

  const sortedTre = [...treFiles].sort((a, b) => a.name.localeCompare(b.name));

  const treCatalog = {};
  for (const file of sortedTre) {
    const ctx = buildTreContextFromText(file.name, file.text);
    treCatalog[ctx.tre.mark] = ctx;
  }

  // Enrich each girder seat with the governing reaction, bearing side, heel, DOL.
  for (const ctx of Object.values(treCatalog)) {
    if (ctx.role !== "carrying" || !ctx.seats) continue;
    for (const key of ["left", "center", "right"]) {
      const seat = ctx.seats[key];
      const carried = seat && treCatalog[seat.mark];
      if (!seat || !carried?.content) continue;
      const reaction = bearingReactionForSeat(carried.content, carried.tre, seat.bearingLocation);
      if (reaction) {
        seat.reactionDown = Math.round(reaction.downReaction);
        seat.uplift = Math.round(Math.abs(reaction.upliftReaction));
        seat.bearingSide = reaction.bearingSide;
        seat.downDolFactor = reaction.downDolFactor;
        seat.upliftDolFactor = reaction.upliftDolFactor;
        seat.heel =
          reaction.bearingSide === "left"
            ? carried.tre.leftHeel ?? carried.tre.rightHeel
            : carried.tre.rightHeel ?? carried.tre.leftHeel;
      }
    }
  }

  const connectionGraph = buildTrussConnectionGraph(treCatalog);
  const carriedByIndex = buildCarriedByIndex(connectionGraph);

  for (const mark of Object.keys(treCatalog)) {
    const ctx = treCatalog[mark];
    const resolved = resolveConnectionType(ctx, simpsonBearings.byMark[mark], connectionGraph);
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

  const parameterIndex = {
    generatedAt,
    schemaReference: templateName,
    simpsonHsUrl: HS_URL,
    hsReferenceTitle: hsReference?.meta?.title ?? null,
    purpose:
      "Each TRE maps to one Simpson Hanger Selector connection type from TRE truss links + Simpson IFC bearings.",
    trussConnectionCount: connectionGraph.length,
    count: 0,
    marks: [],
    maps: {},
  };

  const parameterMaps = {};

  for (const ctx of Object.values(treCatalog)) {
    const mark = ctx.tre.mark;
    const connectionType = ctx.connectionType;
    const csv = buildCsvFromTemplate(templateRows, ctx, treCatalog, hsReference);

    const json = {
      mark,
      treFile: ctx.tre.file,
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
      simpsonHsUrl: HS_URL,
      usageNote:
        connectionType == null
          ? ctx.connectionReason
          : `Open Simpson Hanger Selector, choose "${connectionUiLabel(hsReference, connectionType) ?? connectionType}", then copy values from the filled column.`,
      connectionOptions,
      apiBody:
        connectionType == null ? null : buildApiBodyForColumn(ctx, connectionType, treCatalog, hsReference),
      apiBodies:
        connectionType == null
          ? {}
          : { [connectionType]: buildApiBodyForColumn(ctx, connectionType, treCatalog, hsReference) },
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

    parameterMaps[mark] = { csv, json };
    parameterIndex.marks.push(mark);
    parameterIndex.maps[mark] = {
      file: `${mark}.csv`,
      json: `${mark}.json`,
      suggestedConnection: connectionType,
      connectionType,
      hangerRole: ctx.hangerRole,
      role: ctx.role,
      carryingGirderMark: ctx.carryingGirderMark ?? null,
      trussType: ctx.tre.trussType,
      download: ctx.seatDownload ?? ctx.download,
      uplift: ctx.seatUplift ?? ctx.uplift,
    };
  }

  parameterIndex.marks.sort();
  parameterIndex.count = parameterIndex.marks.length;

  const { index: connectionIndex, records: connectionRecords } = computeConnectionRecords({
    connectionGraph,
    treCatalog,
    simpsonBearings,
    hsReference,
    generatedAt,
  });

  const trussConnections = {
    generatedAt,
    simpsonIfcSource: simpsonBearings.source ?? null,
    purpose:
      "Truss-to-truss relationships from TRE. Each link has one connection map for Simpson Hanger Selector.",
    connectionMapIndex: "connection-maps/index.json",
    count: connectionGraph.length,
    links: connectionGraph.map((link) => ({
      ...link,
      connectionMapFile: `connection-maps/${link.connectionId}.json`,
      simpsonHsConnectionType: "truss",
      simpsonHsConnectionLabel: connectionUiLabel(hsReference, "truss"),
    })),
    byCarriedMark: carriedByIndex,
  };

  return { parameterIndex, parameterMaps, connectionIndex, connectionRecords, trussConnections };
}
