import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { assertProjectData, resolveProjectRoot } from "./resolve-project-root.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerRoot = path.resolve(__dirname, "..");
const projectRoot = resolveProjectRoot(viewerRoot);
const distRoot = path.join(viewerRoot, "dist");
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`  skip (missing): ${src}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function main() {
  if (!fs.existsSync(distRoot)) {
    console.error("dist/ not found. Run `npm run build` first.");
    process.exit(1);
  }

  assertProjectData(projectRoot);

  console.log(`Using project data: ${projectRoot}`);
  console.log("Staging production files into dist/...");
  const modelsDir = path.join(distRoot, "models");
  fs.mkdirSync(modelsDir, { recursive: true });

  const mitekIfc = path.join(projectRoot, "2214703-08T.ifc");
  const simpsonIfc = path.join(
    projectRoot,
    "McBride-Plan 193-Elev D-Std. 2nd FL plan - IFC.ifc",
  );

  copyFile(mitekIfc, path.join(modelsDir, "mitek.ifc"));
  copyFile(simpsonIfc, path.join(modelsDir, "simpson.ifc"));
  copyFile(mitekIfc, path.join(distRoot, "model.ifc"));
  console.log("  models/ (IFC files)");

  const treDir = path.join(distRoot, "data", "tre");
  fs.mkdirSync(treDir, { recursive: true });
  const treFiles = fs
    .readdirSync(projectRoot)
    .filter((name) => /^[tj]\d+[a-z]*\.tre$/i.test(name));
  for (const file of treFiles) {
    copyFile(path.join(projectRoot, file), path.join(treDir, file));
  }
  console.log(`  data/tre/ (${treFiles.length} TRE files)`);

  copyDir(path.join(viewerRoot, "data"), path.join(distRoot, "data"));
  console.log("  data/ (JSON catalogs + DDP extract)");

  const ddpSource = path.join(
    projectRoot,
    "McBride-Plan 193-Elev D-Std. 2nd FL plan - DDP.ddp",
  );
  if (fs.existsSync(ddpSource)) {
    copyFile(ddpSource, path.join(distRoot, "data", "ddp.ddp"));
    console.log("  data/ddp.ddp");
  }

  copyWasmAssets(viewerRoot, distRoot);

  const readme = `Plan 193 Truss Viewer — Production Package
Generated: ${new Date().toISOString()}

Run on the host machine:
  node scripts/serve-production.js

Users open in a browser:
  http://<server-ip>:8080/

Requires Node.js 18+ on the server only (not on each user's PC).
`;
  fs.writeFileSync(path.join(distRoot, "README-DEPLOY.txt"), readme);
  copyFile(path.join(viewerRoot, "web.config"), path.join(distRoot, "web.config"));

  console.log("\nDeploy package ready in dist/");
  console.log("Next: npm start");
}

function copyWasmAssets(viewerRoot, distRoot) {
  const wasmDir = path.join(distRoot, "wasm");
  fs.mkdirSync(wasmDir, { recursive: true });

  const wasmFiles = ["web-ifc.wasm", "web-ifc-mt.wasm", "web-ifc-mt.worker.js"];
  const packageDirs = [
    path.join(viewerRoot, "node_modules", "web-ifc-viewer", "node_modules", "web-ifc"),
    path.join(viewerRoot, "node_modules", "web-ifc-three", "node_modules", "web-ifc"),
    path.join(viewerRoot, "node_modules", "web-ifc"),
  ];

  let copied = 0;
  for (const pkgDir of packageDirs) {
    for (const file of wasmFiles) {
      const src = path.join(pkgDir, file);
      const dest = path.join(wasmDir, file);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        copied += 1;
      }
    }
  }

  if (copied) {
    console.log(`  wasm/ (${copied} files)`);
  } else {
    console.log("  wasm/ (using bundled wasm — no separate files found)");
  }
}

main();
