import { describeMultiConfiguration } from "./hs-reference.js";

/** Stable id for one carrying → carried truss connection. */
export function connectionId(carryingMark, carriedMark) {
  return `${carryingMark}__${carriedMark}`;
}

function seatPosition(seats, mark) {
  if (seats.left?.mark === mark) return "left";
  if (seats.center?.mark === mark) return "center";
  if (seats.right?.mark === mark) return "right";
  return "other";
}

function mergeSeatLoad(existing, load, seat) {
  if (!existing) {
    return {
      mark: load?.mark ?? seat?.mark,
      reactionDown: load?.reactionDown ?? 0,
      uplift: Math.abs(load?.uplift ?? 0),
      xFeet: load?.xFeet ?? seat?.xFeet ?? null,
      skewAngle: seat?.skewAngle ?? 0,
      skewType: seat?.skewType ?? 0,
    };
  }
  return {
    ...existing,
    reactionDown: Math.max(existing.reactionDown, load?.reactionDown ?? 0),
    uplift: Math.max(existing.uplift, Math.abs(load?.uplift ?? 0)),
    skewAngle: seat?.skewAngle ?? existing.skewAngle,
    skewType: seat?.skewType ?? existing.skewType,
  };
}

/**
 * All truss-to-truss hanger links from TRE girder LoadCase + LG seat data.
 */
export function buildTrussConnectionGraph(treCatalog) {
  const links = [];

  for (const [girderMark, ctx] of Object.entries(treCatalog)) {
    if (ctx.role !== "carrying") continue;

    const byCarriedMark = new Map();

    for (const load of ctx.tre.carriedLoads ?? []) {
      byCarriedMark.set(load.mark, mergeSeatLoad(byCarriedMark.get(load.mark), load, null));
    }
    for (const seat of ctx.tre.hangerSeats ?? []) {
      byCarriedMark.set(
        seat.mark,
        mergeSeatLoad(byCarriedMark.get(seat.mark), null, seat),
      );
    }

    const configuration = describeMultiConfiguration(ctx.seats);

    for (const [carriedMark, data] of byCarriedMark) {
      links.push({
        carriedMark,
        carryingMark: girderMark,
        position: seatPosition(ctx.seats, carriedMark),
        configuration,
        download: data.reactionDown,
        uplift: data.uplift,
        skewAngle: data.skewAngle,
        skewType: data.skewType,
        simpsonHsType: "truss",
        note: "Carried truss → use Truss (Flush Bottom) on carried map; girder uses Multi",
      });
    }
  }

  return links.sort(
    (a, b) =>
      a.carryingMark.localeCompare(b.carryingMark) ||
      a.carriedMark.localeCompare(b.carriedMark),
  );
}

/**
 * Index carried mark → all parent girders (a truss may appear on multiple girders in TRE).
 */
export function buildCarriedByIndex(connectionGraph) {
  const index = {};
  for (const link of connectionGraph) {
    if (!index[link.carriedMark]) {
      index[link.carriedMark] = [];
    }
    index[link.carriedMark].push(link);
  }
  return index;
}

/**
 * Pick primary parent girder for parameter map carrying member section.
 */
export function primaryParentLink(links) {
  if (!links?.length) return null;
  return [...links].sort((a, b) => b.download - a.download)[0];
}

/**
 * Simpson HS connection type for this TRE mark's parameter map.
 */
export function resolveConnectionType(ctx, simpsonBearing, connectionGraph) {
  const trussType = ctx.tre.trussType ?? "";
  const carriedLinks = connectionGraph.filter((link) => link.carriedMark === ctx.tre.mark);
  const isCarried = carriedLinks.length > 0;
  const isCarrying = ctx.role === "carrying";

  if (/joist|i-joist|floor joist/i.test(trussType) && !/truss|girder/i.test(trussType)) {
    return { connectionType: "joist", hangerRole: "joist", reason: "Floor joist / I-joist type" };
  }

  if (isCarrying) {
    const marks = new Set([
      ...(ctx.tre.carriedLoads ?? []).map((entry) => entry.mark),
      ...(ctx.tre.hangerSeats ?? []).map((seat) => seat.mark),
    ]);
    const hasHipLayout = Boolean(ctx.seats.left && ctx.seats.right);
    const hasHangerBank = (ctx.tre.hangerSeats ?? []).some((seat) => /^[TJ]\d/.test(seat.mark));

    if (marks.size >= 2 || hasHipLayout || (ctx.tre.girder && hasHangerBank && marks.size >= 1)) {
      return {
        connectionType: "multi",
        hangerRole: "carrying",
        reason: `Carrying girder with ${marks.size} truss seat(s) — Multi-Truss (Flush Bottom)`,
      };
    }
  }

  if (isCarried) {
    return {
      connectionType: "truss",
      hangerRole: "carried",
      reason: `Hung from ${carriedLinks.map((l) => l.carryingMark).join(", ")} — Truss (Flush Bottom)`,
    };
  }

  if (simpsonBearing?.wallOnly) {
    return {
      connectionType: null,
      hangerRole: "wall",
      reason: "Simpson IFC: wall bearing only — no truss-to-truss hanger",
    };
  }

  if (simpsonBearing?.hasHangerToTruss) {
    return {
      connectionType: "truss",
      hangerRole: "unknown",
      reason: "Simpson IFC: Hanger-To-Truss bearing (parent girder not in TRE graph)",
    };
  }

  return {
    connectionType: "truss",
    hangerRole: "standalone",
    reason: "Standard truss — Truss (Flush Bottom) if hung, else wall bearing",
  };
}
