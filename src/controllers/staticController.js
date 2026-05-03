import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { sendError } from "../views/apiView.js";

const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function safePath(publicDir, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const cleaned = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  return join(publicDir, cleaned);
}

export class StaticController {
  constructor({ publicDir }) {
    this.publicDir = publicDir;
  }

  async handle(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const path = safePath(this.publicDir, url.pathname);

    try {
      const info = await stat(path);
      if (!info.isFile()) return false;
      res.writeHead(200, {
        "Content-Type": TYPES.get(extname(path)) || "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "no-store",
      });
      if (req.method === "HEAD") {
        res.end();
        return true;
      }
      createReadStream(path).pipe(res);
      return true;
    } catch {
      if (!url.pathname.startsWith("/api/")) {
        sendError(res, 404, "Not found");
        return true;
      }
      return false;
    }
  }
}
