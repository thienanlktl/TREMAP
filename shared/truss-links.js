export function viewerUrl({ mark, model = "/models/mitek.ifc" } = {}) {
  const params = new URLSearchParams();
  params.set("model", model);
  if (mark) {
    params.set("mark", mark.toUpperCase());
  }
  return `/?${params.toString()}`;
}

export function trussDetailUrl(mark) {
  return `/truss.html?mark=${encodeURIComponent(mark.toUpperCase())}`;
}

export function splitCompareUrl(mark) {
  if (!mark) {
    return "/split.html";
  }
  return `/split.html?mark=${encodeURIComponent(mark.toUpperCase())}`;
}

export function normalizeTrussMark(name) {
  if (name == null) {
    return null;
  }
  const upper = String(name).toUpperCase().trim();
  const match = upper.match(/^([TJ]\d+[A-Z]*)/);
  return match ? match[1] : upper.split(/\s+/)[0];
}

export async function loadTrussSources() {
  const [mitekRes, ddpRes, bomRes] = await Promise.all([
    fetch("/data/mitek-catalog.json"),
    fetch("/data/ddp-catalog.json"),
    fetch("/data/bom-comparison.json"),
  ]);

  if (!mitekRes.ok || !ddpRes.ok || !bomRes.ok) {
    throw new Error("Catalog data missing — run npm run build-data");
  }

  const mitekCatalog = await mitekRes.json();
  const ddpCatalog = await ddpRes.json();
  const bom = await bomRes.json();

  const mitekByMark = new Map(mitekCatalog.trusses.map((truss) => [truss.mark, truss]));
  const ddpByMark = new Map(ddpCatalog.trusses.map((truss) => [truss.mark, truss]));
  const bomByMark = new Map(bom.rows.map((row) => [row.mark, row]));
  const marks = [...new Set([
    ...mitekCatalog.trusses.map((truss) => truss.mark),
    ...ddpCatalog.trusses.map((truss) => truss.mark),
  ])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return { mitekCatalog, ddpCatalog, bom, mitekByMark, ddpByMark, bomByMark, marks };
}

export function compareTrussMark(mark, sources) {
  const key = mark.toUpperCase();
  const mitek = sources.mitekByMark.get(key) ?? null;
  const simpson = sources.ddpByMark.get(key) ?? null;
  const bom = sources.bomByMark.get(key) ?? null;

  const rows = [
    { label: "Quantity", mitek: mitek?.quantity, simpson: simpson?.quantity, status: bom?.status },
    { label: "Ply", mitek: mitek?.ply, simpson: simpson?.ply },
    { label: "Span", mitek: mitek?.spanDisplay, simpson: simpson?.spanDisplay },
    { label: "Spacing", mitek: mitek?.spacing, simpson: simpson?.spacing },
    { label: "Pitch", mitek: mitek?.pitch, simpson: null },
    { label: "Type", mitek: mitek?.trussType, simpson: simpson?.trussType },
    { label: "Girder", mitek: mitek?.girder ? "Yes" : mitek ? "No" : null, simpson: null },
    { label: "TCLL", mitek: mitek?.loads?.tcLive ? `${mitek.loads.tcLive} psf` : null, simpson: simpson?.loads?.tcLive ? `${simpson.loads.tcLive} psf` : null },
    { label: "TCDL", mitek: mitek?.loads?.tcDead ? `${mitek.loads.tcDead} psf` : null, simpson: simpson?.loads?.tcDead ? `${simpson.loads.tcDead} psf` : null },
    { label: "Max TC CSI", mitek: mitek?.engineering?.maxTcCsi, simpson: simpson?.engineering?.maxCsi },
    { label: "Max BC CSI", mitek: mitek?.engineering?.maxBcCsi, simpson: null },
    { label: "Weight", mitek: mitek?.engineering?.weight ? `${mitek.engineering.weight} lb` : null, simpson: simpson?.engineering?.weight ? `${simpson.engineering.weight} lb` : null },
    { label: "Max Reaction", mitek: mitek?.engineering?.reaction1 ? `${mitek.engineering.reaction1} lb` : null, simpson: simpson?.engineering?.reactions?.maxDown ? `${simpson.engineering.reactions.maxDown} lb` : null },
    { label: "Max Uplift", mitek: mitek?.engineering?.maxUplift1 ? `${mitek.engineering.maxUplift1} lb` : null, simpson: simpson?.engineering?.reactions?.maxUplift ? `${simpson.engineering.reactions.maxUplift} lb` : null },
    { label: "Deflection LL", mitek: mitek?.engineering?.deflectionLL ? `${mitek.engineering.deflectionLL}"` : null, simpson: simpson?.engineering?.deflectionLimitLl },
    { label: "Plates", mitek: mitek?.plates?.count, simpson: null },
    { label: "Wind Vult", mitek: null, simpson: simpson?.windMph ? `${simpson.windMph} mph` : null },
    { label: "Snow", mitek: null, simpson: simpson?.snowPsf ? `${simpson.snowPsf} psf` : null },
    { label: "Load Template", mitek: mitek?.designCode, simpson: simpson?.loadTemplate },
  ];

  return { mark: key, mitek, simpson, bom, rows };
}

export function cellDiffClass(mitekValue, simpsonValue) {
  if (mitekValue == null || simpsonValue == null) {
    return "";
  }
  return String(mitekValue) === String(simpsonValue) ? "match" : "diff";
}
