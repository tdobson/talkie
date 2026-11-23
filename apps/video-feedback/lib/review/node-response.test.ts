import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveMedia } from './media-api';
import { serveFile } from './media-route';

// The media routes go out through a plain Node server here, as they do under Next's Pages
// Router. The point is Content-Length: without it Safari cannot seek.

const bytes = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251));

let dir: string;
let server: Server;
let base: string;
let failures: unknown[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'node-response-'));
  await writeFile(join(dir, 'a.mp4'), bytes);
  failures = [];
  server = createServer((req, res) => {
    serveMedia(req, res, (web) =>
      serveFile(web, join(dir, 'a.mp4'), { 'Content-Type': 'video/mp4' })
    ).catch((err: unknown) => failures.push(err));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

interface Got {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function get(method: string, headers: Record<string, string> = {}): Promise<Got> {
  return new Promise((resolve, reject) => {
    const req = request(base, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })
      );
    });
    req.on('error', reject);
    req.end();
  });
}

it('sends Content-Length with the whole file', async () => {
  const res = await get('GET');
  expect(res.status).toBe(200);
  expect(res.headers['content-length']).toBe(String(bytes.length));
  expect(res.headers['transfer-encoding']).toBeUndefined();
  expect(res.headers['accept-ranges']).toBe('bytes');
  expect(res.body.equals(bytes)).toBe(true);
});

it('sends Content-Length and Content-Range with a range, open-ended or not', async () => {
  const open = await get('GET', { Range: 'bytes=100000-' });
  expect(open.status).toBe(206);
  expect(open.headers['content-length']).toBe('200000');
  expect(open.headers['content-range']).toBe(`bytes 100000-299999/${bytes.length}`);
  expect(open.body.equals(bytes.subarray(100000))).toBe(true);

  const two = await get('GET', { Range: 'bytes=0-1' });
  expect(two.status).toBe(206);
  expect(two.headers['content-length']).toBe('2');
  expect(two.body.equals(bytes.subarray(0, 2))).toBe(true);
});

it('answers HEAD with the headers and no body', async () => {
  const res = await get('HEAD');
  expect(res.status).toBe(200);
  expect(res.headers['content-length']).toBe(String(bytes.length));
  expect(res.body.length).toBe(0);
});

it('refuses other methods with 405', async () => {
  const res = await get('POST');
  expect(res.status).toBe(405);
  expect(res.headers.allow).toBe('GET, HEAD');
});

it('takes a reader leaving mid-file in its stride', async () => {
  await new Promise<void>((resolve, reject) => {
    const req = request(base, { method: 'GET' }, (res) => {
      res.once('data', () => {
        req.destroy();
        resolve();
      });
    });
    req.on('error', () => {});
    req.end();
    setTimeout(() => reject(new Error('no data')), 5000);
  });
  await new Promise((r) => setTimeout(r, 200));
  expect(failures).toEqual([]);
  // The server is still there for the next request.
  expect((await get('GET', { Range: 'bytes=0-9' })).status).toBe(206);
});
