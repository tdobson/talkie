import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';

/** The repo root. Playwright runs from it (see the "e2e" script in package.json). */
export const REPO = process.cwd();

export const FILM_DIR = join(REPO, 'examples/sample-film/dist/film');
export const PLAYER_BUNDLE = join(REPO, 'packages/player/dist/talkie-player.js');
export const WASM_FILE = join(
  REPO,
  'node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm'
);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.wasm': 'application/wasm',
  '.lottie': 'application/zip',
};

/**
 * The folder that examples/watch.html asks for, put together from where the builds leave the
 * pieces: the page itself, the player bundle next to it, and the sample film under film/.
 */
const MOUNTS: Array<{ prefix: string; path: string }> = [
  { prefix: '/watch.html', path: join(REPO, 'examples/watch.html') },
  { prefix: '/talkie-player.js', path: PLAYER_BUNDLE },
  { prefix: '/dotlottie-player.wasm', path: WASM_FILE },
  { prefix: '/film/', path: FILM_DIR },
];

/** The file a URL path stands for, or null when nothing is mounted there. */
export function fileFor(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  for (const mount of MOUNTS) {
    if (!mount.prefix.endsWith('/')) {
      if (decoded === mount.prefix) {
        return mount.path;
      }
      continue;
    }
    if (decoded.startsWith(mount.prefix)) {
      const root = resolve(mount.path);
      const file = resolve(root, normalize(decoded.slice(mount.prefix.length)));
      // Nothing outside the mounted folder is served, whatever the path says.
      return file === root || file.startsWith(root + sep) ? file : null;
    }
  }
  return null;
}

/** A parsed Range header: one byte range inside a file of `size` bytes, or null if it is not valid. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    return null;
  }
  let start: number;
  let end: number;
  if (match[1] === '') {
    // "bytes=-500" means the last 500 bytes.
    start = Math.max(size - Number(match[2]), 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

export interface ServeOptions {
  /**
   * Send the narration no faster than this, in bytes a second. The sample film's sound is small
   * enough that a browser takes all of it at once, which leaves nothing to fail later. A slow
   * link keeps most of it unfetched, so a test can cut the connection part way through.
   */
  audioBytesPerSecond?: number;
}

const AUDIO = new Set(['.webm', '.m4a']);
const TICK_MS = 100;

/** Write `body` to the response a little at a time, and stop if the connection goes away. */
function trickle(res: ServerResponse, body: Buffer, bytesPerSecond: number): void {
  const step = Math.max(Math.floor((bytesPerSecond * TICK_MS) / 1000), 1);
  let sent = 0;
  const timer = setInterval(() => {
    if (res.destroyed) {
      clearInterval(timer);
      return;
    }
    res.write(body.subarray(sent, sent + step));
    sent += step;
    if (sent >= body.length) {
      clearInterval(timer);
      res.end();
    }
  }, TICK_MS);
  res.on('close', () => clearInterval(timer));
}

function handle(req: IncomingMessage, res: ServerResponse, opts: ServeOptions): void {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const file = fileFor(pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  const size = statSync(file).size;
  const headers: Record<string, string | number> = {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  let status = 200;
  let range = { start: 0, end: size - 1 };
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const asked = parseRange(rangeHeader, size);
    if (!asked) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    status = 206;
    range = asked;
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
  }
  res.writeHead(status, { ...headers, 'Content-Length': range.end - range.start + 1 });
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }
  const slow = AUDIO.has(extname(file)) ? opts.audioBytesPerSecond : undefined;
  if (slow === undefined) {
    createReadStream(file, range).pipe(res);
    return;
  }
  readFile(file).then(
    (bytes) => trickle(res, bytes.subarray(range.start, range.end + 1), slow),
    () => res.destroy()
  );
}

export interface StaticServer {
  /** For example http://127.0.0.1:41873 (no trailing slash). */
  url: string;
  /**
   * Lose the connection: every open response is cut off and new requests are refused, until
   * `up()`. This is what a viewer's browser sees when the network goes away.
   */
  down(): void;
  up(): void;
  close(): Promise<void>;
}

/**
 * Start the static server on a free port. It fails straight away, with the command to run, when
 * the player bundle or the sample film has not been built.
 */
export async function startServer(opts: ServeOptions = {}): Promise<StaticServer> {
  if (!existsSync(PLAYER_BUNDLE)) {
    throw new Error(`No player bundle at ${PLAYER_BUNDLE}. Run: yarn build`);
  }
  if (!existsSync(join(FILM_DIR, 'talkie.json'))) {
    throw new Error(`No built film at ${FILM_DIR}. Run: yarn build && yarn sample`);
  }
  let isDown = false;
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => handle(req, res, opts));
  server.on('connection', (socket) => {
    if (isDown) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    down() {
      isDown = true;
      for (const socket of sockets) {
        socket.destroy();
      }
    },
    up() {
      isDown = false;
    },
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
