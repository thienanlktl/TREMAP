/**
 * SST Hanger Selector — API client (ported from truss-analyzer DataBridge-Poc1).
 *
 * POST https://api.strongtie.com/gws/hanger-selector/hangers
 * Dev/prod servers proxy this at /api/sst/hangers to avoid CORS.
 */

export const SST_API_URL = "/api/sst/hangers";

const TOKEN_KEY = "sst_bearer_token";

export function getSSTToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSSTToken(token) {
  const clean = token.replace(/^Bearer\s+/i, "").trim();
  localStorage.setItem(TOKEN_KEY, clean);
}

export function clearSSTToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function hasSSTToken() {
  const token = getSSTToken();
  return token != null && token.length > 0;
}

function parseResponse(data) {
  const status = data.status ?? {};
  if (status.error) {
    return {
      success: false,
      hangers: [],
      error: status.text || "SST API returned an error",
      raw: data,
    };
  }

  const rawList = data.lstHangerOutput ?? [];
  const hangers = rawList.map((h) => ({
    model: h.model || h.modelSpec || "—",
    downloadLoad: h.load ?? 0,
    upliftLoad: h.uplift ?? 0,
    width: h.wSize ?? 0,
    height: h.hSize ?? 0,
    bearing: h.bSize ?? 0,
    cost: h.msrp ?? 0,
    series: h.catalog || "",
    sku: h.modelID || "",
  }));

  return { success: true, hangers, raw: data };
}

/**
 * Submit a hanger-selector payload and return parsed results.
 * @param {Record<string, unknown>} payload
 */
export async function submitToSST(payload) {
  const token = getSSTToken();
  if (!token) {
    return {
      success: false,
      hangers: [],
      error:
        'No SST token set. Open app.strongtie.com/hs, then copy the Bearer token from DevTools (Network → any XHR → Authorization header).',
    };
  }

  try {
    const resp = await fetch(SST_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 401) {
      return {
        success: false,
        hangers: [],
        error:
          "401 Unauthorized — SST token expired (~1 hour). Get a fresh Bearer token from app.strongtie.com/hs DevTools.",
      };
    }
    if (resp.status === 403) {
      return {
        success: false,
        hangers: [],
        error: "403 Forbidden — token does not have access.",
      };
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        success: false,
        hangers: [],
        error: `HTTP ${resp.status}: ${text.slice(0, 300)}`,
      };
    }

    const data = await resp.json();
    return parseResponse(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown network error";
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      return {
        success: false,
        hangers: [],
        error:
          "Network error (likely CORS or proxy). Restart the dev server so /api/sst/hangers proxy is active.",
      };
    }
    return { success: false, hangers: [], error: msg };
  }
}

/**
 * Submit multiple payloads sequentially with a delay between calls.
 * @param {Array<{ label: string, payload: Record<string, unknown> }>} items
 * @param {number} delayMs
 * @param {(completed: number, total: number) => void} [onProgress]
 */
export async function submitBatchToSST(items, delayMs = 1000, onProgress) {
  const results = [];

  for (let i = 0; i < items.length; i++) {
    const { label, payload } = items[i];
    const response = await submitToSST(payload);
    results.push({ label, response });

    onProgress?.(i + 1, items.length);

    if (i < items.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
