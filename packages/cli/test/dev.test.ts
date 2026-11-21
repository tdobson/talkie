import { spawnSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { devCommand } from '../src/commands/dev';
import { devPage } from '../src/dev/page';
import { startDev, type DevServer } from '../src/dev/server';
import { ALIAS, builtPlayer, voicedProject } from './helpers/project';

jest.setTimeout(180_000);

describe('the preview page', () => {
  const html = devPage({
    title: 'Mini <film>',
    scenes: [
      { id: 'one', start: 0 },
      { id: 'two', start: 10.967 },
    ],
  });
  test('holds the real player in debug mode, with its WASM served from here', () => {
    expect(html).toContain(
      '<talkie-player src="/film/" debug wasm-url="/dotlottie-player.wasm"></talkie-player>'
    );
    expect(html).toContain('<script type="module" src="/talkie-player.js"></script>');
    expect(html).toContain('<title>Mini &lt;film&gt;</title>');
  });
  test('lists the scenes to click, and has frame step buttons', () => {
    expect(html).toContain('<button type="button" data-seek="0">one</button>');
    expect(html).toContain('<button type="button" data-seek="10.967">two</button>');
    expect(html).toContain('<button type="button" data-step="-1">Back one frame</button>');
    expect(html).toContain('<button type="button" data-step="1">Forward one frame</button>');
  });
  test('reloads on a server event and keeps its place through ?t=', () => {
    expect(html).toContain("new EventSource('/events')");
    expect(html).toContain("searchParams.get('t')");
    expect(html).toContain("searchParams.set('t'");
  });
  test('has no em or en dashes', () => {
    expect(html).not.toMatch(/[–—]/);
  });
});

test('the command takes a folder and a port', () => {
  expect(devCommand.options.map((o) => o.long)).toEqual(['--port']);
  expect(devCommand.registeredArguments.map((a) => a.name())).toEqual(['dir']);
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const describeFfmpeg = hasFfmpeg ? describe : describe.skip;

describeFfmpeg('needs ffmpeg (skipped when ffmpeg is not on the path)', () => {
  let dir = '';
  let playerDir = '';
  let server: DevServer;
  beforeAll(async () => {
    dir = await voicedProject();
    playerDir = await builtPlayer();
    server = await startDev(dir, { port: 0, alias: ALIAS, playerDir, log: () => {} });
  });
  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
    await rm(playerDir, { recursive: true, force: true });
  });

  test('builds once and serves the page, the film and the player', async () => {
    expect(server.url).toBe(`http://localhost:${server.port}/`);
    const page = await fetch(server.url);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await page.text();
    expect(html).toContain('<talkie-player src="/film/" debug');
    expect(html).toContain('data-seek="10.967">two</button>');

    const film = await fetch(new URL('/film/talkie.json', server.url));
    expect(film.headers.get('content-type')).toBe('application/json');
    expect(film.headers.get('cache-control')).toBe('no-store');
    expect(((await film.json()) as { title: string }).title).toBe('Mini film');

    const player = await fetch(new URL('/talkie-player.js', server.url));
    expect(player.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await player.text()).toContain('talkie-player');
    const wasm = await fetch(new URL('/dotlottie-player.wasm', server.url));
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
    await wasm.arrayBuffer();
  });

  test('answers range requests, which audio seeking needs', async () => {
    const url = new URL('/film/u/narration.m4a', server.url);
    const whole = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const part = await fetch(url, { headers: { range: 'bytes=10-19' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 10-19/${whole.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(whole.slice(10, 20));
    const tail = await fetch(url, { headers: { range: 'bytes=-5' } });
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(whole.slice(-5));
    const past = await fetch(url, { headers: { range: `bytes=${whole.length}-` } });
    expect(past.status).toBe(416);
  });

  test('serves nothing outside the film', async () => {
    const out = await fetch(new URL('/film/%2e%2e/%2e%2e/talkie.config.ts', server.url));
    expect(out.status).toBe(404);
    expect((await fetch(new URL('/nothing', server.url))).status).toBe(404);
  });

  /** Read server-sent events until one of the wanted kind arrives. */
  async function nextEvent(kind: string, after: () => Promise<void>) {
    const abort = new AbortController();
    const response = await fetch(new URL('/events', server.url), { signal: abort.signal });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    await after();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          throw new Error(`the event stream ended before a ${kind} event`);
        }
        text += decoder.decode(value, { stream: true });
        const found = text
          .split('\n\n')
          .slice(0, -1)
          .find((block) => block.startsWith(`event: ${kind}\n`));
        if (found) {
          return JSON.parse(found.split('\ndata: ')[1]!) as Record<string, unknown>;
        }
      }
    } finally {
      abort.abort();
    }
  }

  test('a saved scene is rebuilt and the page is told to reload', async () => {
    const scene = join(dir, 'scenes/one.ts');
    const before = await readFile(join(dir, 'dist/film/a/one.json'), 'utf8');
    const event = await nextEvent('reload', async () => {
      await writeFile(scene, (await readFile(scene, 'utf8')).replace('scale: 2', 'scale: 3'));
    });
    expect(event).toEqual({ rebuilt: ['one'] });
    expect(await readFile(join(dir, 'dist/film/a/one.json'), 'utf8')).not.toBe(before);
  });

  test('a build that fails is reported to the page, and the next good save recovers', async () => {
    const scene = join(dir, 'scenes/two.ts');
    const good = await readFile(scene, 'utf8');
    const problem = await nextEvent('problem', () => writeFile(scene, 'export default 5;\n'));
    expect(typeof problem.message).toBe('string');
    expect(problem.message).not.toBe('');
    const event = await nextEvent('reload', () => writeFile(scene, good));
    expect(event.rebuilt).toEqual(expect.any(Array));
  });
});
