import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomic } from '@/lib/storage/json';
import { commentDir, versionDir } from '@/lib/storage/paths';
import { saveSession, saveVideo, writeCommentMeta } from '@/lib/storage/repo';
import type {
  CaptureEvent,
  CommentKind,
  CommentRef,
  CommentState,
  CommentStatus,
  Moment,
  ProbeInfo,
  Transcript,
  TranscriptWord,
} from '@/lib/types';

// Seeds the current DATA_DIR with one video the way the server leaves it after processing:
// v1 and v2, two reviewers, three moment comments, one general, one empty and one failed.
// Nothing here needs ffmpeg: stills and audio are placeholder bytes.

export const VIDEO_ID = 'launch-film-ab12';

export const SEED = {
  sarahV1: '00000000-0000-4000-8000-000000000001',
  sarah: '00000000-0000-4000-8000-000000000002',
  dev: '00000000-0000-4000-8000-000000000003',
  /** Sarah on v1, paused at 0:03.0. */
  previous: '10000000-0000-4000-8000-000000000001',
  /** Sarah, paused at 0:03.0. */
  sarahMoment: '20000000-0000-4000-8000-000000000001',
  sarahGeneral: '20000000-0000-4000-8000-000000000002',
  sarahEmpty: '20000000-0000-4000-8000-000000000003',
  /** Dev, paused at 0:12.4, with the basic transcript and three moments. */
  devMoment: '30000000-0000-4000-8000-000000000001',
  /** Dev, paused at 0:20.0, then scrolled back to 0:18.0. */
  devScrolled: '30000000-0000-4000-8000-000000000002',
  /** Dev, paused at 0:25.0, transcription failed. */
  devFailed: '30000000-0000-4000-8000-000000000003',
} as const;

export const SEED_PROBE: ProbeInfo = {
  width: 1920,
  height: 1080,
  fps: 25,
  frameDuration: 1 / 25,
  duration: 93.4,
  codec: 'h264',
  pixFmt: 'yuv420p',
  hasAudio: true,
};

const fixture = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url));

export const seedRef = (sessionId: string, commentId: string): CommentRef => ({
  videoId: VIDEO_ID,
  sessionId,
  commentId,
});

function words(text: string, from: number): TranscriptWord[] {
  return text
    .replace(/[.,]/g, '')
    .split(' ')
    .map((word, i) => ({ word, start: from + i * 0.4, end: from + i * 0.4 + 0.3 }));
}

function transcriptOf(text: string): Transcript {
  const w = words(text, 0.5);
  return {
    text,
    language: 'English',
    duration: 4,
    words: w,
    segments: [{ start: 0.5, end: w[w.length - 1].end, text }],
  };
}

const pause = (vt: number): Moment => ({
  id: 'moment-01',
  t: 0,
  vt,
  x: 0.5,
  y: 0.5,
  inside: true,
  zoom: null,
  kinds: ['pause'],
  reasons: ['pause'],
});

type StatusPatch = Partial<Omit<CommentStatus, 'steps'>> & {
  steps?: Partial<CommentStatus['steps']>;
};

interface SeedComment {
  sessionId: string;
  commentId: string;
  version: number;
  kind?: CommentKind;
  vt: number | null;
  startedAt: string;
  durationMs?: number;
  state: CommentState;
  updatedAt: string;
  steps?: Partial<CommentStatus['steps']>;
  error?: string | null;
  transcript?: Transcript;
  moments?: Moment[];
  events?: CaptureEvent[];
  zoomStills?: string[];
}

async function writeComment(c: SeedComment): Promise<void> {
  const ref = seedRef(c.sessionId, c.commentId);
  const dir = commentDir(ref);
  const durationMs = c.durationMs ?? 4000;
  await writeCommentMeta(ref, {
    commentId: c.commentId,
    sessionId: c.sessionId,
    version: c.version,
    kind: c.kind ?? 'moment',
    pausedAtVideoTime: c.vt,
    startedAt: c.startedAt,
    endedAt: new Date(Date.parse(c.startedAt) + durationMs).toISOString(),
    durationMs,
    audioMime: 'audio/webm;codecs=opus',
    totalChunks: 2,
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
  const done = c.state === 'done';
  const status: CommentStatus = {
    state: c.state,
    steps: {
      audio: 'done',
      silence: 'done',
      transcribe: done ? 'done' : 'pending',
      moments: done ? 'done' : 'pending',
      stills: done ? 'done' : 'pending',
      clip: 'pending',
      ...c.steps,
    },
    error: c.error ?? null,
    attempts: 1,
    updatedAt: c.updatedAt,
  };
  await writeJsonAtomic(join(dir, 'status.json'), status);
  await writeJsonAtomic(join(dir, 'events.json'), c.events ?? []);
  await writeFile(join(dir, 'audio.webm'), 'webm');
  if (c.transcript) await writeJsonAtomic(join(dir, 'transcript.json'), c.transcript);
  if (c.moments) {
    await writeJsonAtomic(join(dir, 'moments.json'), c.moments);
    await mkdir(join(dir, 'render'), { recursive: true });
    await writeFile(join(dir, 'render', 'overview.jpg'), 'jpg');
    for (const m of c.moments) await writeFile(join(dir, 'render', `${m.id}.jpg`), 'jpg');
    for (const id of c.zoomStills ?? []) {
      await writeFile(join(dir, 'render', `${id}-zoom.jpg`), 'jpg');
    }
  }
}

/** Writes status.json for a seeded comment again, e.g. to move its state or `updatedAt`. */
export async function setSeedStatus(ref: CommentRef, patch: StatusPatch): Promise<void> {
  const path = join(commentDir(ref), 'status.json');
  const current = JSON.parse(await readFile(path, 'utf8')) as CommentStatus;
  await writeJsonAtomic(path, {
    ...current,
    ...patch,
    steps: { ...current.steps, ...patch.steps },
  });
}

export async function seedExport(): Promise<void> {
  await saveVideo({
    videoId: VIDEO_ID,
    title: 'Launch film',
    token: 'seed-token-seed-token-seed-token-seed-token',
    createdAt: '2026-11-18T09:00:00.000Z',
    latestVersion: 2,
    versions: [
      { version: 1, importedAt: '2026-11-18T09:00:00.000Z', originalFilename: 'film-v1.mp4' },
      { version: 2, importedAt: '2026-11-20T09:00:00.000Z', originalFilename: 'film-v2.mp4' },
    ],
  });
  for (const version of [1, 2]) {
    await writeJsonAtomic(join(versionDir(VIDEO_ID, version), 'probe.json'), SEED_PROBE);
  }

  const session = (sessionId: string, version: number, reviewerName: string, startedAt: string) =>
    saveSession({
      sessionId,
      videoId: VIDEO_ID,
      version,
      reviewerName,
      userAgent: 'vitest',
      startedAt,
      doneAt: null,
    });
  await session(SEED.sarahV1, 1, 'Sarah', '2026-11-18T10:00:00.000Z');
  await session(SEED.sarah, 2, 'Sarah', '2026-11-20T10:00:00.000Z');
  await session(SEED.dev, 2, 'Dev', '2026-11-20T11:00:00.000Z');

  await writeComment({
    sessionId: SEED.sarahV1,
    commentId: SEED.previous,
    version: 1,
    vt: 3,
    startedAt: '2026-11-18T10:01:00.000Z',
    state: 'done',
    updatedAt: '2026-11-18T10:02:00.000Z',
    transcript: transcriptOf('The opening title is too small.'),
    moments: [pause(3)],
  });

  await writeComment({
    sessionId: SEED.sarah,
    commentId: SEED.sarahMoment,
    version: 2,
    vt: 3,
    startedAt: '2026-11-20T10:01:00.000Z',
    state: 'done',
    updatedAt: '2026-11-20T10:02:00.000Z',
    transcript: transcriptOf('Tighten up the cut, please.'),
    moments: [pause(3)],
  });
  await writeComment({
    sessionId: SEED.sarah,
    commentId: SEED.sarahGeneral,
    version: 2,
    kind: 'general',
    vt: null,
    startedAt: '2026-11-20T10:05:00.000Z',
    state: 'done',
    updatedAt: '2026-11-20T10:06:00.000Z',
    steps: { stills: 'skipped', clip: 'skipped' },
    transcript: transcriptOf('Overall the pacing feels good.'),
  });
  await writeComment({
    sessionId: SEED.sarah,
    commentId: SEED.sarahEmpty,
    version: 2,
    vt: 5,
    startedAt: '2026-11-20T10:03:00.000Z',
    state: 'empty',
    updatedAt: '2026-11-20T10:04:00.000Z',
    steps: { transcribe: 'skipped', moments: 'skipped', stills: 'skipped', clip: 'skipped' },
  });

  const basic = JSON.parse(await readFile(fixture('transcript-basic.json'), 'utf8')) as Transcript;
  const events = JSON.parse(await readFile(fixture('events-basic.json'), 'utf8')) as CaptureEvent[];
  await writeComment({
    sessionId: SEED.dev,
    commentId: SEED.devMoment,
    version: 2,
    vt: 12.4,
    startedAt: '2026-11-20T11:01:00.000Z',
    durationMs: 34120,
    state: 'done',
    updatedAt: '2026-11-20T11:02:00.000Z',
    transcript: {
      text: basic.text,
      language: basic.language,
      duration: basic.duration,
      words: basic.words,
      segments: basic.segments.map(({ start, end, text }) => ({ start, end, text })),
    },
    events,
    moments: [
      pause(12.4),
      {
        id: 'moment-02',
        t: 3200,
        vt: 12.4,
        x: 0.12,
        y: 0.08,
        inside: true,
        zoom: null,
        kinds: ['word', 'dwell'],
        reasons: ["word 'this' at 3.2s", 'dwell 0.9s'],
      },
      {
        id: 'moment-03',
        t: 7800,
        vt: 12.4,
        x: 0.48,
        y: 0.81,
        inside: true,
        zoom: { scale: 2.5, originX: 0.48, originY: 0.81 },
        kinds: ['click', 'zoom', 'word'],
        reasons: ['click', 'zoomed in', "word 'here' at 7.8s"],
      },
    ],
    zoomStills: ['moment-03'],
  });
  await writeComment({
    sessionId: SEED.dev,
    commentId: SEED.devScrolled,
    version: 2,
    vt: 20,
    startedAt: '2026-11-20T11:05:00.000Z',
    state: 'done',
    updatedAt: '2026-11-20T11:06:00.000Z',
    transcript: transcriptOf('Back here the music drops out.'),
    events: [
      { t: 0, type: 'pointer', x: 0.5, y: 0.5, inside: true, vt: 20 },
      { t: 1000, type: 'seek', from: 20, to: 18, via: 'scrollbar' },
      { t: 1100, type: 'pointer', x: 0.6, y: 0.4, inside: true, vt: 18 },
    ],
    moments: [pause(20)],
  });
  await writeComment({
    sessionId: SEED.dev,
    commentId: SEED.devFailed,
    version: 2,
    vt: 25,
    startedAt: '2026-11-20T11:08:00.000Z',
    state: 'failed',
    updatedAt: '2026-11-20T11:09:00.000Z',
    steps: { transcribe: 'failed', moments: 'done', stills: 'done' },
    error: 'Groq transcription failed (503)',
    moments: [pause(25)],
  });
}
