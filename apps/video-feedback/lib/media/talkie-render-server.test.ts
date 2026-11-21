import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RenderServer, serveRenderPage } from './talkie-render-server';

const FIXTURE_FILM = fileURLToPath(new URL('../../test/fixtures/talkie-mini', import.meta.url));

let tmp: string;
let filmDir: string;
let pageDir: string;
let server: RenderServer;

/** A raw request, so the path is sent exactly as written (fetch would tidy `..` away). */
function get(
  path: string,
  opts: { method?: string; host?: string } = {}
): Promise<{ status: number; type: string; body: Buffer }> {
  const { port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: opts.method ?? 'GET',
        headers: opts.host ? { host: opts.host } : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const base = (): string => new URL(server.url).pathname;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'vf-render-server-'));
  filmDir = join(tmp, 'film');
  pageDir = join(tmp, 'page');
  await cp(FIXTURE_FILM, filmDir, { recursive: true });
  await writeFile(join(filmDir, 'secret.txt'), 'not part of the film');
  await writeFile(join(tmp, 'outside.json'), '{"outside":true}');
  await mkdir(pageDir);
  await writeFile(join(pageDir, 'index.html'), '<!doctype html><title>render</title>');
  await writeFile(join(pageDir, 'main.js'), 'window.x = 1;');
  await writeFile(join(pageDir, 'dotlottie-player.wasm'), Buffer.from([0, 97, 115, 109]));
  await writeFile(join(pageDir, 'chromium-lowprio.sh'), '#!/bin/sh\n');
  server = await serveRenderPage(filmDir, pageDir);
});
afterAll(async () => {
  await server.close();
  await rm(tmp, { recursive: true, force: true });
});

describe('serveRenderPage', () => {
  it('listens on the loopback address only, on a port of its own', () => {
    const url = new URL(server.url);
    expect(url.hostname).toBe('127.0.0.1');
    expect(Number(url.port)).toBeGreaterThan(0);
    expect(server.address).toBe('127.0.0.1');
    expect(url.pathname).toMatch(/^\/[0-9a-f]{32}\/$/);
  });

  it('serves the page, its script and the WASM', async () => {
    const page = await get(base());
    expect([page.status, page.type]).toEqual([200, 'text/html; charset=utf-8']);
    expect(page.body.toString()).toContain('<title>render</title>');
    const script = await get(`${base()}page/main.js`);
    expect([script.status, script.type]).toEqual([200, 'text/javascript; charset=utf-8']);
    const wasm = await get(`${base()}page/dotlottie-player.wasm`);
    expect([wasm.status, wasm.type]).toEqual([200, 'application/wasm']);
  });

  it('serves the files talkie.json lists', async () => {
    const film = await get(`${base()}film/talkie.json`);
    expect([film.status, film.type]).toEqual([200, 'application/json']);
    expect(JSON.parse(film.body.toString()).title).toBe('Talkie mini');
    for (const path of ['a/s01.json', 'a/s02.json', 'captions/en.vtt', 'u/narration.opus']) {
      expect((await get(`${base()}film/${path}`)).status, path).toBe(200);
    }
    expect((await get(`${base()}film/poster.png`)).type).toBe('image/png');
  });

  it('answers HEAD without a body and refuses other methods', async () => {
    const head = await get(`${base()}film/talkie.json`, { method: 'HEAD' });
    expect([head.status, head.body.length]).toEqual([200, 0]);
    expect((await get(`${base()}film/talkie.json`, { method: 'POST' })).status).toBe(405);
  });

  it('refuses files the film does not list', async () => {
    expect((await get(`${base()}film/secret.txt`)).status).toBe(404);
    expect((await get(`${base()}film/manifest.json`)).status).toBe(404);
    expect((await get(`${base()}page/chromium-lowprio.sh`)).status).toBe(404);
    expect((await get(`${base()}page/index.html`)).status).toBe(404);
    expect((await get(`${base()}film/`)).status).toBe(404);
  });

  it('refuses traversal, plain and encoded', async () => {
    for (const path of [
      'film/../outside.json',
      'film/..%2Foutside.json',
      'film/%2e%2e/outside.json',
      'film/a/../../outside.json',
      'film/a%2F..%2F..%2Foutside.json',
      'film//etc/passwd',
      'film/%00',
      'film/a/s01.json%00.png',
      'page/../film/secret.txt',
      'film/%E0%A4%A',
    ]) {
      const r = await get(base() + path);
      expect(r.status, path).toBe(404);
      expect(r.body.toString(), path).not.toContain('outside');
    }
  });

  it('refuses a listed path that is a symlink out of the film', async () => {
    const dir = join(tmp, 'linked');
    await cp(FIXTURE_FILM, dir, { recursive: true });
    await rm(join(dir, 'a', 's02.json'));
    await symlink(join(tmp, 'outside.json'), join(dir, 'a', 's02.json'));
    const linked = await serveRenderPage(dir, pageDir);
    try {
      const { port, pathname } = new URL(linked.url);
      const res = await fetch(`http://127.0.0.1:${port}${pathname}film/a/s02.json`);
      expect(res.status).toBe(404);
      const ok = await fetch(`http://127.0.0.1:${port}${pathname}film/a/s01.json`);
      expect(ok.status).toBe(200);
    } finally {
      await linked.close();
    }
  });

  it('refuses requests without the secret path, or for another host name', async () => {
    expect((await get('/')).status).toBe(404);
    expect((await get('/film/talkie.json')).status).toBe(404);
    expect((await get(`/${'0'.repeat(32)}/film/talkie.json`)).status).toBe(404);
    expect((await get(`${base()}film/talkie.json`, { host: 'evil.example' })).status).toBe(404);
  });

  it('fails clearly when the film or the page is not there', async () => {
    await expect(serveRenderPage(join(tmp, 'nope'), pageDir)).rejects.toThrow(/talkie\.json/);
    await expect(serveRenderPage(filmDir, join(tmp, 'nope'))).rejects.toThrow(/not built/);
  });

  it('stops listening when closed, and close is safe to call twice', async () => {
    const extra = await serveRenderPage(filmDir, pageDir);
    await extra.close();
    await extra.close();
    await expect(fetch(extra.url)).rejects.toThrow();
  });
});
