import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, sep } from 'node:path';
import { createGunzip } from 'node:zlib';
import { isSafeRelativePath, mimeFor } from '@talkie/format';
import { acceptsGzip, locateFilmFile } from '@/lib/videos/film-files';

// The local web server the headless browser loads the render page and one film from. It listens
// on 127.0.0.1 only, on a port the system picks, and lives as long as its browser does.

const LOOPBACK = '127.0.0.1';

/** The only files served from the render page folder, with their types. */
const PAGE_FILES: Record<string, string> = {
  'main.js': 'text/javascript; charset=utf-8',
  'dotlottie-player.wasm': 'application/wasm',
};

export interface RenderServer {
  /** The page to open: `http://127.0.0.1:<port>/<secret>/`. */
  url: string;
  /** The address the server is bound to. */
  address: string;
  /** Stops listening and drops open connections. Safe to call twice. */
  close(): Promise<void>;
}

/** Every path `talkie.json` names. Nothing else in the film folder is served. */
function listedPaths(film: unknown): Set<string> {
  const paths = new Set<string>(['talkie.json']);
  const add = (p: unknown): void => {
    if (isSafeRelativePath(p)) paths.add(p);
  };
  const f = (film ?? {}) as Record<string, unknown>;
  for (const key of ['audio', 'scenes', 'captions']) {
    const list = f[key];
    if (Array.isArray(list)) for (const item of list) add((item as { src?: unknown } | null)?.src);
  }
  const poster = f.poster as { png?: unknown; svg?: unknown } | null | undefined;
  add(poster?.png);
  add(poster?.svg);
  return paths;
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('Not found');
}

/**
 * Sends one file. A `gzipped` file (a scene stored compressed) goes as it is with
 * `Content-Encoding: gzip` when the browser takes gzip, and unzipped otherwise.
 */
async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  type: string,
  gzipped = false
): Promise<void> {
  const info = await stat(file);
  if (!info.isFile()) {
    notFound(res);
    return;
  }
  const asIs = !gzipped || acceptsGzip(req.headers['accept-encoding']);
  res.writeHead(200, {
    'Content-Type': type,
    ...(asIs ? { 'Content-Length': info.size } : {}),
    ...(gzipped && asIs ? { 'Content-Encoding': 'gzip' } : {}),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const read = createReadStream(file);
    read.on('error', reject);
    const stream = asIs ? read : read.pipe(createGunzip());
    stream.on('error', reject);
    res.on('close', () => {
      read.destroy();
      stream.destroy();
      resolve();
    });
    stream.pipe(res);
  });
}

/**
 * Serves the render page (from `pageDir`, built by `yarn build:render-page`) and the film in
 * `filmDir`, for one headless browser.
 *
 * Other programs on the machine can reach a loopback port, so every path starts with a random
 * secret and the Host header must be the address the server gave out. From the film only the
 * files `talkie.json` lists are served, and only when they really are inside the folder.
 */
export async function serveRenderPage(filmDir: string, pageDir: string): Promise<RenderServer> {
  let html: Buffer;
  try {
    html = await readFile(join(pageDir, 'index.html'));
    for (const name of Object.keys(PAGE_FILES)) await stat(join(pageDir, name));
  } catch {
    throw new Error(
      `The Talkie render page is not built: ${pageDir} is incomplete. Run "yarn build:render-page".`
    );
  }
  let listed: Set<string>;
  let filmRoot: string;
  try {
    listed = listedPaths(JSON.parse(await readFile(join(filmDir, 'talkie.json'), 'utf8')));
    filmRoot = await realpath(filmDir);
  } catch {
    throw new Error(`The film has no readable talkie.json: ${filmDir}`);
  }

  const prefix = `/${randomBytes(16).toString('hex')}/`;
  let host = '';

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.headers.host !== host) return notFound(res);
    // The raw path, split by hand: nothing here resolves `..` or decodes a slash into being.
    const raw = (req.url ?? '').split('?')[0] ?? '';
    if (!raw.startsWith(prefix)) return notFound(res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    const rest = raw.slice(prefix.length);
    if (rest === '') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': html.length,
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : html);
      return;
    }
    if (rest.startsWith('page/')) {
      const name = rest.slice('page/'.length);
      const type = Object.hasOwn(PAGE_FILES, name) ? PAGE_FILES[name] : undefined;
      if (!type) return notFound(res);
      return sendFile(req, res, join(pageDir, name), type);
    }
    if (rest.startsWith('film/')) {
      let name: string;
      try {
        name = decodeURIComponent(rest.slice('film/'.length));
      } catch {
        return notFound(res);
      }
      // The allow-list is the check: `..`, absolute paths and NUL bytes are never in it.
      if (!listed.has(name)) return notFound(res);
      // Scenes are stored gzipped (see film-files.ts); films imported before that have them plain.
      const stored = await locateFilmFile(filmRoot, name);
      if (stored === null) return notFound(res);
      const real = await realpath(stored.file).catch(() => null);
      if (real === null || !real.startsWith(filmRoot + sep)) return notFound(res);
      return sendFile(req, res, real, mimeFor(name), stored.gzipped);
    }
    notFound(res);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) notFound(res);
      else res.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK, resolve);
  });
  const { port, address } = server.address() as AddressInfo;
  host = `${LOOPBACK}:${port}`;

  let closing: Promise<void> | null = null;
  return {
    url: `http://${host}${prefix}`,
    address,
    close() {
      closing ??= new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
