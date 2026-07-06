/**
 * Strip viewer-only metadata before POSTing to the SST hanger-selector API.
 */

const PAYLOAD_META_KEYS = new Set([
  "simpsonHsUrl",
  "connectionLabel",
  "hangerOptions",
  "memberId",
]);

/**
 * @param {Record<string, unknown> | null | undefined} raw
 * @returns {Record<string, unknown> | null}
 */
export function prepareSSTPayload(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const payload = structuredClone(raw);

  for (const key of PAYLOAD_META_KEYS) {
    delete payload[key];
  }

  if (Array.isArray(payload.carriedMembers)) {
    payload.carriedMembers = payload.carriedMembers.map((member) => {
      const cleaned = { ...member };
      delete cleaned.memberId;
      return cleaned;
    });
  }

  return payload;
}
