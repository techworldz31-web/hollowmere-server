// Minimal static file handler (no dependencies) used by the dev server and bake script.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
const gzipAsync = promisify(gzip);    // on the thread pool: compressing a sprite sheet never stalls the game loop

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const GZ = new Map();     // file -> gzipped body (kept for the session)

export function staticHandler(root) {
  root = resolve(root);
  return async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(root, p));
      if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
      const s = await stat(file);
      if (s.isDirectory()) { res.writeHead(302, { Location: p + '/' }); return res.end(); }
      // revalidate cheaply: an unchanged file answers 304, so returning players don't download the sprites again
      const etag = `"${s.size.toString(36)}-${Math.floor(s.mtimeMs).toString(36)}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
      const type = TYPES[extname(file)] || 'application/octet-stream';
      const head = { 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag };
      // text (the game and the sprite sheets, which are base64 inside .js) goes out gzipped
      if (/^text|json|svg/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        let gz = GZ.get(file);
        if (!gz || gz.etag !== etag) { gz = { etag, buf: await gzipAsync(await readFile(file), { level: 6 }) }; GZ.set(file, gz); }
        res.writeHead(200, { ...head, 'Content-Encoding': 'gzip', 'Content-Length': gz.buf.length, Vary: 'Accept-Encoding' });
        return res.end(gz.buf);
      }
      res.writeHead(200, head);
      res.end(await readFile(file));
    } catch {
      res.writeHead(404); res.end('Not found');
    }
  };
}

export function serveStatic(root, port = 0) {
  return new Promise((ok) => {
    const server = createServer(staticHandler(root));
    server.listen(port, '127.0.0.1', () => ok(server));
  });
}
