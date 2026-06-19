export function renderNav(active) {
  const links = [
    { id: "viewer", href: "/", label: "3D Viewer" },
    { id: "split", href: "/split.html", label: "Split Compare" },
    { id: "compare", href: "/compare.html", label: "BOM Compare" },
    { id: "analyzer", href: "/analyzer.html", label: "Truss Analyzer" },
    { id: "mitek", href: "/mitek.html", label: "MiTek Inspector" },
    { id: "ddp", href: "/ddp.html", label: "DDP Inspector" },
    { id: "hanger", href: "/hanger-selector.html", label: "Hanger Ref" },
    { id: "param-maps", href: "/parameter-maps.html", label: "Param Maps" },
  ];

  const nav = document.createElement("nav");
  nav.className = "site-nav";

  for (const link of links) {
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.textContent = link.label;
    anchor.className = link.id === active ? "active" : "";
    nav.append(anchor);
  }

  return nav;
}

export function mountNav(active, targetId = "site-nav") {
  const target = document.getElementById(targetId);
  if (!target) {
    return;
  }
  target.replaceChildren(renderNav(active));
}
