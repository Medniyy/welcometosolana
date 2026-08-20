/* Tiny static file server.
 *
 *   node tools/serve.mjs <dir> [port]
 *
 * Exists so `npm run serve` and `npm run dashboard` work on a clean checkout
 * with nothing to install. It also matters for the dashboard specifically:
 * opening that file over file:// gives the page a null origin, and the chain
 * APIs it reads refuse the cross-origin request. Served over http it just
 * works.
 *
 * Local only. No directory listing, and paths are resolved and checked so a
 * request cannot climb out of the folder being served.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname, normalize } from "node:path";

const dir = resolve(process.argv[2] || "site");
const port = Number(process.argv[3] || 8899);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".webm": "video/webm",
  ".mp4": "video/mp4", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (rel.endsWith("/")) rel += "index.html";
    /* normalize collapses any ../ before the prefix check, so a crafted path
       cannot escape the served directory. */
    const file = join(dir, normalize(rel));
    if (!file.startsWith(dir)) { res.writeHead(403).end("Forbidden"); return; }

    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404).end("Not found"); return; }

    res.writeHead(200, {
      "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500).end("Server error");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`\n  serving ${dir}\n  http://127.0.0.1:${port}/\n`);
});
