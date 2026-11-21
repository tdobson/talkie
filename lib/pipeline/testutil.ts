import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOk } from '@/lib/media/run';
import { putChunk } from '@/lib/storage/chunks';
import { writeJsonAtomic } from '@/lib/storage/json';
import { commentDir, versionDir } from '@/lib/storage/paths';
import { createSession, createVideo, saveVideo, writeCommentMeta } from '@/lib/storage/repo';
import type {
  CaptureEvent,
  CommentMeta,
  CommentRef,
  CommentState,
  ProbeInfo,
  VideoRecord,
} from '@/lib/types';
import { initialStatus, updateStatus } from './status';

// Test-only helpers: seed a video, a session and uploaded comments the way the reviewer API
// leaves them (chunks, event batches, meta.json, status.json).

export const PROBE: ProbeInfo = {
  width: 640,
  height: 360,
  fps: 25,
  frameDuration: 1 / 25,
  duration: 4,
  codec: 'h264',
  pixFmt: 'yuv420p',
  hasAudio: true,
};

export async function seedVideo(title = 'Launch film'): Promise<VideoRecord> {
  const video = await createVideo(title);
  video.latestVersion = 1;
  video.versions = [
    { version: 1, importedAt: new Date().toISOString(), originalFilename: 'film.mp4' },
  ];
  await saveVideo(video);
  await writeJsonAtomic(join(versionDir(video.videoId, 1), 'probe.json'), PROBE);
  return video;
}

export interface SeedOptions {
  video?: VideoRecord;
  sessionId?: string;
  /** Audio bytes to split into chunks. Leave out for a comment with no chunks. */
  audio?: Buffer;
  parts?: number;
  events?: CaptureEvent[];
  state?: CommentState;
  meta?: Partial<CommentMeta>;
}

export async function seedComment(opts: SeedOptions = {}): Promise<{
  ref: CommentRef;
  dir: string;
  video: VideoRecord;
}> {
  const video = opts.video ?? (await seedVideo());
  const sessionId =
    opts.sessionId ?? (await createSession(video.videoId, 1, 'Sarah', 'vitest')).sessionId;
  const ref: CommentRef = { videoId: video.videoId, sessionId, commentId: randomUUID() };
  const dir = commentDir(ref);
  const parts = opts.audio ? (opts.parts ?? 3) : 0;
  const events = [...(opts.events ?? [])];

  if (opts.audio) {
    const size = Math.ceil(opts.audio.length / parts);
    const perChunk = Math.ceil(events.length / parts);
    // Stored out of order on purpose: assembly must sort by sequence number.
    for (const seq of [...Array(parts).keys()].reverse()) {
      await putChunk(
        dir,
        seq,
        opts.audio.subarray(seq * size, (seq + 1) * size),
        events.slice(seq * perChunk, (seq + 1) * perChunk)
      );
    }
  }

  const meta: CommentMeta = {
    commentId: ref.commentId,
    sessionId,
    version: 1,
    kind: 'moment',
    pausedAtVideoTime: 1.2,
    startedAt: '2026-11-21T10:00:00.000Z',
    endedAt: '2026-11-21T10:00:03.000Z',
    durationMs: 3000,
    audioMime: 'audio/webm;codecs=opus',
    totalChunks: parts,
    player: {
      containerWidth: 1280,
      containerHeight: 720,
      videoWidth: 640,
      videoHeight: 360,
      contentRect: { x: 0, y: 0, width: 1280, height: 720 },
      fullscreen: false,
      devicePixelRatio: 1,
    },
    ...opts.meta,
  };
  await writeCommentMeta(ref, meta);
  await updateStatus(ref, { ...initialStatus(), state: opts.state ?? 'queued' });
  return { ref, dir, video };
}

/** Encodes any audio file as WebM/Opus, like a browser recording, and returns the bytes. */
export async function asWebm(src: string): Promise<Buffer> {
  const tmp = await mkdtemp(join(tmpdir(), 'vf-webm-'));
  try {
    const out = join(tmp, 'out.webm');
    await runOk('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      src,
      '-c:a',
      'libopus',
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
