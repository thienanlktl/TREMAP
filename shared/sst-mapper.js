/**
 * SST Hanger Selector — payload contract + mapper.
 *
 * Faithful port of the reference implementation:
 *   github.com/phuongphamsp/truss-analyzer @ DataBridge-Poc1
 *   (src/lib/sst-types.ts, src/lib/sst-mapper.ts)
 *
 * This module mirrors the reference `buildSSTPayload()` exactly so the values we
 * submit to the Simpson Hanger Selector match what the reference (validated
 * against the live API) submits for a Truss (Flush Bottom) connection. Keep this
 * module the single source of truth for the API contract so the connection maps
 * and parameter maps stay in lockstep with it.
 *
 * Key mapping decisions (from reference sst-mapper.ts):
 * - Both carrying (girder) and carried (truss) use material = 5 (Truss).
 * - Girder bottom-chord dimensions -> carrying member width/depth.
 * - King post (vertical web at the connection X) -> carrying kingWidth/kingHeight;
 *   otherwise kingWidth = 0, kingHeight = max(girder heel, girder depth).
 * - Carried truss heel height at the BEARING side -> carried member depth.
 * - Carried truss bottom-chord width -> carried member width.
 * - downReaction/upliftReaction -> loads (rounded ASD magnitudes).
 * - skewAngle/skewType derived from the hanger angle (LG*T field[14]).
 * - slopeAngle/slopeType = 0 (flush-bottom seat is level).
 * - download/uplift duration types derived from the governing load case DOL factor.
 */

// --- API endpoint (browser calls this via the /api/sst proxy to avoid CORS) ---
export const SST_API_URL = "https://api.strongtie.com/gws/hanger-selector/hangers";

// --- Material types (member TYPE, not wood species) ---
export const MATERIAL_SOLID_SAWN = 1;
export const MATERIAL_GLULAM = 2;
export const MATERIAL_LSL = 3;
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
export const DL_DURATION_DEAD = 90; // CD 0.9
export const DL_DURATION_FLOOR = 100; // CD 1.0
export const DL_DURATION_SNOW = 115; // CD 1.15
export const DL_DURATION_ROOF = 125; // CD 1.25
export const DL_DURATION_WIND_QUAKE = 160; // CD 1.6

export const UL_DURATION_NORMAL = 100; // CD 1.0
export const UL_DURATION_WIND_QUAKE = 160; // CD 1.6

// --- Flush option ---
export const FLUSH_TOP = "TOP"; // Joist
export const FLUSH_BOTTOM = "BOTTOM"; // Truss

// --- Skew / slope types ---
export const SKEW_TYPE_NONE = 0;
export const SKEW_TYPE_LEFT = 1;
export const SKEW_TYPE_RIGHT = 2;

export const SLOPE_TYPE_NONE = 0;
export const SLOPE_TYPE_UP = 1;
export const SLOPE_TYPE_DOWN = 2;

// ---------------------------------------------------------------------------
// Helpers (ported from reference sst-mapper.ts)
// ---------------------------------------------------------------------------

/**
 * Map TRE load-case DOL factor -> SST download duration type constant.
 *
 * TRE DOL factors: 0.90 Dead, 1.00 Floor, 1.15 Snow/Roof Live, 1.25 Roof Live,
 * 1.60 Wind/Seismic. Defaults to Roof (125) when the factor is unknown.
 */
export function dolFactorToDownloadDuration(dolFactor) {
  if (dolFactor == null || Number.isNaN(dolFactor)) return DL_DURATION_ROOF;
  const f = Math.round(dolFactor * 100); // e.g. 1.15 -> 115, 1.60 -> 160
  if (f <= 90) return DL_DURATION_DEAD;
  if (f <= 100) return DL_DURATION_FLOOR;
  if (f <= 115) return DL_DURATION_SNOW;
  if (f <= 125) return DL_DURATION_ROOF;
  return DL_DURATION_WIND_QUAKE;
}

/** Map TRE load-case DOL factor -> SST uplift duration type. Defaults to wind (160). */
export function dolFactorToUpliftDuration(dolFactor) {
  if (dolFactor == null || Number.isNaN(dolFactor)) return UL_DURATION_WIND_QUAKE;
  const f = Math.round(dolFactor * 100);
  if (f <= 100) return UL_DURATION_NORMAL;
  return UL_DURATION_WIND_QUAKE;
}

/**
 * Find the bottom-chord member with the largest cross-section from a member list.
 * Returns actual lumber dimensions (inches), e.g. { width: 1.5, depth: 3.5 }.
 */
export function findBottomChord(members) {
  if (!members || members.length === 0) return null;
  const bcs = members.filter(
    (m) => m.role === "bc" && m.width > 0 && m.depth > 0,
  );
  if (bcs.length === 0) return null;
  return bcs.reduce((a, b) => (a.width * a.depth >= b.width * b.depth ? a : b));
}

/**
 * Detect whether a vertical web (king post) exists at the connection point of a
 * carried truss on the girder.
 *
 * For each structural Web member, scan consecutive coordinate pairs for a segment
 * that is nearly vertical (|x1 - x2| < TOLERANCE) AND whose x is within TOLERANCE
 * of connectionX. If found, kingWidth = the web's lumber depth (face width toward
 * the hanger) and kingHeight = the segment's vertical extent.
 */
export function findKingPost(members, connectionX) {
  const TOLERANCE = 2.0; // inches
  const fallback = { hasKingPost: false, kingWidth: 0, kingHeight: 0 };
  if (!members || members.length === 0) return fallback;

  const webs = members.filter((m) => m.role === "web" && m.isStructural);
  for (const web of webs) {
    const coords = web.points;
    if (!coords || coords.length < 2) continue;
    for (let i = 0; i < coords.length - 1; i += 1) {
      const { x: x1, y: y1 } = coords[i];
      const { x: x2, y: y2 } = coords[i + 1];
      const isVertical = Math.abs(x1 - x2) < TOLERANCE;
      const atConnection = Math.abs(x1 - connectionX) < TOLERANCE;
      const hasHeight = Math.abs(y2 - y1) > 0.5;
      if (isVertical && atConnection && hasHeight) {
        return {
          hasKingPost: true,
          kingWidth: web.depth,
          kingHeight: Math.abs(y2 - y1),
        };
      }
    }
  }
  return fallback;
}

/**
 * Derive Simpson skew from the hanger angle (LG*T field[14], carried truss angle
 * relative to girder). 90/270 = perpendicular -> no skew. Otherwise fold to
 * [0, 180) and measure the deviation from square; angle < 90 = LEFT, else RIGHT.
 */
export function deriveSkew(hangerAngle) {
  const angle = Number.isFinite(hangerAngle) ? hangerAngle : 90;
  const normalised = ((angle % 180) + 180) % 180; // fold 270->90, 315->135, etc.
  const skewAngle = Math.round(Math.abs(normalised - 90));
  const skewType =
    skewAngle === 0
      ? SKEW_TYPE_NONE
      : normalised < 90
        ? SKEW_TYPE_LEFT
        : SKEW_TYPE_RIGHT;
  return { skewAngle, skewType };
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

/**
 * Carrying member (the girder). Dimensions come from the girder's bottom chord;
 * king post is detected at `connectionX` (the hanger's position along the girder).
 *
 * @param {object}  opts
 * @param {Array}   opts.members     Girder MEMBER INFO members (with role/width/depth/points/isStructural).
 * @param {number}  opts.connectionX Hanger position along the girder (inches) for king-post detection.
 * @param {number}  opts.leftHeel    Girder left heel height (fallback king height).
 * @param {number}  opts.ply         Girder ply.
 */
export function sstCarryingMember({ members, connectionX, leftHeel, ply }) {
  const bc = findBottomChord(members);
  const width = bc?.width ?? 1.5;
  const depth = bc?.depth ?? 5.5;

  const kingPost = findKingPost(members ?? [], connectionX ?? 0);
  const girderHeel = leftHeel ?? 0;
  const kingHeight = kingPost.hasKingPost
    ? kingPost.kingHeight
    : Math.max(girderHeel, depth);

  return {
    material: MATERIAL_TRUSS,
    width,
    depth,
    ply: ply ?? 1,
    topChord: 0,
    topChordPly: 0,
    kingWidth: kingPost.hasKingPost ? kingPost.kingWidth : 0,
    kingHeight,
  };
}

/**
 * Carried member (the hung truss/jack). Width = carried bottom-chord width, depth
 * = heel height at the bearing side, skew derived from the hanger angle, slope = 0.
 *
 * @param {object}  opts
 * @param {Array}   opts.members     Carried truss MEMBER INFO members.
 * @param {number}  opts.heel        Heel height at the bearing side (inches).
 * @param {number}  opts.ply         Carried truss ply.
 * @param {number}  opts.load        Download reaction (lb, rounded/abs'd here).
 * @param {number}  opts.uplift      Uplift reaction (lb, rounded/abs'd here).
 * @param {number}  opts.hangerAngle Hanger angle (LG*T field[14]) for skew.
 * @param {string}  opts.memberId    UI-only label (stripped before POST).
 */
export function sstCarriedMember({
  members,
  heel,
  ply,
  load,
  uplift,
  hangerAngle,
  memberId,
}) {
  const bc = findBottomChord(members);
  const width = bc?.width ?? 1.5;
  const depth = heel > 0 ? heel : 3.5;
  const { skewAngle, skewType } = deriveSkew(hangerAngle);

  const member = {
    material: MATERIAL_TRUSS,
    width,
    depth,
    ply: ply ?? 1,
    loads: {
      load: Math.round(Math.abs(load ?? 0)),
      uplift: Math.round(Math.abs(uplift ?? 0)),
    },
    angle: {
      skewAngle,
      skewType,
      slopeAngle: 0,
      slopeType: SLOPE_TYPE_NONE,
    },
  };
  if (memberId != null) member.memberId = memberId; // UI-only; stripped before POST
  return member;
}

/**
 * Full Truss (Flush Bottom) payload. `carried` is an array of member objects
 * (one for a single truss-to-truss link; up to three seats for a multi girder).
 * Download/uplift durations follow the governing load case DOL factors.
 */
export function sstTrussHangerBody({
  carrying,
  carried,
  downDolFactor,
  upliftDolFactor,
}) {
  return {
    style: STYLE_ALL,
    buildingCode: BUILDING_CODE_IRC2018,
    concealed: 0,
    fastenerType: FASTENER_ALL,
    sort: 0,
    ledger: 0,
    designInformations: {
      downloadDurationType: dolFactorToDownloadDuration(downDolFactor),
      upliftLoadDurationType: dolFactorToUpliftDuration(upliftDolFactor),
    },
    filters: { depth: 0, model: "", series: "", webStiffeners: 0, width: 0 },
    carriedMembers: Array.isArray(carried) ? carried : [carried],
    flushOption: FLUSH_BOTTOM,
    carryingMember: carrying,
    ansitpi: ANSITPI_INTERIOR,
  };
}
