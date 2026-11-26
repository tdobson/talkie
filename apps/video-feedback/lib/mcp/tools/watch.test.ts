import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FILES } from '@/lib/pipeline/steps/types';
import { writeJsonAtomic } from '@/lib/storage/json';
import { commentDir } from '@/lib/storage/paths';
import {
  createSession,
  createVideo,
  saveSession,
  saveVideo,
  writeCommentMeta,
} from '@/lib/storage/repo';
import type {
  CommentMeta,
  CommentRef,
  CommentState,
  CommentStatus,
  SessionRecord,
  VideoRecord,
} from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { mcpPost } from '../http';
import { setShrinkForTests } from '../images';
import type { McpServer } from '../server';
import { type ToolContext, ToolError, type ToolResult } from '../types';
import { resetSweepForTests, watchesDir } from '../watches';
import { MAX_COMMENTS, setWatchTimingForTests, takeScanStatsForTests, watchTools } from './watch';

const tool = watchTools[0];

let dir: string;
let cleanup: () => Promise<void>;
let restoreTiming: () => void;
let restoreShrink: () => void;

beforeEach(async () => {
  ({ dir, cleanup } = await withTmpData());
  // One "second" of timeoutSeconds is 10 ms here, so a 5 s timeout takes 50 ms.
  restoreTiming = setWatchTimingForTests({
    pollMs: 10,
    burstMs: 40,
    progressMs: 30,
    secondMs: 10,
  });
  restoreShrink = setShrinkForTests(async (b) => b);
  resetSweepForTests();
});
afterEach(async () => {
  restoreTiming();
  restoreShrink();
  await cleanup();
});

async function seedVideo(title: string): Promise<VideoRecord> {
  const video = await createVideo(title);
  video.latestVersion = 1;
  video.versions = [
    { version: 1, importedAt: '2026-10-01T00:00:00.000Z', originalFilename: 'v1.mp4' },
  ];
  await saveVideo(video);
  return video;
}

function seedSession(video: VideoRecord, name: string): Promise<SessionRecord> {
  return createSession(video.videoId, 1, name, 'ua');
}

async function setState(
  ref: CommentRef,
  state: CommentState,
  opts: { attempts?: number; clip?: 'pending' | 'done' } = {}
): Promise<void> {
  const status: CommentStatus = {
    state,
    steps: {
      audio: 'done',
      silence: 'done',
      transcribe: 'done',
      moments: 'done',
      stills: 'done',
      clip: opts.clip ?? 'pending',
    },
    error: null,
    attempts: opts.attempts ?? 1,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(join(commentDir(ref), FILES.status), status);
}

let clock = 0;
async function seedComment(
  session: SessionRecord,
  state: CommentState,
  opts: { said?: string; overview?: boolean; attempts?: number } = {}
): Promise<CommentRef> {
  const ref = { videoId: session.videoId, sessionId: session.sessionId, commentId: randomUUID() };
  clock += 1;
  const startedAt = new Date(Date.UTC(2026, 10, 1, 9, 0, clock)).toISOString();
  const meta: CommentMeta = {
    commentId: ref.commentId,
    sessionId: ref.sessionId,
    version: 1,
    kind: 'moment',
    pausedAtVideoTime: 1,
    startedAt,
    endedAt: startedAt,
    durationMs: 3000,
    audioMime: 'audio/webm',
    totalChunks: 1,
    player: {
      containerWidth: 640,
      containerHeight: 360,
      videoWidth: 640,
      videoHeight: 360,
      contentRect: { x: 0, y: 0, width: 640, height: 360 },
      fullscreen: false,
      devicePixelRatio: 1,
    },
  };
  await writeCommentMeta(ref, meta);
  if (opts.said) {
    await writeJsonAtomic(join(commentDir(ref), FILES.transcript), {
      text: opts.said,
      words: [],
    });
  }
  if (opts.overview) {
    const render = join(commentDir(ref), FILES.renderDir);
    await mkdir(render, { recursive: true });
    await writeFile(join(render, 'overview.jpg'), Buffer.from('fake jpeg'));
  }
  await setState(ref, state, { attempts: opts.attempts });
  return ref;
}

function context(signal = new AbortController().signal, lines: string[] = []): ToolContext {
  return {
    identity: null,
    baseUrl: 'https://vf.example',
    signal,
    progress: (m) => lines.push(m),
  };
}

const call = (args: Record<string, unknown>, ctx = context()) => tool.run(args, ctx);

function text(result: ToolResult): string {
  return result.content.map((c) => (c.type === 'text' ? c.text : '[image]')).join('\n');
}

function cursorOf(result: ToolResult): string {
  const m = /^Cursor: (\S+) \(pass this/.exec(text(result));
  if (!m) throw new Error(`no cursor in: ${text(result)}`);
  return m[1];
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A first call: it never waits, and gives the cursor to wait on. */
async function start(args: Record<string, unknown>): Promise<string> {
  return cursorOf(await call(args));
}

function header(result: ToolResult): string {
  const first = result.content[0];
  return first.type === 'text' ? first.text : '';
}

describe('wait_for_feedback', () => {
  it('is long running, changes state, and is strict about its arguments', () => {
    expect(tool.name).toBe('wait_for_feedback');
    expect(tool.longRunning).toBe(true);
    // Each call acknowledges the last answer: not read only, and not idempotent.
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(
      ['cursor', 'from', 'images', 'timeoutSeconds', 'videoId'].sort()
    );
    expect(tool.description).toMatch(/without a cursor, never waits/);
    expect(tool.description).not.toMatch(/[\u2013\u2014]/);
  });

  it('a first call from "now" answers at once with a cursor, ignoring what had finished', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    const old = await seedComment(s, 'done', { said: 'An old remark' });

    const started = Date.now();
    const first = await call({ videoId: video.videoId, timeoutSeconds: 900 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(cursorOf(first)).toMatch(/^[A-Za-z0-9_-]{22}\.0$/);
    expect(text(first)).toMatch(/Watch started from now: nothing yet/);
    expect(text(first)).toMatch(/Call wait_for_feedback again with this cursor to wait/);

    const result = await call({ cursor: cursorOf(first), timeoutSeconds: 5 });
    const t = text(result);
    expect(t).toMatch(/Nothing new yet/);
    expect(t).not.toContain(old.commentId);
    expect(cursorOf(result)).toBe(cursorOf(first));
  });

  it('a first call from "start" answers at once with the backlog, header then texts then images', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    const a = await seedComment(s, 'done', { said: 'Make the tiles redder', overview: true });
    const b = await seedComment(s, 'empty');
    await seedComment(s, 'receiving');

    const started = Date.now();
    const result = await call({ videoId: video.videoId, from: 'start', timeoutSeconds: 900 });
    expect(Date.now() - started).toBeLessThan(1000);
    const t = text(result);
    expect(cursorOf(result)).toMatch(/\.1$/);
    expect(t).toMatch(/Arrived: 1 comment, and 1 empty pause\./);
    expect(header(result)).toContain(
      `"Roof film" (${video.videoId}): 1 new comment (reviewer names as typed: "Ann"). Ids: ${a.commentId}.`
    );
    // An empty pause is only counted, not shown in full.
    expect(header(result)).toContain(
      `Empty pauses on "Roof film" (${video.videoId}): 1 (reviewer names as typed: "Ann")`
    );
    expect(header(result)).toContain(b.commentId);
    expect(t).toContain(`## Comment ${a.commentId}`);
    expect(t).not.toContain(`## Comment ${b.commentId}`);
    expect(t).toContain('Make the tiles redder');
    expect(t).toMatch(/being recorded or uploaded/);

    const kinds = result.content.map((c) => c.type);
    expect(kinds.filter((k) => k === 'image')).toHaveLength(1);
    const lastWords = result.content.findLastIndex(
      (c) => c.type === 'text' && c.text.startsWith('## Comment')
    );
    expect(lastWords).toBeGreaterThan(0);
    expect(kinds.indexOf('image')).toBeGreaterThan(lastWords);

    // Both are delivered once the cursor comes back: nothing is repeated.
    const quiet = await call({ cursor: cursorOf(result), timeoutSeconds: 5 });
    expect(text(quiet)).toMatch(/Nothing new yet/);
  });

  it('a first call from "start" with nothing there yet gives a cursor to wait on', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    const first = await call({ videoId: video.videoId, from: 'start' });
    expect(cursorOf(first)).toMatch(/\.0$/);
    expect(text(first)).toMatch(/nothing has finished yet/);
    const ref = await seedComment(s, 'done');
    expect(text(await call({ cursor: cursorOf(first), timeoutSeconds: 5 }))).toContain(
      ref.commentId
    );
  });

  it('returns a comment promptly when it finishes during the wait', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    const ref = await seedComment(s, 'processing');
    const c = await start({ videoId: video.videoId });

    const started = Date.now();
    const pending = call({ cursor: c, timeoutSeconds: 900 });
    await wait(40);
    await setState(ref, 'done');
    const result = await pending;
    expect(Date.now() - started).toBeLessThan(2000);
    expect(text(result)).toContain(`## Comment ${ref.commentId}`);
    expect(text(result)).toMatch(/Nothing is processing right now/);
  });

  it('waits a moment for the rest of a burst while more is processing', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    const first = await seedComment(s, 'processing');
    const second = await seedComment(s, 'processing');
    const c = await start({ videoId: video.videoId });

    const pending = call({ cursor: c, timeoutSeconds: 900 });
    await wait(30);
    await setState(first, 'done');
    await wait(15);
    await setState(second, 'done');
    const t = text(await pending);
    expect(t).toContain(first.commentId);
    expect(t).toContain(second.commentId);
  });

  it('acknowledges with the latest cursor, offers again on an older one, and never repeats', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    const a = await seedComment(s, 'done');
    const first = await call({ videoId: video.videoId, from: 'start' });
    const c1 = cursorOf(first);
    expect(text(first)).toContain(a.commentId);

    const b = await seedComment(s, 'done');
    const second = await call({ cursor: c1, timeoutSeconds: 5 });
    const c2 = cursorOf(second);
    expect(text(second)).toContain(b.commentId);
    expect(text(second)).not.toContain(a.commentId);

    // The answer with c2 was lost: the agent calls with c1 again and gets b again.
    const again = await call({ cursor: c1, timeoutSeconds: 5 });
    const c3 = cursorOf(again);
    expect(text(again)).toContain(b.commentId);
    expect(text(again)).not.toContain(a.commentId);
    expect(c3).not.toBe(c2);

    // c3 acknowledges b: nothing is repeated.
    const quiet = await call({ cursor: c3, timeoutSeconds: 5 });
    expect(text(quiet)).toMatch(/Nothing new yet/);
    expect(cursorOf(quiet)).toBe(c3);

    const watchId = c3.split('.')[0];
    const stored = JSON.parse(await readFile(join(watchesDir(), `${watchId}.json`), 'utf8'));
    expect(stored.delivered.sort()).toEqual([`c:${a.commentId}:1`, `c:${b.commentId}:1`].sort());
    expect(stored.offered).toBeNull();
    expect(stored.videoId).toBe(video.videoId);
    expect(watchesDir().startsWith(dir)).toBe(true);
  });

  it('reports a reprocessed comment again, but not a clip that finishes later', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    const ref = await seedComment(s, 'done', { said: 'First take' });
    const first = await call({ videoId: video.videoId, from: 'start' });
    expect(text(first)).toContain(ref.commentId);
    let c = cursorOf(first);

    // The clip is made later by a clip-only run: attempts stay the same, so nothing new.
    await setState(ref, 'done', { attempts: 1, clip: 'done' });
    const quiet = await call({ cursor: c, timeoutSeconds: 5 });
    expect(text(quiet)).toMatch(/Nothing new yet/);
    c = cursorOf(quiet);

    // Reprocessed: back to queued, then done with one more attempt.
    await setState(ref, 'queued', { attempts: 1 });
    const pending = call({ cursor: c, timeoutSeconds: 900 });
    await wait(30);
    await setState(ref, 'done', { attempts: 2 });
    const again = await pending;
    expect(text(again)).toContain(`## Comment ${ref.commentId}`);
    const after = await call({ cursor: cursorOf(again), timeoutSeconds: 5 });
    expect(text(after)).toMatch(/Nothing new yet/);
  });

  it('tells when a reviewer pressed Done, quoting the name they typed', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    await seedComment(s, 'done');
    await seedComment(s, 'queued');
    const c = await start({ videoId: video.videoId });

    await saveSession({ ...s, doneAt: new Date().toISOString() });
    const result = await call({ cursor: c, timeoutSeconds: 5 });
    const t = text(result);
    expect(t).toMatch(/Arrived: 1 reviewer pressed Done/);
    expect(t).toContain(
      `The reviewer who typed the name "Ann" pressed Done on Roof film v1 (${video.videoId}): their review is complete (2 comments). 1 of them still processing`
    );
    const after = await call({ cursor: cursorOf(result), timeoutSeconds: 5 });
    expect(text(after)).toMatch(/Nothing new yet/);
  });

  it('a timeout gives back the same cursor, and the next call continues from it', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    const c = await start({ videoId: video.videoId });
    const quiet = await call({ videoId: video.videoId, cursor: c, timeoutSeconds: 5 });
    expect(cursorOf(quiet)).toBe(c);

    const ref = await seedComment(s, 'done');
    const next = await call({ cursor: c, timeoutSeconds: 5 });
    expect(text(next)).toContain(ref.commentId);
  });

  it('stops quickly when the client goes away, and delivers nothing', async () => {
    const video = await seedVideo('Roof film');
    const c = await start({ videoId: video.videoId });
    const controller = new AbortController();
    const started = Date.now();
    const pending = call({ cursor: c, timeoutSeconds: 900 }, context(controller.signal));
    await wait(30);
    controller.abort();
    const result = await pending;
    expect(Date.now() - started).toBeLessThan(1000);
    expect(text(result)).toMatch(/Stopped/);
    expect(cursorOf(result)).toBe(c);
  });

  it('a newer call on the same watch stops the older one, which is told to start its own', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    const c = await start({ videoId: video.videoId });
    const older = call({ cursor: c, timeoutSeconds: 900 });
    await wait(30);
    const newer = call({ cursor: c, timeoutSeconds: 900 });
    const t = text(await older);
    expect(t).toMatch(/newer wait_for_feedback call/);
    expect(t).toMatch(/Only one caller may wait on a cursor at a time/);
    expect(t).toMatch(/start your own watch instead by calling without a cursor/);
    const ref = await seedComment(s, 'done');
    expect(text(await newer)).toContain(ref.commentId);
  });

  it('sends a progress line now and then while it waits', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    await seedComment(s, 'queued');
    const c = await start({ videoId: video.videoId });
    const lines: string[] = [];
    await call({ cursor: c, timeoutSeconds: 10 }, context(new AbortController().signal, lines));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toBe('waiting: 1 comment still processing');
  });

  it('refuses a cursor for another video, and an unknown or malformed cursor', async () => {
    const roof = await seedVideo('Roof film');
    const wall = await seedVideo('Wall film');
    const c = await start({ videoId: roof.videoId });
    await expect(call({ videoId: wall.videoId, cursor: c })).rejects.toThrow(
      new RegExp(`watches the video "${roof.videoId}", not "${wall.videoId}"`)
    );
    await expect(call({ cursor: 'nonsense' })).rejects.toThrow(ToolError);
    await expect(call({ cursor: 'AAAAAAAAAAAAAAAAAAAAAA.0' })).rejects.toThrow(
      /without a cursor: from "now"/
    );
    // A cursor from the future of a real watch is not one the server gave out.
    await expect(call({ cursor: `${c.split('.')[0]}.7` })).rejects.toThrow(ToolError);
    await expect(call({ videoId: 'no-such-video' })).rejects.toThrow(/list_videos/);
  });

  it('watches every video when videoId is left out, and names the video of each comment', async () => {
    const roof = await seedVideo('Roof film');
    const wall = await seedVideo('Wall film');
    const c = await start({});
    const a = await seedComment(await seedSession(roof, 'Ann'), 'done');
    const b = await seedComment(await seedSession(wall, 'Bob'), 'failed');
    const result = await call({ cursor: c, timeoutSeconds: 5 });
    const t = text(result);
    expect(t).toContain(
      `"Roof film" (${roof.videoId}): 1 new comment (reviewer names as typed: "Ann")`
    );
    expect(t).toContain(
      `"Wall film" (${wall.videoId}): 1 new comment (reviewer names as typed: "Bob")`
    );
    expect(t).toContain(`# "Roof film" (${roof.videoId})`);
    expect(t).toContain(a.commentId);
    expect(t).toContain(b.commentId);
    // An all-videos cursor cannot be used for one video.
    await expect(call({ videoId: roof.videoId, cursor: cursorOf(result) })).rejects.toThrow(
      /watches every video/
    );
  });

  it(`gives at most ${MAX_COMMENTS} comments per answer, lists each id, and the rest at once next`, async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    const refs: CommentRef[] = [];
    for (let i = 0; i < MAX_COMMENTS + 2; i++) refs.push(await seedComment(s, 'done'));
    const first = await call({ videoId: video.videoId, from: 'start' });
    expect(text(first)).toMatch(new RegExp(`Arrived: ${MAX_COMMENTS} comments\\.`));
    expect(text(first)).toMatch(/2 more comments are ready/);
    const given = refs.filter((r) => text(first).includes(`## Comment ${r.commentId}`));
    expect(given).toHaveLength(MAX_COMMENTS);
    for (const r of given) expect(header(first)).toContain(r.commentId);
    const started = Date.now();
    const rest = await call({ cursor: cursorOf(first), timeoutSeconds: 900 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(text(rest)).toMatch(/Arrived: 2 comments/);
    for (const r of refs.filter((x) => !given.includes(x))) {
      expect(header(rest)).toContain(r.commentId);
    }
  });

  it('keeps long comments within the text budget: only the packed ones count as given', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    const refs: CommentRef[] = [];
    // About 6,000 characters each: five fit the 30,000 budget.
    for (let i = 0; i < 8; i++) {
      refs.push(await seedComment(s, 'done', { said: `remark${i} ${'word '.repeat(1200)}` }));
    }
    const first = await call({ videoId: video.videoId, from: 'start' });
    const shown = refs.filter((r) => text(first).includes(`## Comment ${r.commentId}`));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(8);
    const rest = refs.filter((r) => !shown.includes(r));
    // Every comment shown is in the header, and none that was left out.
    for (const r of shown) expect(header(first)).toContain(r.commentId);
    for (const r of rest) expect(header(first)).not.toContain(r.commentId);
    expect(header(first)).toContain(`${rest.length} more comment`);

    const watchId = cursorOf(first).split('.')[0];
    const stored = JSON.parse(await readFile(join(watchesDir(), `${watchId}.json`), 'utf8'));
    expect(stored.offered.keys.sort()).toEqual(shown.map((r) => `c:${r.commentId}:1`).sort());

    const next = await call({ cursor: cursorOf(first), timeoutSeconds: 5 });
    for (const r of rest.slice(0, 1)) expect(text(next)).toContain(`## Comment ${r.commentId}`);
    for (const r of shown) expect(text(next)).not.toContain(r.commentId);
  });

  it('sends at most 8 images per answer and says how many stills were left out', async () => {
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    for (let i = 0; i < 10; i++) await seedComment(s, 'done', { overview: true });
    const first = await call({ videoId: video.videoId, from: 'start' });
    expect(first.content.filter((c) => c.type === 'image')).toHaveLength(8);
    expect(header(first)).toMatch(/2 stills left out to keep this answer small/);
    expect(header(first)).toMatch(/Arrived: 10 comments\./);
  });

  it('counts empty pauses in the header without a block each', async () => {
    const video = await seedVideo('Roof film');
    const sarah = await seedSession(video, 'Sarah');
    const tom = await seedSession(video, 'Tom');
    const c = await start({ videoId: video.videoId });
    const e1 = await seedComment(sarah, 'empty');
    const e2 = await seedComment(tom, 'empty');
    const result = await call({ cursor: c, timeoutSeconds: 5 });
    expect(result.content).toHaveLength(1);
    expect(header(result)).toMatch(/Arrived: 2 empty pauses\./);
    expect(header(result)).toMatch(/: 2 \(reviewer names as typed: "(Sarah|Tom)", "(Sarah|Tom)"\)/);
    expect(header(result)).toContain(e1.commentId);
    expect(header(result)).toContain(e2.commentId);
    const after = await call({ cursor: cursorOf(result), timeoutSeconds: 5 });
    expect(text(after)).toMatch(/Nothing new yet/);
  });

  it('shares one scan between callers waiting on the same video, never two at once', async () => {
    const restore = setWatchTimingForTests({
      pollMs: 30,
      burstMs: 40,
      progressMs: 1000,
      secondMs: 30,
    });
    try {
      const video = await seedVideo('Roof film');
      const cursors = [
        await start({ videoId: video.videoId }),
        await start({ videoId: video.videoId }),
        await start({ videoId: video.videoId }),
      ];
      takeScanStatsForTests();
      // Five "seconds" of 30 ms: about five polls each, so fifteen scans if nothing were shared.
      await Promise.all(cursors.map((c) => call({ cursor: c, timeoutSeconds: 5 })));
      const stats = takeScanStatsForTests();
      expect(stats.maxRunning).toBe(1);
      expect(stats.runs).toBeLessThanOrEqual(9);
      expect(stats.runs).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it('streams over MCP HTTP: open at once, then the comment', async () => {
    const server: McpServer = { tools: watchTools, prompts: [], instructions: '' };
    const video = await seedVideo('Roof film');
    const s = await seedSession(video, 'Ann');
    const ref = await seedComment(s, 'processing', { said: 'The gutter is wrong' });
    const c = await start({ videoId: video.videoId });

    const res = await mcpPost(
      new Request('http://x/api/admin/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'wait_for_feedback',
            arguments: { cursor: c, timeoutSeconds: 900 },
          },
        }),
      }),
      server,
      null,
      { keepAliveMs: 20 }
    );
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let body = '';
    const first = await reader.read();
    body += decoder.decode(first.value);
    expect(body).toContain(': waiting');

    // The watch was made before the comment finished, so it is new feedback whenever it lands.
    await setState(ref, 'done');
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      body += decoder.decode(value);
    }
    const last = body.trim().split('\n\n').at(-1) ?? '';
    const message = JSON.parse(last.slice('event: message\ndata: '.length));
    expect(message.id).toBe(1);
    const t = message.result.content.map((x: { text?: string }) => x.text ?? '').join('\n');
    expect(t).toMatch(/^Cursor: \S+\.1 \(pass this/);
    expect(t).toContain(ref.commentId);
    expect(t).toContain('The gutter is wrong');
  });
});
