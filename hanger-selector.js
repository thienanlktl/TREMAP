import { mountNav } from "./shared/nav.js";
import { parseCsv } from "./shared/parse-csv.js";

mountNav("hanger");

const response = await fetch("/data/hanger-selector-reference.json");
if (!response.ok) {
  document.body.innerHTML = "<p class='error'>Hanger reference data missing.</p>";
  throw new Error("hanger-selector-reference.json not found");
}

const data = await response.json();
let activeTypeId = data.connectionTypes[0].id;

const introText = document.getElementById("hs-intro-text");
const metaEl = document.getElementById("hs-meta");
const typeTabs = document.getElementById("type-tabs");
const typeDetail = document.getElementById("type-detail");
const nullRules = document.getElementById("null-rules");
const exampleJson = document.getElementById("example-json");
const paramSections = document.getElementById("param-sections");
const paramSearch = document.getElementById("param-search");
const enumSelect = document.getElementById("enum-select");
const enumBody = document.getElementById("enum-body");

introText.textContent =
  "Local reference collected from Simpson Strong-Tie Hanger Selector UI and API docs. Use this to map truss reactions and member sizes before opening the live selector.";

metaEl.innerHTML = `
  <a href="${data.meta.appUrl}" target="_blank" rel="noopener">Hanger Selector app</a>
  · API: <code>${data.meta.apiEndpoint}</code>
  · Stored: <code>/data/hanger-selector-reference.json</code>
`;

renderTypeTabs();
renderActiveType();
renderParamSections();
renderEnumSelect(data.enums);
loadTreParameterMaps();

paramSearch?.addEventListener("input", renderParamSections);
enumSelect?.addEventListener("change", () => renderEnumTable(enumSelect.value));

document.getElementById("btn-copy-json")?.addEventListener("click", async () => {
  await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  const btn = document.getElementById("btn-copy-json");
  const original = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => {
    btn.textContent = original;
  }, 1500);
});

function renderTypeTabs() {
  typeTabs.replaceChildren(
    ...data.connectionTypes.map((type) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `hs-tab${type.id === activeTypeId ? " active" : ""}`;
      btn.textContent = type.uiLabel;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(type.id === activeTypeId));
      btn.addEventListener("click", () => {
        activeTypeId = type.id;
        renderTypeTabs();
        renderActiveType();
        renderParamSections();
      });
      return btn;
    }),
  );
}

function renderActiveType() {
  const type = data.connectionTypes.find((entry) => entry.id === activeTypeId);
  if (!type) {
    return;
  }

  typeDetail.innerHTML = `
    <h2>${type.uiLabel}</h2>
    <p class="hs-desc">${type.description}</p>
    <dl class="hs-kv">
      <dt>API flushOption</dt><dd><code>${type.flushOption}</code></dd>
      <dt>Carried members</dt><dd>${type.carriedMemberCount.label}</dd>
      <dt>Hanger options</dt><dd>${type.hangerOptions === "required" ? "Top flange options required" : "null (not used)"}</dd>
      <dt>Layout</dt><dd>${type.diagram}</dd>
    </dl>
  `;

  if (type.nullSlotRules) {
    nullRules.innerHTML = type.nullSlotRules
      .map(
        (rule) => `
      <div class="hs-rule">
        <strong>${rule.configuration}</strong>
        <span><code>${rule.note}</code></span>
      </div>`,
      )
      .join("");
  } else {
    nullRules.innerHTML = `<p class="muted">Only applies to Multi-Truss. Select that tab to see slot rules.</p>`;
  }

  const example = data.exampleRequests[type.id];
  exampleJson.textContent = JSON.stringify(example ?? {}, null, 2);
}

function sectionApplies(section, typeId) {
  return section.appliesTo.includes(typeId);
}

function fieldApplies(field, typeId) {
  if (!field.appliesTo) {
    return true;
  }
  return field.appliesTo.includes(typeId);
}

function renderParamSections() {
  const query = paramSearch?.value.trim().toLowerCase() ?? "";
  const sections = data.uiSections.filter((section) => sectionApplies(section, activeTypeId));

  paramSections.replaceChildren(
    ...sections.map((section) => {
      const fields = section.fields.filter((field) => {
        if (!fieldApplies(field, activeTypeId)) {
          return false;
        }
        if (!query) {
          return true;
        }
        const haystack = [
          field.uiLabel,
          field.apiField,
          field.uiHint,
          field.type,
          field.unit,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });

      const article = document.createElement("article");
      article.className = "hs-section";
      article.innerHTML = `
        <header class="hs-section-head">
          <h3>${section.uiLabel}</h3>
          ${section.apiField ? `<code>${section.apiField}</code>` : ""}
        </header>
      `;

      if (!fields.length) {
        article.insertAdjacentHTML("beforeend", `<p class="muted">No matching fields.</p>`);
        return article;
      }

      const table = document.createElement("table");
      table.className = "data-table hs-field-table";
      table.innerHTML = `
        <thead>
          <tr>
            <th>UI label</th>
            <th>API field</th>
            <th>Type</th>
            <th>Notes</th>
          </tr>
        </thead>
      `;
      const tbody = document.createElement("tbody");
      tbody.replaceChildren(
        ...fields.map((field) => {
          const row = document.createElement("tr");
          const notes = [field.uiHint, field.unit ? `Unit: ${field.unit}` : null]
            .filter(Boolean)
            .join(" · ");
          row.innerHTML = `
            <td><strong>${field.uiLabel}</strong></td>
            <td>${field.apiField ? `<code>${field.apiField}</code>` : "<span class='muted'>UI only</span>"}</td>
            <td>${field.type}${field.enumKey ? ` → ${field.enumKey}` : ""}</td>
            <td class="muted">${notes || "—"}</td>
          `;
          return row;
        }),
      );
      table.append(tbody);
      article.append(table);
      return article;
    }),
  );
}

function renderEnumSelect(enums) {
  enumSelect.replaceChildren(
    ...Object.keys(enums).map((key) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = key;
      return option;
    }),
  );
  renderEnumTable(enumSelect.value);
}

function renderEnumTable(key) {
  const rows = data.enums[key] ?? [];
  enumBody.replaceChildren(
    ...rows.map((entry) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td><code>${entry.value}</code></td><td>${entry.label}</td>`;
      return row;
    }),
  );
}

const treMapSelect = document.getElementById("tre-map-select");
const treMapSummary = document.getElementById("tre-map-summary");
const treMapBody = document.getElementById("tre-map-body");
const treMapApi = document.getElementById("tre-map-api");
let treMapIndex = null;
const treMapCache = new Map();

async function loadTreParameterMaps() {
  if (!treMapSelect) {
    return;
  }

  const indexResponse = await fetch("/data/parameter-maps/index.json");
  if (!indexResponse.ok) {
    treMapSummary.textContent =
      "Run npm run build-data to generate parameter maps from MiTek TRE files.";
    return;
  }

  treMapIndex = await indexResponse.json();
  treMapSelect.replaceChildren(
    ...treMapIndex.marks.map((mark) => {
      const option = document.createElement("option");
      option.value = mark;
      option.textContent = `${mark} (${treMapIndex.maps[mark].connectionType.replace(/_/g, " ")})`;
      return option;
    }),
  );

  treMapSelect.addEventListener("change", () => renderTreParameterMap(treMapSelect.value));
  await renderTreParameterMap(treMapSelect.value);
}

async function renderTreParameterMap(mark) {
  if (!mark || !treMapBody) {
    return;
  }

  let mapJson = treMapCache.get(mark);
  if (!mapJson) {
    const response = await fetch(`/data/parameter-maps/${mark}.json`);
    if (!response.ok) {
      treMapSummary.textContent = `Missing parameter map for ${mark}.`;
      return;
    }
    mapJson = await response.json();
    treMapCache.set(mark, mapJson);
  }

  const meta = treMapIndex.maps[mark];
  treMapSummary.textContent = `${mark} · ${mapJson.trussType} · ${mapJson.role} member · ${mapJson.connectionLabel} · span ${mapJson.spanDisplay ?? "—"} · pitch ${mapJson.pitch ?? "—"}`;

  const csvResponse = await fetch(`/data/parameter-maps/${mark}.csv`);
  const csvText = csvResponse.ok ? await csvResponse.text() : "";
  const rows = parseCsv(csvText).slice(1);

  treMapBody.replaceChildren(
    ...rows.map((parts) => {
      const hasValue = [parts[1], parts[2], parts[3]].some((cell) => String(cell ?? "").trim());
      const row = document.createElement("tr");
      if (hasValue) row.className = "pm-filled-row";
      row.innerHTML = `
        <td>${parts[0] ?? ""}</td>
        <td>${parts[1]?.trim().toLowerCase() === "yes" ? `<span class="pm-yes">${parts[1]}</span>` : (parts[1] ? `<strong>${parts[1]}</strong>` : "")}</td>
        <td>${parts[2]?.trim().toLowerCase() === "yes" ? `<span class="pm-yes">${parts[2]}</span>` : (parts[2] ? `<strong>${parts[2]}</strong>` : "")}</td>
        <td>${parts[3]?.trim().toLowerCase() === "yes" ? `<span class="pm-yes">${parts[3]}</span>` : (parts[3] ? `<strong>${parts[3]}</strong>` : "")}</td>
      `;
      return row;
    }),
  );

  treMapApi.textContent = JSON.stringify(mapJson.apiBody, null, 2);
}
