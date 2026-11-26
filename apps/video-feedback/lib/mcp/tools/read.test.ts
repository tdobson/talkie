import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writePipelineStatus } from '@/lib/pipeline/pipeline-status';
import { writeJsonAtomic } from '@/lib/storage/json';
import { commentDir } from '@/lib/storage/paths';
import { writeCommentMeta } from '@/lib/storage/repo';
import type { CommentStatus, Moment } from '@/lib/types';
import {
  SEED,
  seedExport,
  seedRef,
  seedTalkieExport,
  setSeedStatus,
  TALKIE_VIDEO_ID,
  VIDEO_ID,
} from '@/test/fixtures/export-seed';
import { withTmpData } from '@/test/helpers/tmpData';
import { MAX_IMAGES_PER_ANSWER } from '../comments';
import { mcpPost } from '../http';
import { setShrinkForTests } from '../images';
import { mcpServer } from '../index';
import type { Content, Tool, ToolContext, ToolResult } from '../types';
import { readTools } from './read';

const BASE = 'https://fb.example.com';
const ctx: ToolContext = {
  identity: null,
  baseUrl: BASE,
  signal: new AbortController().signal,
  progress: () => {},
};

const tool = (name: string): Tool => {
  const found = readTools.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

/** Calls a tool the way the server does: a ToolError comes back as an error result. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  try {
    return await tool(name).run(args, ctx);
  } catch (err) {
    if (err instanceof Error && err.name === 'ToolError') {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
    throw err;
  }
}

const texts = (r: ToolResult) =>
  r.content.filter((c): c is Extract<Content, { type: 'text' }> => c.type === 'text');
const header = (r: ToolResult) => texts(r)[0].text;
const commentIds = (r: ToolResult) =>
  texts(r)
    .map((c) => /^## Comment (\S+)/.exec(c.text)?.[1])
    .filter((id): id is string => id !== undefined);
const imageCount = (r: ToolResult) => r.content.filter((c) => c.type === 'image').length;
const json = (r: ToolResult) => JSON.parse(texts(r)[1].text);

let cleanup: () => Promise<void>;
let restoreShrink: () => void;

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  restoreShrink = setShrinkForTests(async (input) => Buffer.concat([Buffer.from('small:'), input]));
  await seedExport();
});

afterEach(async () => {
  restoreShrink();
  await cleanup();
});

/** A finished comment by Dev on version 2 with `count` moments, each with a still. */
async function seedBusyComment(commentId: string, vt: number, count: number): Promise<void> {
  const ref = seedRef(SEED.dev, commentId);
  const dir = commentDir(ref);
  await writeCommentMeta(ref, {
    commentId,
    sessionId: SEED.dev,
    version: 2,
    kind: 'moment',
    pausedAtVideoTime: vt,
    startedAt: '2026-11-20T11:30:00.000Z',
    endedAt: '2026-11-20T11:30:05.000Z',
    durationMs: 5000,
    audioMime: 'audio/webm;codecs=opus',
    totalChunks: 1,
    player: {
      containerWidth: 1280,
      containerHeight: 720,
      videoWidth: 1920,
      videoHeight: 1080,
      contentRect: { x: 0, y: 0, width: 1280, height: 720 },
      fullscreen: false,
      devicePixelRatio: 1,
    },
  });
  const status: CommentStatus = {
    state: 'done',
    steps: {
      audio: 'done',
      silence: 'done',
      transcribe: 'done',
      moments: 'done',
      stills: 'done',
      clip: 'done',
    },
    error: null,
    attempts: 1,
    updatedAt: '2026-11-20T11:31:00.000Z',
  };
  await writeJsonAtomic(join(dir, 'status.json'), status);
  await writeJsonAtomic(join(dir, 'transcript.json'), {
    text: 'Lots of pointing here.',
    language: 'English',
    duration: 5,
    words: [],
    segments: [],
  });
  const moments: Moment[] = Array.from({ length: count }, (_, i) => ({
    id: `moment-${String(i + 1).padStart(2, '0')}`,
    t: i * 100,
    vt,
    x: 0.5,
    y: 0.5,
    inside: true,
    zoom: null,
    kinds: ['click'],
    reasons: ['click'],
  }));
  await writeJsonAtomic(join(dir, 'moments.json'), moments);
  await mkdir(join(dir, 'render'), { recursive: true });
  await writeFile(join(dir, 'render', 'overview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  for (const m of moments) {
    await writeFile(join(dir, 'render', `${m.id}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }
}

describe('list_videos', () => {
  it('lists every video newest first, with the latest version kind and counts', async () => {
    await seedTalkieExport();
    const r = await call('list_videos');
    expect(r.isError).toBeUndefined();
    expect(texts(r)[0].text).toContain('get_feedback');
    const videos = json(r);
    expect(videos.map((v: { videoId: string }) => v.videoId).sort()).toEqual(
      [TALKIE_VIDEO_ID, VIDEO_ID].sort()
    );
    const launch = videos.find((v: { videoId: string }) => v.videoId === VIDEO_ID);
    expect(launch).toEqual({
      videoId: VIDEO_ID,
      title: 'Launch film',
      kind: 'mp4',
      latestVersion: 2,
      versions: 2,
      reviewUrl: `${BASE}/r/seed-token-seed-token-seed-token-seed-token`,
      onLatestVersion: {
        sessions: 2,
        comments: 6,
        // Done moment comments whose clip has not been rendered yet count here too.
        processingOrClipRendering: expect.any(Number),
        failedComments: 1,
        emptyComments: 1,
        lastActivity: '2026-11-20T11:09:00.000Z',
      },
    });
    const talkie = videos.find((v: { videoId: string }) => v.videoId === TALKIE_VIDEO_ID);
    expect(talkie.kind).toBe('talkie');
  });

  it('names the pending count for what it is: not ready yet, or only the clip rendering', async () => {
    const before = json(await call('list_videos')).find(
      (v: { videoId: string }) => v.videoId === VIDEO_ID
    ).onLatestVersion.processingOrClipRendering;
    // A comment whose words and stills are ready but whose clip is not counts as well.
    await setSeedStatus(seedRef(SEED.dev, SEED.devFailed), {
      state: 'done',
      steps: {
        audio: 'done',
        silence: 'done',
        transcribe: 'done',
        moments: 'done',
        stills: 'done',
        clip: 'pending',
      },
    });
    const launch = json(await call('list_videos')).find(
      (v: { videoId: string }) => v.videoId === VIDEO_ID
    );
    expect(launch.onLatestVersion).not.toHaveProperty('pendingProcessing');
    expect(launch.onLatestVersion.processingOrClipRendering).toBe(before + 1);
    const description = tool('list_videos').description;
    expect(description).toContain('processingOrClipRendering');
    expect(description).toContain('only the video clip is still rendering');
  });

  it('filters by title or id, in any case', async () => {
    await seedTalkieExport();
    const byTitle = json(await call('list_videos', { query: 'LAUNCH' }));
    expect(byTitle.map((v: { videoId: string }) => v.videoId)).toEqual([VIDEO_ID]);
    const byId = json(await call('list_videos', { query: 'cd34' }));
    expect(byId.map((v: { videoId: string }) => v.videoId)).toEqual([TALKIE_VIDEO_ID]);
    const none = await call('list_videos', { query: 'nothing like it' });
    expect(texts(none)).toHaveLength(1);
    expect(header(none)).toContain('list_videos with no query');
  });

  it('says so when there are no videos, and points at upload_film', async () => {
    const fresh = await withTmpData();
    try {
      const r = await call('list_videos');
      expect(header(r)).toContain('no videos');
      expect(header(r)).toContain('upload_film');
    } finally {
      await fresh.cleanup();
    }
  });
});

describe('get_video', () => {
  it('gives versions, reviewers with comments by state, and what is processing', async () => {
    await setSeedStatus(seedRef(SEED.dev, SEED.devScrolled), { state: 'processing' });
    await writePipelineStatus({
      pid: 1,
      updatedAt: new Date().toISOString(),
      comments: {
        running: {
          videoId: VIDEO_ID,
          sessionId: SEED.dev,
          commentId: SEED.devScrolled,
          since: new Date().toISOString(),
        },
        waiting: 0,
      },
      clips: { running: null, waiting: 0 },
    });

    const r = await call('get_video', { videoId: VIDEO_ID });
    expect(r.isError).toBeUndefined();
    expect(header(r)).toContain('1 comment is still processing');
    const v = json(r);
    expect(v.reviewUrl).toBe(`${BASE}/r/seed-token-seed-token-seed-token-seed-token`);
    expect(v.versions).toEqual([
      expect.objectContaining({
        version: 1,
        importedAt: '2026-11-18T09:00:00.000Z',
        originalFilename: 'film-v1.mp4',
        kind: 'mp4',
        sessions: 1,
        comments: 1,
        commentsByState: { done: 1 },
      }),
      expect.objectContaining({
        version: 2,
        sessions: 2,
        comments: 6,
        commentsByState: { done: 3, empty: 1, failed: 1, processing: 1 },
      }),
    ]);
    expect(v.reviewers).toEqual([
      expect.objectContaining({ reviewerName: 'Sarah', version: 1, doneAt: 'still watching' }),
      expect.objectContaining({
        reviewerName: 'Sarah',
        version: 2,
        comments: { done: 2, empty: 1 },
      }),
      expect.objectContaining({
        reviewerName: 'Dev',
        version: 2,
        comments: { done: 1, processing: 1, failed: 1 },
      }),
    ]);
    expect(v.processing).toEqual([
      expect.objectContaining({
        commentId: SEED.devScrolled,
        reviewerName: 'Dev',
        version: 2,
        state: 'processing',
        workerOnItNow: true,
      }),
    ]);
  });

  it('names list_videos for an unknown video', async () => {
    const r = await call('get_video', { videoId: 'no-such-video' });
    expect(r.isError).toBe(true);
    expect(header(r)).toContain('list_videos');
  });
});

describe('get_feedback', () => {
  it('lists the latest version in film order, counts empty pauses and earlier versions', async () => {
    const r = await call('get_feedback', { videoId: VIDEO_ID });
    expect(r.isError).toBeUndefined();
    const h = header(r);
    expect(h).toContain('# Feedback on "Launch film"');
    expect(h).toContain('Version 2 of 2');
    expect(h).toContain('Kind: mp4');
    expect(h).toContain('"Sarah" (still watching), "Dev" (still watching)');
    expect(h).toContain('Showing comments 1-5 of 5');
    expect(h).toContain('Empty pauses (paused but said nothing): 1, not listed');
    expect(h).toContain('Earlier version 1: 1 comment');
    expect(h).not.toContain('More:');
    // Film order, the general comment last; the empty pause is left out.
    expect(commentIds(r)).toEqual([
      SEED.sarahMoment,
      SEED.devMoment,
      SEED.devScrolled,
      SEED.devFailed,
      SEED.sarahGeneral,
    ]);
  });

  it('lists the empty pauses when asked', async () => {
    const r = await call('get_feedback', { videoId: VIDEO_ID, includeEmpty: true });
    expect(commentIds(r)).toHaveLength(6);
    expect(commentIds(r)).toContain(SEED.sarahEmpty);
    expect(header(r)).toContain('1, listed');
  });

  it('pages through the comments and says where the next page starts', async () => {
    const first = await call('get_feedback', { videoId: VIDEO_ID, limit: 2 });
    expect(commentIds(first)).toEqual([SEED.sarahMoment, SEED.devMoment]);
    expect(header(first)).toContain('Showing comments 1-2 of 5');
    expect(header(first)).toContain('More: call again with offset 2.');

    const last = await call('get_feedback', { videoId: VIDEO_ID, limit: 2, offset: 4 });
    expect(commentIds(last)).toEqual([SEED.sarahGeneral]);
    expect(header(last)).toContain('Showing comments 5-5 of 5');
    expect(header(last)).not.toContain('More:');

    const beyond = await call('get_feedback', { videoId: VIDEO_ID, offset: 9 });
    expect(commentIds(beyond)).toEqual([]);
    expect(header(beyond)).toContain('No comments at offset 9');
  });

  it('sorts newest first when asked', async () => {
    const r = await call('get_feedback', { videoId: VIDEO_ID, sort: 'recent', limit: 2 });
    expect(commentIds(r)).toEqual([SEED.devFailed, SEED.devScrolled]);
  });

  it('sorts oldest first, so a page already read stays put as new comments arrive', async () => {
    const r = await call('get_feedback', { videoId: VIDEO_ID, sort: 'oldest' });
    // Empty pauses stay in the list sorted this way, so offsets do not move under the reader.
    expect(commentIds(r)).toEqual([
      SEED.sarahMoment,
      SEED.sarahEmpty,
      SEED.sarahGeneral,
      SEED.devMoment,
      SEED.devScrolled,
      SEED.devFailed,
    ]);
    expect(header(r)).toContain('oldest first');
    expect(header(r)).toContain('offsets stay put');

    const first = await call('get_feedback', { videoId: VIDEO_ID, sort: 'oldest', limit: 2 });
    expect(header(first)).toContain('More: call again with offset 2.');
    // A new comment (recorded after the others) joins the end, so offset 2 skips nothing.
    await seedBusyComment('60000000-0000-4000-8000-000000000009', 0.1, 1);
    const next = await call('get_feedback', {
      videoId: VIDEO_ID,
      sort: 'oldest',
      offset: 2,
    });
    expect(commentIds(next)).toEqual([
      SEED.sarahGeneral,
      SEED.devMoment,
      SEED.devScrolled,
      SEED.devFailed,
      '60000000-0000-4000-8000-000000000009',
    ]);

    const schema = tool('get_feedback').inputSchema as unknown as {
      properties: { sort: { enum: string[]; description: string } };
    };
    expect(schema.properties.sort.enum).toEqual(['film', 'recent', 'oldest']);
    expect(schema.properties.sort.description).toContain('while a review is still going');
  });

  it('narrows to comments that ended after "since", and by reviewer', async () => {
    const since = await call('get_feedback', {
      videoId: VIDEO_ID,
      since: '2026-11-20T11:00:00Z',
    });
    expect(commentIds(since)).toEqual([SEED.devMoment, SEED.devScrolled, SEED.devFailed]);
    expect(header(since)).toContain('ended after 2026-11-20T11:00:00.000Z');

    const sarah = await call('get_feedback', { videoId: VIDEO_ID, reviewer: 'SAR' });
    expect(commentIds(sarah)).toEqual([SEED.sarahMoment, SEED.sarahGeneral]);
    expect(header(sarah)).toContain('reviewer name contains "SAR"');

    const nobody = await call('get_feedback', { videoId: VIDEO_ID, reviewer: 'zed' });
    expect(commentIds(nobody)).toEqual([]);
    expect(header(nobody)).toContain('Try without "since" or "reviewer"');

    const bad = await call('get_feedback', { videoId: VIDEO_ID, since: 'last tuesday' });
    expect(bad.isError).toBe(true);
    expect(header(bad)).toContain('ISO time');
  });

  it('counts the comments still processing', async () => {
    await setSeedStatus(seedRef(SEED.dev, SEED.devScrolled), { state: 'processing' });
    const r = await call('get_feedback', { videoId: VIDEO_ID });
    expect(header(r)).toContain('Still processing: 1 comment');
    expect(header(r)).toContain('wait_for_feedback');
  });

  it('sends each still as an image after a text label', async () => {
    const r = await call('get_feedback', { videoId: VIDEO_ID, images: 'overview' });
    // One overview each for the four frame comments; the general comment has none.
    expect(imageCount(r)).toBe(4);
    r.content.forEach((c, i) => {
      if (c.type !== 'image') return;
      expect(c.mimeType).toBe('image/jpeg');
      expect(Buffer.from(c.data, 'base64').toString('utf8').startsWith('small:')).toBe(true);
      const label = r.content[i - 1];
      expect(label.type).toBe('text');
      expect(label.type === 'text' && label.text).toMatch(/^Still of comment \S+: overview/);
    });
    expect(imageCount(await call('get_feedback', { videoId: VIDEO_ID, images: 'none' }))).toBe(0);
  });

  it('stops adding images at the cap, and says how many were left out', async () => {
    const busy = [
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000003',
    ];
    for (const [i, id] of busy.entries()) await seedBusyComment(id, 1 + i * 0.5, 12);

    const r = await call('get_feedback', { videoId: VIDEO_ID, images: 'moments' });
    expect(imageCount(r)).toBe(MAX_IMAGES_PER_ANSWER);
    // Every comment's text still comes: only stills are dropped.
    expect(commentIds(r).slice(0, 3)).toEqual(busy);
    expect(commentIds(r)).toHaveLength(8);
    expect(header(r)).toContain(`${MAX_IMAGES_PER_ANSWER} stills shown`);
    expect(header(r)).toMatch(/\d+ more left out/);
    expect(header(r)).toContain('get_comment');
    // The header, then every text, then the stills: a cut, if any, takes images, not words.
    const kinds = r.content.map((c) => c.type);
    const lastComment = r.content.findLastIndex(
      (c) => c.type === 'text' && c.text.startsWith('## Comment')
    );
    expect(kinds.indexOf('image')).toBeGreaterThan(lastComment);
  });

  it('ends a page early when the text is long, and the next offset skips nothing', async () => {
    const busy = [
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000003',
    ];
    // 300 moments make a comment's text about 20,000 characters: two do not fit one answer.
    for (const [i, id] of busy.entries()) await seedBusyComment(id, 1 + i * 0.5, 300);

    const first = await call('get_feedback', { videoId: VIDEO_ID, images: 'none' });
    expect(commentIds(first)).toEqual([busy[0]]);
    expect(header(first)).toContain('Showing comments 1-1 of 8');
    expect(header(first)).toContain('This page stops at 1 comment, not 8');
    expect(header(first)).toContain('More: call again with offset 1.');

    // Follow the offsets the answers give: every comment comes exactly once.
    const seen: string[] = [];
    let offset = 0;
    for (let i = 0; i < 10; i++) {
      const r = await call('get_feedback', { videoId: VIDEO_ID, images: 'none', offset });
      seen.push(...commentIds(r));
      const text = texts(r)
        .map((t) => t.text)
        .join('\n');
      expect(text.length).toBeLessThan(60_000);
      const more = /More: call again with offset (\d+)\./.exec(header(r));
      if (!more) break;
      offset = Number(more[1]);
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
    expect(seen.slice(0, 3)).toEqual(busy);
  });

  it('shows every version with "all", each comment carrying its version', async () => {
    const r = await call('get_feedback', { videoId: VIDEO_ID, version: 'all' });
    expect(header(r)).toContain('Versions: all, 1 (mp4), 2 (mp4)');
    expect(commentIds(r)[0]).toBe(SEED.previous);
    const first = texts(r).find((t) => t.text.startsWith(`## Comment ${SEED.previous}`));
    expect(first?.text).toContain('Version 1,');
  });

  it('says what to do for an unknown video or version', async () => {
    const video = await call('get_feedback', { videoId: 'no-such-video' });
    expect(video.isError).toBe(true);
    expect(header(video)).toContain('list_videos');

    const version = await call('get_feedback', { videoId: VIDEO_ID, version: 9 });
    expect(version.isError).toBe(true);
    expect(header(version)).toContain('no version 9');
    expect(header(version)).toContain('get_video');
  });

  it('gives the Talkie scene of each moment for a Talkie film', async () => {
    await seedTalkieExport();
    const r = await call('get_feedback', { videoId: TALKIE_VIDEO_ID });
    expect(header(r)).toContain('Kind: talkie');
    expect(texts(r).some((t) => t.text.includes('Talkie: scene'))).toBe(true);
  });
});

describe('get_comment', () => {
  it('gives one comment with every still and its words', async () => {
    const r = await call('get_comment', { videoId: VIDEO_ID, commentId: SEED.devMoment });
    expect(r.isError).toBeUndefined();
    expect(header(r)).toContain('version 2 (mp4)');
    expect(commentIds(r)).toEqual([SEED.devMoment]);
    // The overview, three moments and one zoomed view.
    expect(imageCount(r)).toBe(5);
    const body = texts(r).find((t) => t.text.startsWith('## Comment'))?.text ?? '';
    expect(body).toContain('Words (');
    const labels = texts(r)
      .filter((t) => t.text.startsWith('Still of comment'))
      .map((t) => t.text);
    expect(labels).toHaveLength(5);
    expect(labels.some((l) => l.includes('moment-03 zoomed in'))).toBe(true);

    const plain = await call('get_comment', {
      videoId: VIDEO_ID,
      commentId: SEED.devMoment,
      images: 'none',
      words: false,
    });
    expect(imageCount(plain)).toBe(0);
    expect(
      texts(plain)
        .map((t) => t.text)
        .join('\n')
    ).not.toContain('Words (');
  });

  it('caps the stills of a busy comment, and says how to pick fewer', async () => {
    const id = '60000000-0000-4000-8000-000000000001';
    await seedBusyComment(id, 1, 12);
    const r = await call('get_comment', { videoId: VIDEO_ID, commentId: id });
    // The overview and twelve moments: 13 stills, of which 8 fit.
    expect(imageCount(r)).toBe(MAX_IMAGES_PER_ANSWER);
    expect(header(r)).toContain(`${MAX_IMAGES_PER_ANSWER} stills shown, 5 more left out`);
    expect(header(r)).toContain('images: "moments"');
    expect(header(r)).toContain('"overview"');
    expect(commentIds(r)).toEqual([id]);

    const few = await call('get_comment', { videoId: VIDEO_ID, commentId: id, images: 'overview' });
    expect(imageCount(few)).toBe(1);
    expect(header(few)).not.toContain('left out');
  });

  it('finds a comment on an earlier version', async () => {
    const r = await call('get_comment', { videoId: VIDEO_ID, commentId: SEED.previous });
    expect(header(r)).toContain('version 1 (mp4)');
  });

  it('says how to find comment ids when there is no such comment', async () => {
    const r = await call('get_comment', {
      videoId: VIDEO_ID,
      commentId: '99999999-0000-4000-8000-000000000000',
    });
    expect(r.isError).toBe(true);
    expect(header(r)).toContain('get_feedback');
  });
});

describe('over MCP', () => {
  const post = (body: unknown) =>
    mcpPost(
      new Request('http://x/api/admin/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      }),
      mcpServer,
      null
    );

  it('lists the read tools as read-only, with closed argument schemas', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const { tools } = (await res.json()).result;
    for (const name of ['list_videos', 'get_video', 'get_feedback', 'get_comment']) {
      const t = tools.find((x: { name: string }) => x.name === name);
      expect(t).toBeDefined();
      expect(t.annotations).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(t.description).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('answers get_feedback with text and labelled images', async () => {
    const res = await post({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_feedback', arguments: { videoId: VIDEO_ID, limit: 1 } },
    });
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('More: call again with offset 1.');
    const kinds = result.content.map((c: Content) => c.type);
    expect(kinds).toEqual(['text', 'text', 'text', 'image']);
    expect(result.content[2].text).toContain(`Still of comment ${SEED.sarahMoment}`);
  });

  it('turns a bad argument into a message the model can act on', async () => {
    const res = await post({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_feedback', arguments: { videoId: VIDEO_ID, limit: 99 } },
    });
    const { result } = await res.json();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"limit" must be at most 25');
  });
});
