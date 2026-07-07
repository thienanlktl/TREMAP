/**
 * SST Hanger Selector — payload contract + mapper.
 *
 * Ported from the reference implementation:
 *   github.com/phuongphamsp/truss-analyzer @ DataBridge-Poc1
 *   (src/lib/sst-types.ts, src/lib/sst-mapper.ts)
 *
 * These are the exact field values that reference (validated against the live
 * Simpson Hanger Selector) submits for a Truss (Flush Bottom) connection. Keep
 * this module the single source of truth for the API contract so the connection
 * maps and parameter maps stay in lockstep with it.
 */

// --- API endpoint (browser calls this via the /api/sst proxy to avoid CORS) ---
export const SST_API_URL = "https://api.strongtie.com/gws/hanger-selector/hangers";

// --- Material types (member TYPE, not wood species) ---
export const MATERIAL_SOLID_SAWN = 1;
export const MATERIAL_LVL = 4;
export const MATERIAL_TRUSS = 5;
export const MATERIAL_I_JOIST = 6;
export const MATERIAL_FLOOR_TRUSS = 7;

// --- ANSI/TPI connection type (root-level) ---
export const ANSITPI_OFF = 0;
export const ANSITPI_END = 3;
export const ANSITPI_INTERIOR = 6;

// --- Hanger style / fastener / building code ---
export const STYLE_ALL = 0;
export const FASTENER_ALL = 0;
export const BUILDING_CODE_IRC2018 = 20;

// --- Load duration types (CD factor x100) ---
export const DL_DURATION_FLOOR = 100; // CD 1.0
export const DL_DURATION_ROOF = 125; // CD 1.25
export const UL_DURATION_WIND_QUAKE = 160; // CD 1.6

// --- Flush option ---
export const FLUSH_TOP = "TOP"; // Joist
export const FLUSH_BOTTOM = "BOTTOM"; // Truss

// --- Skew / slope types ---
export const SKEW_TYPE_NONE = 0;
export const SLOPE_TYPE_NONE = 0;

/**
 * Carried member (the hung truss/jack). skew + slope are 0: the bearing seat is
 * level and its plan orientation is not available from the TRE/IFC data, exactly
 * as the reference documents. loads are rounded ASD magnitudes.
 */
export function sstCarriedMember({ width, depth, ply, load, uplift, memberId }) {
  const member = {
    material: MATERIAL_TRUSS,
    width: width ?? 1.5,
    depth: depth > 0 ? depth : 3.5,
    ply: ply ?? 1,
    loads: {
      load: Math.round(Math.abs(load ?? 0)),
      uplift: Math.round(Math.abs(uplift ?? 0)),
    },
    angle: {
      skewAngle: 0,
      skewType: SKEW_TYPE_NONE,
      slopeAngle: 0,
      slopeType: SLOPE_TYPE_NONE,
    },
  };
  if (memberId != null) member.memberId = memberId; // UI-only; stripped before POST
  return member;
}

/**
 * Carrying member (the girder). kingHeight = max(heel, depth, 24") per reference.
 */
export function sstCarryingMember({ width, depth, ply, heel }) {
  return {
    material: MATERIAL_TRUSS,
    width: width ?? 1.5,
    depth: depth ?? 5.5,
    ply: ply ?? 1,
    topChord: 0,
    topChordPly: 0,
    kingWidth: 0,
    kingHeight: Math.max(heel ?? 0, depth ?? 0, 24.0),
  };
}

/**
 * Full Truss (Flush Bottom) payload. `carried` is an array of member objects
 * (one for a single truss-to-truss link; up to three seats for a multi girder).
 */
export function sstTrussHangerBody({ carrying, carried }) {
  return {
    style: STYLE_ALL,
    buildingCode: BUILDING_CODE_IRC2018,
    concealed: 0,
    fastenerType: FASTENER_ALL,
    sort: 0,
    ledger: 0,
    designInformations: {
      downloadDurationType: DL_DURATION_ROOF,
      upliftLoadDurationType: UL_DURATION_WIND_QUAKE,
    },
    filters: { depth: 0, model: "", series: "", webStiffeners: 0, width: 0 },
    carriedMembers: Array.isArray(carried) ? carried : [carried],
    flushOption: FLUSH_BOTTOM,
    carryingMember: carrying,
    ansitpi: ANSITPI_INTERIOR,
  };
}
