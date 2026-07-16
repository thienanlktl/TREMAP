import fs from "fs";
import path from "path";
import { connectionUiLabel } from "./hs-reference.js";
import {
  sstTrussHangerBody,
  sstCarryingMember,
  sstCarriedMember,
  deriveSkew,
} from "../shared/sst-mapper.js";

/**
 * Heel height at the carried truss's bearing side (reference getCarriedDepth):
 * use the heel matching the bearing end, fall back to the other end, then 3.5".
 */
function carriedHeelAtBearing(carriedTre, bearingSide) {
  const left = carriedTre?.leftHeel;
  const right = carriedTre?.rightHeel;
  if (bearingSide === "left") return left ?? right ?? 3.5;
  return right ?? left ?? 3.5;
}

/** Format a position along the girder (inches) as feet-inches for display. */
function feetInches(inches) {
  if (inches == null || Number.isNaN(inches)) return null;
  const ft = Math.floor(inches / 12);
  const inch = inches - ft * 12;
  return `${ft}'-${inch.toFixed(1)}"`;
}

export function treTechnicalSummary(ctx) {
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

/**
 * Simpson HS apiBody for one truss-to-truss link (Truss Flush Bottom).
 * Carrying member = girder; carried member = hung truss with seat ASD loads.
 */
export function buildApiBodyForConnection(link, carryingCtx, carriedCtx, hsRef) {
  // Faithful port of reference buildSSTPayload (sst-mapper.ts): carrying member
  // from the girder's bottom chord + king-post detection at the hanger position;
  // carried member from the carried truss's bottom chord + heel at the bearing
  // side; skew derived from the hanger angle; download/uplift durations from the
  // governing load cases' DOL factors.
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

  // UI-only metadata (stripped before POST by prepareSSTPayload)
  body.simpsonHsUrl = "https://app.strongtie.com/hs";
  body.connectionLabel = connectionUiLabel(hsRef, "truss") ?? "Truss (Flush Bottom)";
  body.hangerOptions = null;
  return body;
}

/**
 * One mapping file per truss-to-truss connection for Simpson Hanger Selector.
 */
export function buildConnectionMaps({
  connectionGraph,
  treCatalog,
  simpsonBearings,
  hsReference,
  dataOutDir,
}) {
  const dir = path.join(dataOutDir, "connection-maps");
  fs.mkdirSync(dir, { recursive: true });

  // Clear stale connection files (the id scheme is now per-hanger-instance, so
  // old per-mark-pair files would otherwise linger).
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith(".json")) fs.rmSync(path.join(dir, name));
  }

  const connections = [];

  for (const link of connectionGraph) {
    const id = link.connectionId;
    const carryingCtx = treCatalog[link.carryingMark];
    const carriedCtx = treCatalog[link.carriedMark];
    if (!carryingCtx || !carriedCtx) continue;

    const apiBody = buildApiBodyForConnection(link, carryingCtx, carriedCtx, hsReference);
    const carryingIfc = simpsonBearings.byMark?.[link.carryingMark] ?? null;
    const carriedIfc = simpsonBearings.byMark?.[link.carriedMark] ?? null;

    const record = {
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
      loadsAsd: {
        download: link.download,
        uplift: link.uplift,
      },
      geometry: {
        // Skew is derived from the hanger angle (LG*T field[14]) exactly as the
        // reference does; slope is 0 (flush-bottom seat is level). For this
        // project all hangers are perpendicular (angle 90) so skew resolves to 0.
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
      selectionNote:
        `One Simpson hanger for ${link.carryingMark} → ${link.carriedMark}` +
        `${feetInches(link.localX) ? ` at ${feetInches(link.localX)} along ${link.carryingMark}` : ""}. ` +
        "Open Hanger Selector → Truss (Flush Bottom), paste apiBody values, " +
        "then choose the recommended model from results.",
      simpsonHsUrl: "https://app.strongtie.com/hs",
    };

    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(record, null, 2));

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
    generatedAt: new Date().toISOString(),
    purpose:
      "Each entry is one physical truss-to-truss hanger connection. " +
      "Technical inputs are merged from MiTek TRE (Truss Analyzer), Simpson IFC bearings, " +
      "and Simpson Hanger Selector fields — use apiBody to select one hanger per connection.",
    simpsonHsUrl: "https://app.strongtie.com/hs",
    count: connections.length,
    connections,
  };

  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 2));
  return index;
}
