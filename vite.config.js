import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parentDir = path.resolve(__dirname, "..");

const models = {
  "/models/mitek.ifc": path.join(parentDir, "2214703-08T.ifc"),
  "/models/simpson.ifc": path.join(
    parentDir,
    "McBride-Plan 193-Elev D-Std. 2nd FL plan - IFC.ifc",
  ),
  "/model.ifc": path.join(parentDir, "2214703-08T.ifc"),
};

function serveText(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end("File not found");
    return;
  }
  res.setHeader("Content-Type", contentType);
  fs.createReadStream(filePath).pipe(res);
}

function serveFile(res, filePath) {
  serveText(res, filePath, "application/octet-stream");
}

export default defineConfig({
  server: {
    port: 5173,
    open: "/",
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        compare: path.resolve(__dirname, "compare.html"),
        ddp: path.resolve(__dirname, "ddp.html"),
        split: path.resolve(__dirname, "split.html"),
        mitek: path.resolve(__dirname, "mitek.html"),
        truss: path.resolve(__dirname, "truss.html"),
        analyzer: path.resolve(__dirname, "analyzer.html"),
        hanger: path.resolve(__dirname, "hanger-selector.html"),
        paramMaps: path.resolve(__dirname, "parameter-maps.html"),
      },
    },
  },
  plugins: [
    {
      name: "serve-project-files",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url?.split("?")[0] ?? "";

          if (url in models) {
            serveFile(res, models[url]);
            return;
          }

          if (url === "/data/ddp.ddp") {
            serveFile(
              res,
              path.join(
                parentDir,
                "McBride-Plan 193-Elev D-Std. 2nd FL plan - DDP.ddp",
              ),
            );
            return;
          }

          const treMatch = url.match(/^\/data\/tre\/(.+\.tre)$/i);
          if (treMatch) {
            serveText(
              res,
              path.join(parentDir, treMatch[1]),
              "text/plain; charset=utf-8",
            );
            return;
          }

          next();
        });
      },
    },
  ],
});
