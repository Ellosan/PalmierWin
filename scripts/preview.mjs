import http from "node:http";
import { stat, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
  ".json": "application/json",
};
const server = http.createServer(async (req, res) => {
  let handle;
  try {
    if (req.url === "/") {
      res.writeHead(302, { Location: "/src/renderer/index.html" });
      res.end();
      return;
    }
    const url = new URL(req.url, "http://localhost"),
      file = path.resolve(
        root,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/src/renderer/index.html" : url.pathname,
          ),
      );
    if (!file.startsWith(root + path.sep) || file.includes(`${path.sep}.`)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error();
    let start = 0,
      end = info.size - 1,
      status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!match) {
        res.writeHead(416);
        res.end();
        return;
      }
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
      status = 206;
      if (start > end || start >= info.size) {
        res.writeHead(416, { "Content-Range": `bytes */${info.size}` });
        res.end();
        return;
      }
    }
    const headers = {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    };
    if (status === 206)
      headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
    res.writeHead(status, headers);
    handle = await open(file);
    handle.createReadStream({ start, end, autoClose: true }).pipe(res);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end("Not found");
    await handle?.close().catch(() => {});
  }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, "127.0.0.1", () =>
  console.log(`PalmierWin preview: http://127.0.0.1:${port}`),
);
