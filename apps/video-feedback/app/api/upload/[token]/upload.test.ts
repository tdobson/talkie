import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { fx } from '@/lib/media/testutil';
import { uploadCommand } from '@/lib/mcp/tools/publish';
import {
  createUpload,
  getUpload,
  setUploadDiskProbeForTests,
  uploadLimits,
  uploadsDir,
} from '@/lib/mcp/uploads';
import { getVideo } from '@/lib/storage/repo';
import { withTmpData } from '@/test/helpers/tmpData';
import { POST as finish } from './finish/route';
import { GET as partSize, HEAD as partHead, PUT as part } from './part/[n]/route';

// The command upload_film hands out, run for real with sh, bash and busybox sh against the route
// handlers behind a plain HTTP server. It is the riskiest part: quoting, dd, curl, the resume
// and the finish check all have to agree.

const run = promisify(execFile);
const saved = { ...uploadLimits };

let dir: string;
let cleanup: () => Promise<void>;
let server: Server;
let base: string;
/** How many times to answer 503 to a part before taking it, to see curl --retry at work. */
let refuse: Record<string, number>;
let seen: string[];

beforeEach(async () => {
  ({ dir, cleanup } = await withTmpData());
  setUploadDiskProbeForTests(async () => Number.MAX_SAFE_INTEGER);
  refuse = {};
  seen = [];
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const m = /^\/api\/upload\/([^/]+)\/(?:part\/([^/]+)|finish)$/.exec(url.pathname);
      if (!m) {
        res.writeHead(404).end();
        return;
      }
      const [, token, n] = m;
      seen.push(`${req.method} ${n ?? 'finish'}`);
      if (req.method === 'PUT' && n !== undefined && (refuse[n] ?? 0) > 0) {
        refuse[n] -= 1;
        req.resume();
        res.writeHead(503).end('try again\n');
        return;
      }
      const request = new Request(url, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: req.method === 'PUT' ? (Readable.toWeb(req) as ReadableStream) : undefined,
        duplex: 'half',
      } as RequestInit);
      const params = Promise.resolve({ token, n: n ?? '' });
      const response =
        n === undefined
          ? await finish(request, { params })
          : req.method === 'GET'
            ? await partSize(request, { params })
            : await part(request, { params });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  Object.assign(uploadLimits, saved);
  await new Promise((resolve) => server.close(resolve));
  setUploadDiskProbeForTests(null);
  await cleanup();
});

/** A film at a path with a space, a quote and shell syntax in it. */
async function awkwardFilm(): Promise<string> {
  const folder = join(dir, "agent's films $(touch pwned)");
  await mkdir(folder, { recursive: true });
  const path = join(folder, 'it\'s "the" cut `x`.mp4');
  await copyFile(fx('h264.mp4'), path);
  return path;
}

// 32 KiB parts, so the 450 KB fixture goes in 14 of them.
const SMALL = { blockBytes: 4096, blocks: 8 };

async function commandFor(path: string) {
  const { record, token } = await createUpload({
    filename: 'cut.mp4',
    mode: 'new',
    title: 'Roof',
    createdBy: null,
  });
  return { record, command: uploadCommand(path, `${base}/api/upload/${token}`, SMALL) };
}

// busybox sh is a small ash, the nearest to a bare POSIX sh on this machine.
const shells = [['sh'], ['bash'], ...(existsSync('/usr/bin/busybox') ? [['busybox', 'sh']] : [])];

it.each(shells)('the command uploads and imports a film, run by %s %s', async (...shell) => {
  const path = await awkwardFilm();
  const { record, command } = await commandFor(path);
  const tmp = join(dir, 'tmp');
  await mkdir(tmp);
  refuse['3'] = 1;

  const { stdout, stderr } = await run(shell[0], [...shell.slice(1), '-c', command], {
    cwd: dir,
    env: { ...process.env, TMPDIR: tmp },
  });
  const out = JSON.parse(stdout);
  expect(out).toMatchObject({ ok: true, state: 'done', version: 1 });
  expect(stderr).toContain('upload: part 13 sent');
  expect(stderr).not.toContain('part 14');
  // Part 3 was refused once and sent again; each part was asked about first.
  expect(seen.filter((s) => s === 'PUT 3')).toHaveLength(2);
  expect(seen.filter((s) => s.startsWith('GET'))).toHaveLength(14);
  expect(await getVideo(out.videoId)).toMatchObject({ title: 'Roof', latestVersion: 1 });
  expect(await getUpload(record.uploadId)).toMatchObject({ state: 'done' });
  // Nothing was run from the path, and the temporary part file is gone.
  expect(await readdir(dir)).not.toContain('pwned');
  expect(await readdir(tmp)).toEqual([]);
});

it('says so when the file is not there, and sends nothing', async () => {
  const { command } = await commandFor(join(dir, 'missing.mp4'));
  const err = await run('sh', ['-c', command]).catch((e: { code: number; stderr: string }) => e);
  expect(err).toMatchObject({ code: 1, stderr: expect.stringContaining('there is no file at') });
  expect(seen).toEqual([]);
});

type Failed = { code: number; stdout: string; stderr: string };

it.each(shells)(
  'a part that keeps failing stops it with the reason; run again, it resumes (%s %s)',
  async (...shell) => {
    const path = await awkwardFilm();
    const { record, command } = await commandFor(path);
    const sh = (cmd: string) => run(shell[0], [...shell.slice(1), '-c', cmd]);
    // Refused more times than curl retries.
    refuse['2'] = 4;

    const err = (await sh(command).catch((e: Failed) => e)) as Failed;
    expect(err.code).toBe(1);
    // The server's own words, not a "part missing" from a finish that should not have run.
    expect(err.stderr).toContain('try again');
    expect(err.stderr).toContain('upload: part 2 was not taken, for the reason above');
    expect(err.stdout).toBe('');
    expect(seen).not.toContain('PUT 3');
    expect(seen).not.toContain('POST finish');
    expect((await getUpload(record.uploadId))?.state).toBe('receiving');

    // Run again, with the network back: parts 0 and 1 are not sent again.
    seen = [];
    const { stdout, stderr } = await sh(command);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, version: 1 });
    expect(stderr).toContain('upload: part 0 already there');
    expect(stderr).toContain('upload: part 1 already there');
    expect(stderr).toContain('upload: part 2 sent');
    expect(seen).not.toContain('PUT 0');
    expect(seen).not.toContain('PUT 1');
    expect(seen).toContain('PUT 2');
  },
  60_000
);

it('shows the 413 when the film is over the limit, and does not ask to finish', async () => {
  uploadLimits.totalMaxBytes = 100_000;
  const { command } = await commandFor(await awkwardFilm());
  const err = (await run('sh', ['-c', command]).catch((e: Failed) => e)) as Failed;
  expect(err.code).toBe(1);
  expect(err.stderr).toMatch(/The film is too large: the most it can be is 100000 bytes/);
  expect(err.stderr).toContain('upload: part 3 was not taken');
  expect(seen).not.toContain('POST finish');
}, 60_000);

it('works with a curl too old for --fail-with-body', async () => {
  const real = (await run('sh', ['-c', 'command -v curl'])).stdout.trim();
  const bin = join(dir, 'old-curl');
  await mkdir(bin);
  await writeFile(
    join(bin, 'curl'),
    `#!/bin/sh\nfor a in "$@"; do [ "$a" = --fail-with-body ] && { echo "curl: option --fail-with-body: is unknown" >&2; exit 2; }; done\nexec '${real}' "$@"\n`
  );
  await chmod(join(bin, 'curl'), 0o755);
  const { command } = await commandFor(await awkwardFilm());
  refuse['1'] = 4;
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const err = (await run('sh', ['-c', command], { env }).catch((e: Failed) => e)) as Failed;
  // -f stops at the refused part all the same, with only the status to show for it.
  expect(err.code).toBe(1);
  expect(err.stderr).toMatch(/503/);
  const { stdout } = await run('sh', ['-c', command], { env });
  expect(JSON.parse(stdout)).toMatchObject({ ok: true, version: 1 });
}, 60_000);

it('answers HEAD for a part with the status alone', async () => {
  const { record, token } = await createUpload({
    filename: 'cut.mp4',
    mode: 'new',
    title: 'Roof',
    createdBy: null,
  });
  await writeFile(join(uploadsDir(), record.uploadId, 'parts', '0'), 'twelve bytes');
  const head = (n: string) =>
    partHead(new Request('http://x/', { method: 'HEAD' }), {
      params: Promise.resolve({ token, n }),
    });
  const res = await head('0');
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('');
  expect((await head('1')).status).toBe(404);
});
