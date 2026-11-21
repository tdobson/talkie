// A small static file server for the spike folder, with byte ranges (audio and video seeking need
// them) and the right MIME types. Used by stills.mjs and the page checks; `npx serve spike` works too.
// Usage: node proto/serve.mjs [port]   (binds 0.0.0.0 so a phone on the LAN can open it)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
  '.png': 'image/png', '.lottie': 'application/zip', '.vtt': 'text/vtt',
};

export function serve(port = 0) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    const size = fs.statSync(file).size;
    const head = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      const start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10));
      const end = m[1] && m[2] ? Math.min(size - 1, parseInt(m[2], 10)) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...head, 'content-length': size });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, port: server.address().port })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await serve(parseInt(process.argv[2] || '8787', 10));
  console.log(`spike served at http://localhost:${port}/ (compare.html, sync.html)`);
}
