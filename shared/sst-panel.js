import {
  clearSSTToken,
  getSSTToken,
  hasSSTToken,
  setSSTToken,
  submitBatchToSST,
  submitToSST,
} from "./sst-api.js";
import { prepareSSTPayload } from "./sst-payload.js";

const AUTO_QUERY_KEY = "sst_auto_query";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getAutoQueryEnabled() {
  try {
    return localStorage.getItem(AUTO_QUERY_KEY) !== "false";
  } catch {
    return true;
  }
}

function setAutoQueryEnabled(enabled) {
  try {
    localStorage.setItem(AUTO_QUERY_KEY, enabled ? "true" : "false");
  } catch {
    // ignore
  }
}

function renderResults(root, result, error) {
  const statusEl = root.querySelector("[data-sst-status]");
  const bodyEl = root.querySelector("[data-sst-results]");

  if (statusEl) {
    if (error) {
      statusEl.innerHTML = `<span class="sst-error">${escapeHtml(error)}</span>`;
    } else if (result?.success) {
      statusEl.textContent = `${result.hangers.length} hanger${result.hangers.length === 1 ? "" : "s"} found`;
    } else {
      statusEl.textContent = "";
    }
  }

  if (!bodyEl) {
    return;
  }

  if (!result?.success || result.hangers.length === 0) {
    bodyEl.innerHTML = result?.success
      ? '<p class="muted">No hangers matched this input.</p>'
      : "";
    return;
  }

  bodyEl.innerHTML = `
    <div class="table-wrap">
      <table class="data-table sst-results-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Download (lb)</th>
            <th>Uplift (lb)</th>
            <th>Width (in)</th>
            <th>Height (in)</th>
            <th>Bearing (in)</th>
            <th>Series</th>
          </tr>
        </thead>
        <tbody>
          ${result.hangers
            .map(
              (hanger) => `
            <tr>
              <td><strong>${escapeHtml(hanger.model)}</strong></td>
              <td>${escapeHtml(hanger.downloadLoad)}</td>
              <td>${escapeHtml(hanger.upliftLoad)}</td>
              <td>${escapeHtml(hanger.width)}</td>
              <td>${escapeHtml(hanger.height)}</td>
              <td>${escapeHtml(hanger.bearing)}</td>
              <td>${escapeHtml(hanger.series)}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderBatchResults(root, batchResults, progressText) {
  const statusEl = root.querySelector("[data-sst-status]");
  const bodyEl = root.querySelector("[data-sst-results]");

  const ok = batchResults.filter((entry) => entry.response.success);
  const failed = batchResults.filter((entry) => !entry.response.success);

  if (statusEl) {
    statusEl.textContent =
      progressText ??
      `Batch complete — ${ok.length} ok, ${failed.length} failed (${batchResults.length} total)`;
  }

  if (!bodyEl) {
    return;
  }

  bodyEl.innerHTML = `
    <div class="table-wrap">
      <table class="data-table sst-batch-table">
        <thead>
          <tr>
            <th>Connection</th>
            <th>Status</th>
            <th>Top model</th>
            <th>Matches</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          ${batchResults
            .map((entry) => {
              const top = entry.response.hangers?.[0];
              const status = entry.response.success ? "OK" : "Error";
              const statusClass = entry.response.success ? "sst-batch-ok" : "sst-batch-err";
              return `
            <tr>
              <td><strong>${escapeHtml(entry.label)}</strong></td>
              <td class="${statusClass}">${status}</td>
              <td>${escapeHtml(top?.model ?? "—")}</td>
              <td>${entry.response.success ? entry.response.hangers.length : "—"}</td>
              <td class="muted">${escapeHtml(entry.response.error ?? "")}</td>
            </tr>
          `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Mount SST token + query UI into a container element.
 *
 * @param {HTMLElement} container
 * @param {{
 *   getPayload: () => Record<string, unknown> | null | undefined,
 *   getLabel?: () => string,
 *   autoQuery?: boolean,
 *   getBatchItems?: () => Promise<Array<{ label: string, payload: Record<string, unknown> }>>,
 *   batchLabel?: string,
 * }} options
 */
export function mountSSTPanel(container, options) {
  const {
    getPayload,
    getLabel,
    autoQuery = true,
    getBatchItems,
    batchLabel = "Query all",
  } = options;

  let autoQueryEnabled = autoQuery && getAutoQueryEnabled();
  let queryGeneration = 0;
  let onTokenSaved = null;

  container.innerHTML = `
    <section class="panel sst-panel">
      <div class="panel-header">
        <h2>SST Hanger Selector — Live API</h2>
        <div class="sst-actions">
          <label class="sst-auto-label">
            <input type="checkbox" data-sst-auto ${autoQueryEnabled ? "checked" : ""} />
            Auto-query on change
          </label>
          ${getBatchItems ? `<button type="button" class="btn secondary" data-sst-batch>${escapeHtml(batchLabel)}</button>` : ""}
          <button type="button" class="btn accent" data-sst-query>Query SST</button>
        </div>
      </div>
      <div data-sst-token></div>
      <p class="sst-query-label muted" data-sst-query-label></p>
      <p data-sst-status class="sst-status"></p>
      <div data-sst-results></div>
    </section>
  `;

  const queryBtn = container.querySelector("[data-sst-query]");
  const batchBtn = container.querySelector("[data-sst-batch]");
  const autoCheckbox = container.querySelector("[data-sst-auto]");
  const labelEl = container.querySelector("[data-sst-query-label]");

  const renderTokenSection = () => {
    const tokenRoot = container.querySelector("[data-sst-token]");
    if (!tokenRoot) {
      return;
    }

    let editing = !hasSSTToken();

    const render = () => {
      const saved = hasSSTToken();
      if (saved && !editing) {
        tokenRoot.innerHTML = `
          <div class="sst-token-row">
            <span class="sst-token-status sst-token-ok">SST token connected</span>
            <button type="button" class="btn secondary sst-token-edit" data-action="edit">Edit</button>
            <button type="button" class="btn secondary sst-token-clear" data-action="clear">Clear</button>
          </div>
          <p class="sst-token-hint muted">
            Token expires after ~1 hour. Copy a fresh Bearer token from
            <a href="https://app.strongtie.com/hs" target="_blank" rel="noopener">app.strongtie.com/hs</a>
            → DevTools → Network → any XHR → Authorization header.
          </p>
        `;
        tokenRoot.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
          editing = true;
          render();
        });
        tokenRoot.querySelector('[data-action="clear"]')?.addEventListener("click", () => {
          clearSSTToken();
          editing = true;
          render();
        });
        return;
      }

      tokenRoot.innerHTML = `
        <label class="sst-token-label">
          <span>SST Bearer token</span>
          <input
            type="password"
            class="search-input sst-token-input"
            placeholder="Paste token from app.strongtie.com/hs DevTools…"
            value="${escapeHtml(getSSTToken() ?? "")}"
          />
        </label>
        <div class="sst-token-row">
          <button type="button" class="btn accent" data-action="save">Save token</button>
          ${
            saved
              ? '<button type="button" class="btn secondary" data-action="cancel">Cancel</button>'
              : ""
          }
        </div>
        <p class="sst-token-hint muted">
          Same flow as truss-analyzer: open Simpson Hanger Selector, sign in, then copy the Bearer value
          (without the "Bearer " prefix is fine).
        </p>
      `;

      const input = tokenRoot.querySelector(".sst-token-input");
      tokenRoot.querySelector('[data-action="save"]')?.addEventListener("click", () => {
        const value = input?.value.trim();
        if (!value) {
          return;
        }
        setSSTToken(value);
        editing = false;
        render();
        onTokenSaved?.();
      });
      tokenRoot.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
        editing = false;
        render();
      });
      input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          tokenRoot.querySelector('[data-action="save"]')?.click();
        }
      });
    };

    render();
  };

  renderTokenSection();
  onTokenSaved = () => {
    if (autoQueryEnabled) {
      runQuery();
    }
  };

  autoCheckbox?.addEventListener("change", () => {
    autoQueryEnabled = autoCheckbox.checked;
    setAutoQueryEnabled(autoQueryEnabled);
    if (autoQueryEnabled) {
      runQuery();
    }
  });

  const runQuery = async () => {
    const generation = ++queryGeneration;
    const raw = getPayload();
    const payload = prepareSSTPayload(raw);
    const label = getLabel?.() ?? "connection";

    if (labelEl) {
      labelEl.textContent = payload
        ? `Querying: ${label}`
        : "No API body available for this selection.";
    }

    if (!payload) {
      renderResults(container, null, "No API body to send. Build parameter maps first (npm run build-data).");
      return;
    }

    if (!hasSSTToken()) {
      renderResults(container, null, "No SST token set. Paste and save your Bearer token above.");
      return;
    }

    queryBtn.disabled = true;
    if (batchBtn) {
      batchBtn.disabled = true;
    }
    queryBtn.textContent = "Searching…";
    renderResults(container, null, null);

    console.log("[SST] Payload for", label, payload);
    const result = await submitToSST(payload);
    console.log("[SST] Response:", result);

    if (generation !== queryGeneration) {
      return;
    }

    queryBtn.disabled = false;
    if (batchBtn) {
      batchBtn.disabled = false;
    }
    queryBtn.textContent = "Query SST";
    renderResults(container, result, result.success ? null : result.error);
  };

  const runBatch = async () => {
    if (!getBatchItems) {
      return;
    }

    if (!hasSSTToken()) {
      renderResults(container, null, "No SST token set. Paste and save your Bearer token above.");
      return;
    }

    const generation = ++queryGeneration;
    queryBtn.disabled = true;
    batchBtn.disabled = true;
    batchBtn.textContent = "Loading…";

    let items;
    try {
      items = await getBatchItems();
    } catch (error) {
      renderResults(
        container,
        null,
        error instanceof Error ? error.message : "Failed to load batch items.",
      );
      queryBtn.disabled = false;
      batchBtn.disabled = false;
      batchBtn.textContent = batchLabel;
      return;
    }

    if (!items.length) {
      renderResults(container, null, "No connections with API bodies found for batch query.");
      queryBtn.disabled = false;
      batchBtn.disabled = false;
      batchBtn.textContent = batchLabel;
      return;
    }

    if (labelEl) {
      labelEl.textContent = `Batch query: ${items.length} connections`;
    }

    const batchResults = await submitBatchToSST(items, 1000, (completed, total) => {
      if (generation !== queryGeneration) {
        return;
      }
      const statusEl = container.querySelector("[data-sst-status]");
      if (statusEl) {
        statusEl.textContent = `Batch progress: ${completed} / ${total}`;
      }
    });

    if (generation !== queryGeneration) {
      return;
    }

    queryBtn.disabled = false;
    batchBtn.disabled = false;
    batchBtn.textContent = batchLabel;
    renderBatchResults(container, batchResults);
  };

  queryBtn?.addEventListener("click", runQuery);
  batchBtn?.addEventListener("click", runBatch);

  const notifySelectionChanged = () => {
    if (autoQueryEnabled) {
      runQuery();
    } else if (labelEl) {
      const label = getLabel?.() ?? "";
      labelEl.textContent = label ? `Selected: ${label} (auto-query off)` : "";
    }
  };

  return { runQuery, runBatch, notifySelectionChanged };
}
