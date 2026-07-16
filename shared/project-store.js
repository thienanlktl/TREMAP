/**
 * Persistent store for the user's loaded project (IFC + TRE files).
 *
 * Uses IndexedDB because an IFC file can be several MB — too large for
 * sessionStorage. One record ("current") holds the whole project so every page
 * (which is a fresh document load in this multi-page app) can read it back.
 */

const DB_NAME = "tre-ifc-viewer";
const STORE = "project";
const KEY = "current";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/**
 * @returns {Promise<null | {
 *   label: string,
 *   createdAt: number,
 *   treFiles: Array<{ name: string, text: string }>,
 *   ifcName: string | null,
 *   ifcBlob: Blob | null,
 * }>}
 */
export async function getProject() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = tx(db, "readonly").get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function setProject(project) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readwrite").put(project, KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearProject() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const req = tx(db, "readwrite").delete(KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* ignore */
  }
}

/** True if the user has loaded their own project (vs the bundled sample). */
export async function hasProject() {
  const p = await getProject();
  return Boolean(p && (p.treFiles?.length || p.ifcBlob));
}
