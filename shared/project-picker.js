/**
 * Toolbar control for choosing the data source: the bundled sample (default) or
 * the user's own IFC + TRE files. Mounted on every page by nav.js so switching
 * is available everywhere. Files persist in IndexedDB (project-store); switching
 * reloads the page so all views pick up the new source.
 */
import { getProject, setProject, clearProject } from "./project-store.js";

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) {
    if (child != null) node.append(child);
  }
  return node;
}

async function handleFiles(fileList, statusEl) {
  const files = [...fileList];
  const treInputs = files.filter((f) => /\.tre$/i.test(f.name));
  const ifcInput = files.find((f) => /\.ifc$/i.test(f.name));

  if (treInputs.length === 0 && !ifcInput) {
    statusEl.textContent = "Select at least one .tre or .ifc file.";
    return;
  }

  statusEl.textContent = "Reading files…";
  const treFiles = await Promise.all(
    treInputs.map(async (f) => ({ name: f.name, text: await f.text() })),
  );

  const project = {
    label:
      treFiles.length > 0
        ? `My project — ${treFiles.length} TRE${ifcInput ? " + IFC" : ""}`
        : `My project — IFC only`,
    createdAt: Date.now(),
    treFiles,
    ifcName: ifcInput?.name ?? null,
    ifcBlob: ifcInput ?? null,
  };

  await setProject(project);
  statusEl.textContent = "Loaded. Reloading…";
  // Reload so every page recomputes from the new source.
  window.location.reload();
}

export async function mountProjectPicker(container) {
  if (!container || container.querySelector(".project-picker")) return;

  const chip = el("span", { className: "pp-chip", textContent: "…" });
  const status = el("span", { className: "pp-status" });

  const fileInput = el("input", {
    type: "file",
    multiple: true,
    accept: ".tre,.TRE,.ifc,.IFC",
    className: "pp-file-input",
  });
  fileInput.style.display = "none";
  fileInput.addEventListener("change", (e) => {
    if (e.target.files?.length) handleFiles(e.target.files, status);
  });

  const loadBtn = el("button", {
    type: "button",
    className: "btn secondary pp-load",
    textContent: "Load my files",
    title: "Choose your own IFC + TRE files",
  });
  loadBtn.addEventListener("click", () => fileInput.click());

  const sampleBtn = el("button", {
    type: "button",
    className: "btn secondary pp-sample",
    textContent: "Use sample",
    title: "Switch back to the bundled Plan 193 sample",
  });
  sampleBtn.style.display = "none";
  sampleBtn.addEventListener("click", async () => {
    status.textContent = "Switching to sample…";
    await clearProject();
    window.location.reload();
  });

  const wrap = el("div", { className: "project-picker" }, [
    el("span", { className: "pp-label", textContent: "Data:" }),
    chip,
    loadBtn,
    sampleBtn,
    status,
    fileInput,
  ]);

  container.append(wrap);

  // Fill in the current source (async — IndexedDB).
  const project = await getProject();
  if (project && project.treFiles?.length) {
    chip.textContent = project.label || `My project — ${project.treFiles.length} TRE`;
    chip.classList.add("pp-chip-user");
    sampleBtn.style.display = "";
  } else if (project && project.ifcBlob) {
    chip.textContent = project.label || "My project — IFC only";
    chip.classList.add("pp-chip-user");
    sampleBtn.style.display = "";
  } else {
    chip.textContent = "Sample — Plan 193";
  }
}
