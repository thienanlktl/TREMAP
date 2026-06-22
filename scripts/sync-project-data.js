import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerRoot = path.resolve(__dirname, "..");
const sourceRoot = path.resolve(viewerRoot, "..");
const targetRoot = path.join(viewerRoot, "project-data");

const FILES = [
  "2214703-08T.ifc",
  "McBride-Plan 193-Elev D-Std. 2nd FL plan - IFC.ifc",
  "McBride-Plan 193-Elev D-Std. 2nd FL plan - DDP.ddp",
  "Parameters Map.csv",
];

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  if (!fs.existsSync(path.join(sourceRoot, "2214703-08T.ifc"))) {
    console.error("Source IFC not found in parent folder:", sourceRoot);
    process.exit(1);
  }

  fs.mkdirSync(targetRoot, { recursive: true });

  for (const file of FILES) {
    const src = path.join(sourceRoot, file);
    if (!fs.existsSync(src)) {
      console.warn(`  skip (missing): ${file}`);
      continue;
    }
    copyFile(src, path.join(targetRoot, file));
    console.log(`  ${file}`);
  }

  const treFiles = fs
    .readdirSync(sourceRoot)
    .filter((name) => /^[tj]\d+[a-z]*\.tre$/i.test(name));

  for (const file of treFiles) {
    copyFile(path.join(sourceRoot, file), path.join(targetRoot, file));
  }
  console.log(`  ${treFiles.length} TRE files`);

  console.log(`\nProject data copied to ${targetRoot}`);
  console.log("Commit project-data/ to git for Railway standalone deploy.");
}

main();
