import fs from "fs";
import path from "path";
import { connectionUiLabel, defaultApiBody } from "./hs-reference.js";
import { connectionId } from "./truss-connections.js";

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
  const base = defaultApiBody(hsRef, "truss") ?? {};
  const material = carriedCtx.trussMaterial;

  return {
    flushOption: "BOTTOM",
    ansitpi: base.ansitpi ?? 0,
    buildingCode: base.buildingCode ?? 20,
    concealed: base.concealed ?? 0,
    fastenerType: base.fastenerType ?? 0,
    style: base.style ?? 0,
    ledger: base.ledger ?? 0,
    sort: base.sort ?? 12,
    designInformations: base.designInformations ?? {
      downloadDurationType: 100,
      upliftLoadDurationType: 160,
    },
    filters: base.filters ?? {
      depth: 0,
      width: 0,
      series: "",
      model: "",
      webStiffeners: 0,
    },
    simpsonHsUrl: "https://app.strongtie.com/hs",
    connectionLabel: connectionUiLabel(hsRef, "truss") ?? "Truss (Flush Bottom)",
    hangerOptions: null,
    carryingMember: {
      width: carryingCtx.carryingWidth ?? carryingCtx.width,
      depth: carryingCtx.carryingDepth ?? carryingCtx.depth,
      material: carryingCtx.trussMaterial,
      ply: carryingCtx.carryingPly ?? carryingCtx.tre.ply,
      kingHeight: carryingCtx.trussHeight ?? 0,
      kingWidth: carryingCtx.width,
      topChordPly: carryingCtx.tre.ply,
      topChord: 0,
    },
    carriedMembers: [
      {
        width: carriedCtx.width,
        depth: carriedCtx.heelHeight ?? carriedCtx.depth,
        material,
        ply: carriedCtx.tre.ply,
        loads: {
          load: link.download,
          uplift: link.uplift,
        },
        angle: {
          skewAngle: link.skewAngle ?? 0,
          skewType: link.skewType ?? 0,
          slopeAngle: carriedCtx.slopeDeg ?? 0,
          slopeType: (carriedCtx.slopeDeg ?? 0) > 0 ? 1 : 0,
        },
        memberId: link.carriedMark,
      },
    ],
  };
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

  const connections = [];

  for (const link of connectionGraph) {
    const id = connectionId(link.carryingMark, link.carriedMark);
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
        skewAngle: link.skewAngle,
        skewType: link.skewType,
        slopeAngle: carriedCtx.slopeDeg,
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
        `One Simpson hanger for ${link.carryingMark} → ${link.carriedMark}. ` +
        "Open Hanger Selector → Truss (Flush Bottom), paste apiBody values, " +
        "then choose the recommended model from results.",
      simpsonHsUrl: "https://app.strongtie.com/hs",
    };

    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(record, null, 2));

    connections.push({
      connectionId: id,
      carryingMark: link.carryingMark,
      carriedMark: link.carriedMark,
      position: link.position,
      download: link.download,
      uplift: link.uplift,
      skewAngle: link.skewAngle,
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
