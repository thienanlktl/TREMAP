import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const SST_UPSTREAM = "https://api.strongtie.com/gws/hanger-selector/hangers";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, "..", "dist");
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = process.env.HOST ?? "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ifc": "application/octet-stream",
  ".tre": "text/plain; charset=utf-8",
  ".ddp": "application/octet-stream",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(distRoot, normalized);
  if (!filePath.startsWith(distRoot)) {
    return null;
  }
  return filePath;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", ext === ".html" ? "no-cache" : "public, max-age=3600");
  fs.createReadStream(filePath).pipe(res);
}

function proxySSTRequest(req, res) {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const upstream = new URL(SST_UPSTREAM);
    const headers = { ...req.headers, host: upstream.host };
    delete headers.connection;

    const proxyReq = https.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || 443,
        path: upstream.pathname,
        method: "POST",
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on("error", (error) => {
      res.statusCode = 502;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`SST proxy error: ${error.message}`);
    });

    proxyReq.end(body);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = req.url ?? "/";
  const urlPath = requestUrl.split("?")[0];

  if (urlPath === "/api/sst/hangers" && req.method === "POST") {
    proxySSTRequest(req, res);
    return;
  }

  let filePathInput = urlPath;
  if (filePathInput === "/") {
    filePathInput = "/index.html";
  }

  let filePath = safePath(filePathInput);
  if (!filePath) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    const htmlFallback = safePath(`${urlPath}.html`);
    if (htmlFallback && fs.existsSync(htmlFallback)) {
      sendFile(res, htmlFallback);
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  sendFile(res, filePath);
});

if (!fs.existsSync(distRoot)) {
  console.error("dist/ not found. Run: npm run deploy");
  process.exit(1);
}

server.listen(port, host, () => {
  console.log("");
  console.log("Plan 193 Truss Viewer — production server");
  console.log("==========================================");
  console.log(`  Listening on http://${host}:${port}/`);
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    console.log(`  Public:  https://${process.env.RAILWAY_PUBLIC_DOMAIN}/`);
  }
  console.log("");
});
