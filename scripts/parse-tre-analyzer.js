import fs from "fs";
import path from "path";

function readTreField(content, fieldName) {
  const match = content.match(
    new RegExp(`^${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=(.+)$`, "m"),
  );
  return match ? match[1].trim() : null;
}

function formatFeetInches(feet) {
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
    let points = [];

    if (lines[i + 2]?.includes(",")) {
      const specParts = lines[i + 2].split(",");
      size = specParts[0]?.trim() ?? "";
      grade = `${specParts[1]?.trim() ?? ""} ${specParts[2]?.trim() ?? ""}`.trim();
    }

    if (lines[i + 3]) {
      points = parseMemberPoints(lines[i + 3]);
    }

    if (points.length >= 2) {
      members.push({
        index: Number.parseInt(header[1], 10),
        label,
        role: memberRole(label),
        size,
        grade,
        points,
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

    seats.push({
      groupIndex: Number.parseInt(match[1], 10),
      mark,
      xFeet: Number.parseFloat(parts[2]),
      xInches: Number.parseFloat(parts[2]) * 12,
      width: Number.parseFloat(parts[5]),
      depth: Number.parseFloat(parts[6]),
      materialCode: Number.parseInt(parts[7], 10),
      ply: Number.parseInt(parts[8], 10),
      skewAngle: Number.parseFloat(parts[14]),
      skewType: Number.parseInt(parts[15], 10),
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

export function parseTreAnalyzer(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const base = path.basename(filePath, ".tre");
  const mark = base.toUpperCase();

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

  const pitchLine = content.split(/\r?\n/)[roofIdx + 2];
  let pitch = null;
  if (pitchLine) {
    const riseRun = Number.parseFloat(pitchLine.trim().split(/\s+/)[0]);
    if (!Number.isNaN(riseRun)) {
      pitch = `${riseRun.toFixed(2)}/12`;
    }
  }

  const members = parseMembers(content);
  const carriedLoads = parseCarriedLoads(content);
  const reactions = parseReactions(content);
  const hangerSeats = parseHangerLoadingInfo(content);
  const bearings = parseBearings(content);

  return {
    mark,
    file: path.basename(filePath),
    trussType: readTreField(content, "TRUSS TYPE"),
    girder: readTreField(content, "Girder") === "YES",
    spanInches: spanInchesResolved,
    spanDisplay: spanInchesResolved ? formatFeetInches(spanInchesResolved / 12) : null,
    pitch,
    spacing: readTreField(content, "Spacing"),
    ply: Number.parseInt(readTreField(content, "Ply") ?? "1", 10),
    quantity: Number.parseInt(readTreField(content, "Quantity") ?? "1", 10),
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

export function buildTrussAnalysisCatalog(treDir) {
  const files = fs
    .readdirSync(treDir)
    .filter((name) => /^[tj]\d+[a-z]*\.tre$/i.test(name))
    .sort();

  const trusses = {};
  for (const file of files) {
    const data = parseTreAnalyzer(path.join(treDir, file));
    trusses[data.mark] = data;
  }

  return {
    generatedAt: new Date().toISOString(),
    count: Object.keys(trusses).length,
    trusses,
    girders: Object.values(trusses)
      .filter((truss) => truss.girder || truss.carriedLoads.length > 0)
      .map((truss) => truss.mark)
      .sort(),
  };
}
