import { describeMultiConfiguration } from "./hs-reference.js";
import { bearingReactionForSeat } from "./tre-core.js";

/** Stable id for one carrying → carried truss mark pair (mark-level grouping). */
export function connectionId(carryingMark, carriedMark) {
  return `${carryingMark}__${carriedMark}`;
}

/** Stable id for one physical hanger instance (carrying → carried at hanger N). */
export function hangerConnectionId(carryingMark, carriedMark, hangerIndex) {
  return `${carryingMark}__${carriedMark}__H${hangerIndex}`;
}

function seatPosition(seats, mark) {
  if (seats.left?.mark === mark) return "left";
  if (seats.center?.mark === mark) return "center";
  if (seats.right?.mark === mark) return "right";
  return "other";
}

/**
 * All truss-to-truss hanger links from the girder LG*T seat lines. Faithful to
 * the reference (buildBatchPayloads over group.carriedTrusses): ONE link per
 * physical hanger instance — each hanger has its own position (localX), bearing
 * location, governing reaction, and king post — not one per carried mark.
 */
export function buildTrussConnectionGraph(treCatalog) {
  const links = [];

  for (const [girderMark, ctx] of Object.entries(treCatalog)) {
    if (ctx.role !== "carrying") continue;

    // Fallback girder-side loads by mark (used only when a hanger has no matching
    // REACTION INFO in the carried truss TRE).
    const loadByMark = new Map();
    for (const load of ctx.tre.carriedLoads ?? []) {
      const existing = loadByMark.get(load.mark);
      if (!existing || (load.reactionDown ?? 0) > (existing.reactionDown ?? 0)) {
        loadByMark.set(load.mark, load);
      }
    }

    const configuration = describeMultiConfiguration(ctx.seats);
    const seats = (ctx.tre.hangerSeats ?? []).filter((s) => /^[TJ]\d/.test(s.mark));

    for (const seat of seats) {
      const carriedMark = seat.mark;
      const carriedCtx = treCatalog[carriedMark];

      // Reference bearing calc (parser.ts parseReactionAtBearing +
      // enrichCarriedTrusses): governing reaction at the carried truss's bearing
      // end from ITS OWN REACTION INFO, using this hanger's stub-adjusted
      // bearingLocation. Yields the bearing side and governing DOL factors.
      const reaction = bearingReactionForSeat(
        carriedCtx?.content,
        carriedCtx?.tre,
        seat.bearingLocation,
      );
      const fallback = loadByMark.get(carriedMark);
      const download = reaction
        ? Math.round(reaction.downReaction)
        : Math.round(fallback?.reactionDown ?? 0);
      const uplift = reaction
        ? Math.round(Math.abs(reaction.upliftReaction))
        : Math.round(Math.abs(fallback?.uplift ?? 0));

      // Reference buildBatchPayloads skips carried trusses with no download.
      if (!(download > 0)) continue;

      links.push({
        connectionId: hangerConnectionId(girderMark, carriedMark, seat.groupIndex),
        carriedMark,
        carryingMark: girderMark,
        hangerIndex: seat.groupIndex,
        localX: seat.xInches ?? null,
        position: seatPosition(ctx.seats, carriedMark),
        configuration,
        download,
        uplift,
        bearingLocation: seat.bearingLocation ?? null,
        bearingSide: reaction?.bearingSide ?? null,
        downDolFactor: reaction?.downDolFactor ?? null,
        upliftDolFactor: reaction?.upliftDolFactor ?? null,
        hangerAngle: seat.angle ?? 90,
        reactionSource: reaction ? "tre-reaction-info" : "girder-load-fallback",
        skewType: seat.skewType,
        simpsonHsType: "truss",
        note: "One physical hanger instance → Truss (Flush Bottom).",
      });
    }
  }

  return links.sort(
    (a, b) =>
      a.carryingMark.localeCompare(b.carryingMark) ||
      a.carriedMark.localeCompare(b.carriedMark) ||
      (a.hangerIndex ?? 0) - (b.hangerIndex ?? 0),
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
