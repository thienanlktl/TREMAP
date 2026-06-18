import fs from "fs";
import path from "path";

/**
 * Locates IFC/TRE/DDP source files for build and deploy.
 *
 * Search order:
 *  1. PROJECT_ROOT env var (set in Railway if needed)
 *  2. Parent folder (local dev: ../)
 *  3. viewer/project-data/ (standalone git deploy)
 */
export function resolveProjectRoot(viewerRoot) {
  if (process.env.PROJECT_ROOT) {
    return path.resolve(process.env.PROJECT_ROOT);
  }

  const candidates = [
    path.resolve(viewerRoot, ".."),
    path.join(viewerRoot, "project-data"),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "2214703-08T.ifc"))) {
      return dir;
    }
  }

  return candidates[0];
}

export function assertProjectData(projectRoot) {
  const mitekIfc = path.join(projectRoot, "2214703-08T.ifc");
  if (!fs.existsSync(mitekIfc)) {
    throw new Error(
      `MiTek IFC not found at ${mitekIfc}. ` +
        "Copy IFC/TRE/DDP into project-data/ or set PROJECT_ROOT.",
    );
  }
}
