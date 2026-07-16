/**
 * Pure MiTek TRE parsing + reaction calc — NO Node `fs`/`path`.
 *
 * Shared by the Node build (scripts/parse-tre-analyzer.js wraps these with file
 * I/O) and the browser runtime (shared/dataset.js parses user-uploaded TRE text).
 * Keep this module free of any Node built-ins so it bundles for the browser.
 */

/** basename without an extension, uppercased — replaces path.basename for marks. */
function markFromFileName(fileName) {
  const base = String(fileName).replace(/^.*[/\\]/, "").replace(/\.(tre|txt)$/i, "");
  return base.toUpperCase();
}

function baseName(fileName) {
  return String(fileName).replace(/^.*[/\\]/, "");
}

export function readTreField(content, fieldName) {
  const match = content.match(
    new RegExp(`^${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=(.+)$`, "m"),
  );
  return match ? match[1].trim() : null;
}

export function formatFeetInches(feet) {
  const wholeFeet = Math.floor(feet);
  const inches = (feet - wholeFeet) * 12;
  return `${wholeFeet}'-${inches.toFixed(2)}"`;
}

function memberRole(label) {
  const name = label.toUpperCase();
  if (/^T\d/.test(name)) return "tc";
  if (/^B\d/.test(name)) return "bc";
  if (/^W\d|^ST\d|^EV/.test(name)) return "web";
  if (/^BR|^DB|^DT|^PT|^HV/.test(name)) return "bearing";
  return "other";
}

function parseMemberPoints(line) {
  const nums = line
    .trim()
    .split(",")
    .map((part) => Number.parseFloat(part.trim()))
    .filter((value) => !Number.isNaN(value));

  const points = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] });
  }
  return points;
}

function parseMembers(content) {
  const sectionMatch = content.match(/MEMBER INFO[\s\S]*?(?=\n\[|$)/);
  if (!sectionMatch) {
    return [];
  }

  const members = [];
  const lines = sectionMatch[0].split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const header = lines[i].match(/^\s+(\d+)\s+([A-Z][A-Z0-9]*)\s/);
    if (!header) {
      i += 1;
      continue;
    }

    const label = header[2];
    let size = "";
    let grade = "";
    let width = 0;
    let depth = 0;
    let points = [];

    // Spec line: "size,grade,species,width,depth,..." e.g. "2x4,No.2,SP, 1.50, 3.50,..."
    if (lines[i + 2]?.includes(",")) {
      const specParts = lines[i + 2].split(",");
      size = specParts[0]?.trim() ?? "";
      grade = `${specParts[1]?.trim() ?? ""} ${specParts[2]?.trim() ?? ""}`.trim();
      width = Number.parseFloat(specParts[3]) || 0;
      depth = Number.parseFloat(specParts[4]) || 0;
    }

    if (lines[i + 3]) {
      points = parseMemberPoints(lines[i + 3]);
    }

    if (points.length >= 2) {
      // isStructural: real extent (> 0.5") in either axis — excludes zero-length
      // dummy members. Matches the reference parser's isStructural flag.
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const isStructural =
        Math.max(...xs) - Math.min(...xs) > 0.5 ||
        Math.max(...ys) - Math.min(...ys) > 0.5;

      members.push({
        index: Number.parseInt(header[1], 10),
        label,
        role: memberRole(label),
        size,
        grade,
        width,
        depth,
        points,
        isStructural,
      });
    }

    i += 1;
  }

  return members;
}

function parseCarriedLoads(content) {
  const loads = new Map();
  const linePattern = /^LoadCase\d+@\d+=(.+)$/gm;

  for (const match of content.matchAll(linePattern)) {
    const parts = match[1].split("~");
    if (parts.length < 18) {
      continue;
    }

    const mark = parts[17]?.trim().toUpperCase();
    if (!mark || mark === "NONAME" || !/^[TJ]\d/.test(mark)) {
      continue;
    }

    const xFeet = Number.parseFloat(parts[6]);
    if (Number.isNaN(xFeet)) {
      continue;
    }

    const loadType = Number.parseInt(parts[9], 10);
    const magnitude = Number.parseFloat(parts[10]);
    if (Number.isNaN(magnitude)) {
      continue;
    }

    const key = `${mark}@${xFeet.toFixed(3)}`;
    if (!loads.has(key)) {
      loads.set(key, {
        mark,
        xFeet,
        xInches: xFeet * 12,
        reactionDown: 0,
        uplift: 0,
      });
    }

    const entry = loads.get(key);
    if (loadType === 0) {
      entry.reactionDown = Math.max(entry.reactionDown, Math.round(magnitude));
    } else if (loadType === 1) {
      entry.uplift = Math.min(entry.uplift, -Math.round(magnitude));
    }
  }

  return [...loads.values()].sort((a, b) => a.xInches - b.xInches || a.mark.localeCompare(b.mark));
}

function parseReactions(content) {
  const reactions = [];
  for (let i = 1; i <= 12; i += 1) {
    const value = readTreField(content, `Reaction${i}`);
    if (value != null && value !== "") {
      reactions.push(Number.parseInt(value, 10));
    }
  }
  return reactions;
}

function parseHangerLoadingInfo(content) {
  const seats = [];
  const pattern = /^LG(\d+)T=(.+)$/gm;

  for (const match of content.matchAll(pattern)) {
    const parts = match[2].trim().split(/\s+/);
    if (parts.length < 16) {
      continue;
    }

    const mark = parts[4]?.trim().toUpperCase();
    if (!mark || !/^[TJ]\d/.test(mark)) {
      continue;
    }

    // LG*T field layout (0-based after '='):
    //   [2]=xInches (position along girder, INCHES) [4]=mark [5]=width [6]=heel
    //   [14]=angle (carried truss angle vs girder; 90 = perpendicular)
    //   [16]=bearingLocation (carried truss bearing coord, inches) [17]=seat slope
    const xInches = Number.parseFloat(parts[2]);
    seats.push({
      groupIndex: Number.parseInt(match[1], 10),
      mark,
      xInches,
      xFeet: xInches / 12,
      width: Number.parseFloat(parts[5]),
      depth: Number.parseFloat(parts[6]),
      materialCode: Number.parseInt(parts[7], 10),
      ply: Number.parseInt(parts[8], 10),
      // Hanger angle (field[14]) — the carried truss's angle relative to the
      // girder. The Simpson skew is DERIVED from this (see sst-mapper deriveSkew).
      angle: Number.parseFloat(parts[14]),
      skewType: Number.parseInt(parts[15], 10),
      // field[16] = coordinate (inches) of the carried truss's bearing end at this
      // hanger. Used to look up the governing reaction in the carried truss's
      // REACTION INFO section (see parseReactionAtBearing).
      bearingLocation: Number.parseFloat(parts[16]),
      slopeAngle: Number.parseFloat(parts[17]),
    });
  }

  return seats.sort((a, b) => a.xInches - b.xInches || a.mark.localeCompare(b.mark));
}

function parseBearings(content) {
  const sectionMatch = content.match(/BEARING INFO[\s\S]*?(?=\n\[|\nNOTES|\nTRUSS INFO|$)/);
  if (!sectionMatch) {
    return [];
  }

  const bearings = [];
  for (const line of sectionMatch[0].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^\d+\s+\d+/.test(trimmed)) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    const brIndex = parts.findIndex((part) => /^BR\d/i.test(part));
    if (brIndex < 0 || parts.length < brIndex + 10) {
      continue;
    }

    const angleRad = Number.parseFloat(parts[parts.length - 4]);
    const skewType = Number.parseInt(parts[parts.length - 3], 10);
    bearings.push({
      xInches: Number.parseFloat(parts[3]),
      bearingType: Number.parseInt(parts[6], 10),
      width: Number.parseFloat(parts[parts.length - 8]),
      skewAngleDeg: Number.isFinite(angleRad) ? Math.round((angleRad * 180) / Math.PI) : 0,
      skewType,
      label: parts[brIndex],
    });
  }

  return bearings;
}

// Bearing-match tolerance (inches). Covers floating-point drift and coordinate
// offset between the girder LG bearingLocation and the carried truss REACTION
// INFO coords (reference notes the T09A case has a ~4.0" diff). Matches the
// reference parser.ts BEARING_LOCATION_TOLERANCE.
const BEARING_LOCATION_TOLERANCE = 4.1;

/**
 * Governing reaction (and its DOL factor) at a carried truss's bearing end.
 *
 * Faithful port of `parseReactionAtBearing()` in the reference parser.ts
 * (phuongphamsp/truss-analyzer @ DataBridge-Poc1). Reads the carried truss's own
 * REACTION INFO section, matches the target bearing coordinate against each load
 * case's bearing ends (bearingA = left, bearingB = right), and collects the
 * governing (col[6] == -1) values at that bearing across all load cases. The DOL
 * factor is the last field of each load case's header line.
 */
export function parseReactionAtBearing(content, targetBearing) {
  if (!content || !Number.isFinite(targetBearing) || targetBearing < 0) return null;

  const lines = content.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() !== "REACTION INFO") i += 1;
  if (i >= lines.length) return null;

  i += 1; // skip 'REACTION INFO'
  while (i < lines.length && lines[i].trim() === "") i += 1;
  i += 1; // skip the load-case count line

  const entries = []; // { value, dolFactor }
  let bearingSide = null;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line.startsWith("2 -1 -1 -1 -1")) {
      i += 1;
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length < 7) {
      i += 1;
      continue;
    }

    const bearingA = Number.parseFloat(parts[5]); // smaller coord -> LEFT end
    const bearingB = Number.parseFloat(parts[6]); // larger coord  -> RIGHT end
    const dolFactor = Number.parseFloat(parts[parts.length - 1]); // last header field
    const matchA = Math.abs(bearingA - targetBearing) <= BEARING_LOCATION_TOLERANCE;
    const matchB = Math.abs(bearingB - targetBearing) <= BEARING_LOCATION_TOLERANCE;
    if (!matchA && !matchB) {
      i += 1;
      continue;
    }
    if (bearingSide === null) bearingSide = matchA ? "left" : "right";
    const matchedBearing = matchA ? bearingA : bearingB;

    i += 1;
    while (i < lines.length) {
      const dl = lines[i].trim();
      if (dl.startsWith("2 -1 -1 -1 -1") || dl === "REACTION INFO" || dl.startsWith("[")) {
        break;
      }
      if (!dl.startsWith("0")) {
        i += 1;
        continue;
      }
      const dp = dl.split(/\s+/);
      if (dp.length < 7) {
        i += 1;
        continue;
      }
      const value = Number.parseFloat(dp[1]);
      const bearingLoc = Number.parseFloat(dp[3]);
      const loadType = Number.parseFloat(dp[6]);
      if (
        loadType === -1 &&
        Math.abs(bearingLoc - matchedBearing) <= BEARING_LOCATION_TOLERANCE
      ) {
        entries.push({ value, dolFactor });
      }
      i += 1;
    }
  }

  if (entries.length === 0) return null;
  const downEntry = entries.reduce((a, b) => (b.value > a.value ? b : a));
  const upliftEntry = entries.reduce((a, b) => (b.value < a.value ? b : a));
  return {
    downReaction: downEntry.value,
    upliftReaction: upliftEntry.value,
    bearingSide: bearingSide ?? "left",
    downDolFactor: downEntry.dolFactor,
    upliftDolFactor: upliftEntry.dolFactor,
  };
}

/**
 * Resolve the governing reaction for a hanger seat, applying the stub offset
 * exactly as the reference `enrichCarriedTrusses()` does before matching.
 */
export function bearingReactionForSeat(content, carriedTre, bearingLocation) {
  if (!content || !Number.isFinite(bearingLocation) || bearingLocation < 0) {
    return null;
  }
  const leftStub = carriedTre?.leftStub ?? 0;
  const rightStub = carriedTre?.rightStub ?? 0;
  const span = carriedTre?.spanInches ?? 0;
  const adjustedLeft = bearingLocation - leftStub;
  const adjustedRight = span - bearingLocation - rightStub;
  const targetBearing = adjustedLeft >= 0 ? adjustedLeft : adjustedRight;
  return parseReactionAtBearing(content, targetBearing);
}

export function buildGirderIndex(treCatalog) {
  const index = {};

  for (const [girderMark, ctx] of Object.entries(treCatalog)) {
    if (ctx.role !== "carrying") {
      continue;
    }

    for (const load of ctx.tre.carriedLoads ?? []) {
      const existing = index[load.mark];
      if (!existing || load.reactionDown > (existing.load?.reactionDown ?? 0)) {
        index[load.mark] = { girderMark, girderCtx: ctx, load, seat: null };
      }
    }

    for (const seat of ctx.tre.hangerSeats ?? []) {
      const existing = index[seat.mark];
      const entry = {
        girderMark,
        girderCtx: ctx,
        load: existing?.load ?? null,
        seat,
      };
      if (!existing || (seat.xInches ?? 0) < (existing.seat?.xInches ?? Infinity)) {
        index[seat.mark] = entry;
      }
    }
  }

  return index;
}

/**
 * Parse one TRE file's raw text into the analyzer/parameter-map data model.
 * @param {string} fileName Original file name (used for the mark + display).
 * @param {string} content  Raw .tre text.
 */
export function parseTreAnalyzerText(fileName, content) {
  const mark = markFromFileName(fileName);

  let spanInches = null;
  const roofIdx = content.split(/\r?\n/).findIndex((line) => line.trim() === "ROOF BASICS");
  if (roofIdx >= 0) {
    const parts = content.split(/\r?\n/)[roofIdx + 1]?.trim().split(/\s+/);
    if (parts?.length >= 2) {
      spanInches = Number.parseFloat(parts[1]);
    }
  }

  const spanField = readTreField(content, "Span");
  const spanInchesResolved = spanField ? Number.parseFloat(spanField) : spanInches;

  // Roof slope lives on the ROOF BASICS +1 line as the top-chord angle in
  // RADIANS at field index 2 (e.g. 0.463648 = 6/12, 0.321751 = 4/12), alongside
  // span at index 1. The +2 line is overhang/heel geometry, NOT rise/run.
  const roofBasicsParts =
    roofIdx >= 0 ? content.split(/\r?\n/)[roofIdx + 1]?.trim().split(/\s+/) : null;
  let pitch = null;
  if (roofBasicsParts && roofBasicsParts.length >= 3) {
    const slopeRad = Number.parseFloat(roofBasicsParts[2]);
    if (!Number.isNaN(slopeRad)) {
      const rise = Math.abs(Math.tan(slopeRad)) * 12;
      pitch = `${rise.toFixed(2)}/12`;
    }
  }

  const members = parseMembers(content);
  const carriedLoads = parseCarriedLoads(content);
  const reactions = parseReactions(content);
  const hangerSeats = parseHangerLoadingInfo(content);
  const bearings = parseBearings(content);

  const numField = (name) => {
    const v = readTreField(content, name);
    const n = v != null ? Number.parseFloat(v) : NaN;
    return Number.isNaN(n) ? null : n;
  };
  const leftHeel = numField("Left Heel Height");
  const rightHeel = numField("Right Heel Height");
  const leftStub = numField("Left Stub") ?? 0;
  const rightStub = numField("Right Stub") ?? 0;

  return {
    mark,
    file: baseName(fileName),
    trussType: readTreField(content, "TRUSS TYPE"),
    girder: readTreField(content, "Girder") === "YES",
    spanInches: spanInchesResolved,
    spanDisplay: spanInchesResolved ? formatFeetInches(spanInchesResolved / 12) : null,
    pitch,
    spacing: readTreField(content, "Spacing"),
    ply: Number.parseInt(readTreField(content, "Ply") ?? "1", 10),
    quantity: Number.parseInt(readTreField(content, "Quantity") ?? "1", 10),
    leftHeel,
    rightHeel,
    leftStub,
    rightStub,
    topChordLumber: readTreField(content, "Top Chord Lumber"),
    bottomChordLumber: readTreField(content, "Bottom Chord Lumber"),
    engineering: {
      maxTcCsi: readTreField(content, "Max Top Chord CSI"),
      maxBcCsi: readTreField(content, "Max Bottom Chord CSI"),
      ssi: readTreField(content, "SSI"),
      deflectionTL: readTreField(content, "Vertical (TL) Deflection"),
      deflectionLL: readTreField(content, "Vertical (LL) Deflection"),
      maxUplift1: readTreField(content, "Max Uplift1"),
      maxUplift2: readTreField(content, "Max Uplift2"),
      weight: readTreField(content, "Truss Weight"),
      reactions,
      reactionMax: reactions.length ? Math.max(...reactions) : null,
      reactionMin: reactions.length ? Math.min(...reactions) : null,
    },
    loads: {
      tcLive: readTreField(content, "Top Chord Live Load"),
      tcDead: readTreField(content, "Top Chord Dead Load"),
    },
    members,
    carriedLoads,
    hangerSeats,
    bearings,
    designDate: readTreField(content, "Date"),
    designCode: content.match(/(IRC\d{4}\/TPI\d{4})/)?.[1] ?? null,
  };
}

/**
 * Build the truss-analysis catalog from an array of { name, text } TRE files.
 * @param {Array<{ name: string, text: string }>} files
 * @param {string} [generatedAt] ISO timestamp (caller supplies; keeps this pure).
 */
export function buildTrussAnalysisCatalogFromTexts(files, generatedAt = new Date().toISOString()) {
  const treFiles = files
    .filter((f) => /^[tj]\d+[a-z]*\.(tre|txt)$/i.test(baseName(f.name)))
    .sort((a, b) => baseName(a.name).localeCompare(baseName(b.name)));

  const trusses = {};
  for (const file of treFiles) {
    const data = parseTreAnalyzerText(file.name, file.text);
    trusses[data.mark] = data;
  }

  return {
    generatedAt,
    count: Object.keys(trusses).length,
    trusses,
    girders: Object.values(trusses)
      .filter((truss) => truss.girder || truss.carriedLoads.length > 0)
      .map((truss) => truss.mark)
      .sort(),
  };
}
