import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const required = [
  "package.json",
  "scripts/build-data.js",
  "scripts/prepare-deploy.js",
  "scripts/serve-production.js",
  "project-data/2214703-08T.ifc",
  "main.js",
  "index.html",
];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));

if (missing.length) {
  console.error("Deploy check failed — missing files at repo root:");
  for (const file of missing) {
    console.error(`  - ${file}`);
  }
  console.error("");
  console.error("On GitHub, package.json and scripts/ must be at the SAME level.");
  console.error("If files are inside a viewer/ subfolder, set Railway Root Directory to viewer");
  process.exit(1);
}

console.log("Deploy check OK — all required files present.");
