import { existsSync, realpathSync, watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TalkieFilm } from '@talkie/format';
import { buildFilm, type BuildOptions } from '../build';
import { devPage } from './page';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.vtt': 'text/vtt; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.lottie': 'application/zip',
};

/** The Content-Type for a file name. */
export const contentType = (name: string) =>
  TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';

/** `root` joined with a URL path, or null if the path would leave `root`. */
export function safeJoin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) {
    return null;
  }
  const base = resolve(root);
  const file = resolve(base, `./${decoded}`);
  return file === base || file.startsWith(base + sep) ? file : null;
}

/** Send bytes, honouring a single `Range`, which browsers need to seek in audio. Never cached. */
export function sendBytes(
  req: IncomingMessage,
  res: ServerResponse,
  bytes: Uint8Array,
  type: string
): void {
  const size = bytes.length;
  const headers: Record<string, string | number> = {
    'content-type': type,
    'cache-control': 'no-store',
    'accept-ranges': 'bytes',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let body = bytes;
  let status = 200;
  if (range && (range[1] !== '' || range[2] !== '')) {
    let start: number;
    let end: number;
    if (range[1] === '') {
      start = Math.max(0, size - Number(range[2]));
      end = size - 1;
    } else {
      start = Number(range[1]);
      end = range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
    }
    if (start >= size || start > end) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${size}`, 'content-length': 0 });
      res.end();
      return;
    }
    status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${size}`;
    body = bytes.subarray(start, end + 1);
  }
  headers['content-length'] = body.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function sendNotFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end('Not found\n');
}

/** Send a file from under `root`, or 404 when it is missing or outside `root`. */
export async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  urlPath: string
): Promise<void> {
  const file = safeJoin(root, urlPath);
  let bytes: Uint8Array | null = null;
  if (file) {
    bytes = await readFile(file).catch(() => null);
  }
  if (!file || !bytes) {
    sendNotFound(res);
    return;
  }
  sendBytes(req, res, bytes, contentType(file));
}

/** The first folder at or above `start` that holds `relative`, joined with it. */
function findUp(start: string, relative: string): string | null {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** Where installed packages are looked for: above this file, then above the working folder. */
const searchRoots = () => [dirname(fileURLToPath(import.meta.url)), process.cwd()];

/** The built player (`@talkie/player/dist`). Throws when it has not been built. */
export function findPlayerDist(): string {
  for (const root of searchRoots()) {
    const found = findUp(root, 'node_modules/@talkie/player/dist/talkie-player.js');
    if (found) {
      return dirname(real(found));
    }
  }
  throw new Error(
    'The player is not built: @talkie/player/dist/talkie-player.js was not found. Run yarn build first.'
  );
}

/** The dotlottie-web `dist` folder, which holds its WASM. Looked for beside the player first. */
export function findDotLottieDist(playerDist: string): string {
  for (const root of [playerDist, ...searchRoots()]) {
    const found = findUp(
      root,
      'node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm'
    );
    if (found) {
      return dirname(found);
    }
  }
  throw new Error('@lottiefiles/dotlottie-web is not installed. Run yarn install first.');
}

export interface DevOptions extends BuildOptions {
  /** Port to listen on; 0 picks a free one. Default 4321. */
  port?: number;
  /** The built player folder. Default: `@talkie/player/dist`, found from node_modules. */
  playerDir?: string;
  /** Where progress lines go. Default: stdout. */
  log?: (line: string) => void;
}

export interface DevServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Folders watched under the project, as the plan lists them. The config file is watched too. */
const WATCHED = ['scenes', 'script', 'art'];
const DEBOUNCE_MS = 80;

/**
 * Build the project once, serve it with the real player, and rebuild on every save. Each page
 * holds an event stream open: `reload` after a good build, `problem` after one that failed.
 */
export async function startDev(dir: string, opts: DevOptions = {}): Promise<DevServer> {
  const { port = 4321, playerDir = findPlayerDist(), log: logOpt, ...buildOpts } = opts;
  const log = logOpt ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const project = resolve(dir);
  const wasmDir = findDotLottieDist(playerDir);

  const first = await buildFilm(project, buildOpts);
  let film: TalkieFilm = first.film;
  const filmDir = first.outDir;

  const clients = new Set<ServerResponse>();
  const send = (event: string, data: unknown) => {
    for (const client of clients) {
      client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
    } else if (path === '/' || path === '/index.html') {
      const page = devPage({
        title: film.title,
        scenes: film.scenes.map((s) => ({ id: s.id, start: s.start })),
      });
      sendBytes(req, res, Buffer.from(page), TYPES['.html']!);
    } else if (path === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else if (path === '/talkie-player.js') {
      await sendFile(req, res, playerDir, 'talkie-player.js');
    } else if (path === '/dotlottie-player.wasm') {
      await sendFile(req, res, wasmDir, 'dotlottie-player.wasm');
    } else if (path.startsWith('/film/')) {
      await sendFile(req, res, filmDir, path.slice('/film/'.length));
    } else {
      sendNotFound(res);
    }
  };
  const server: Server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      }
      res.end(`${error instanceof Error ? error.message : String(error)}\n`);
    });
  });

  // One build at a time. A save that lands during a build starts another when it ends.
  let timer: NodeJS.Timeout | null = null;
  let building = false;
  let again = false;
  let closed = false;
  let idle: Promise<void> = Promise.resolve();
  const rebuild = async () => {
    if (building) {
      again = true;
      return;
    }
    building = true;
    try {
      do {
        again = false;
        try {
          const built = await buildFilm(project, buildOpts);
          film = built.film;
          log(
            `Rebuilt: ${built.rebuilt.length > 0 ? built.rebuilt.join(', ') : 'no scene changed'}`
          );
          send('reload', { rebuilt: built.rebuilt });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`Build failed: ${message}`);
          send('problem', { message });
        }
      } while (again && !closed);
    } finally {
      building = false;
    }
  };
  const changed = () => {
    if (closed) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      idle = rebuild();
    }, DEBOUNCE_MS);
  };

  const watchers: FSWatcher[] = [];
  for (const name of WATCHED) {
    const folder = join(project, name);
    if (existsSync(folder)) {
      watchers.push(watch(folder, { recursive: true }, changed));
    }
  }
  watchers.push(
    watch(project, (_event, file) => {
      if (file?.startsWith('talkie.config.')) {
        changed();
      }
    })
  );
  for (const watcher of watchers) {
    watcher.on('error', (error) => log(`Watch failed: ${error.message}`));
  }

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(port, 'localhost', () => {
      server.off('error', fail);
      done();
    });
  });
  const bound = (server.address() as AddressInfo).port;

  return {
    url: `http://localhost:${bound}/`,
    port: bound,
    async close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
      }
      for (const watcher of watchers) {
        watcher.close();
      }
      for (const client of clients) {
        client.end();
      }
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
      await idle;
    },
  };
}
