import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { audioFileName, FILES } from '@/lib/pipeline/steps/types';
import { readJson } from '@/lib/storage/json';
import { commentDir, ID_RE, versionDir } from '@/lib/storage/paths';
import { getVideo, listComments, listSessions, readCommentMeta } from '@/lib/storage/repo';
import type {
  CaptureEvent,
  CommentKind,
  CommentRef,
  CommentState,
  CommentStatus,
  Moment,
  ProbeInfo,
  SessionRecord,
  Transcript,
  TranscriptWord,
} from '@/lib/types';

export interface ExportOptions {
  version: number | 'latest' | 'all';
  clips: boolean;
  since: string | null;
  partial: boolean;
}

export interface WordPointer {
  x: number;
  y: number;
  inside: boolean;
  vt: number;
}

export interface ExportComment {
  commentId: string;
  sessionId: string;
  reviewerName: string;
  kind: CommentKind;
  version: number;
  pausedAtVideoTime: number | null;
  pausedAtFrame: number | null;
  durationMs: number;
  videoTimeRange: [number, number] | null;
  state: CommentState;
  micLost: boolean;
  transcript: {
    text: string;
    words: (TranscriptWord & { pointer: WordPointer | null })[];
  } | null;
  moments: (Moment & { image: string; zoomImage: string | null })[];
  /** Paths inside the zip. For a comment under `previous`, relative to `previous/v<n>/`. */
  files: { overview: string | null; audio: string; clip: string | null; events: string };
  updatedAt: string;
  startedAt: string;
}

export interface ExportModel {
  schemaVersion: 1;
  exportedAt: string;
  video: {
    videoId: string;
    title: string;
    version: number | 'all';
    fps: number;
    width: number;
    height: number;
    duration: number;
  };
  sessions: SessionRecord[];
  comments: ExportComment[];
  previous: { version: number; comments: ExportComment[] }[];
}

/** The video or the version asked for does not exist. */
export class ExportNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportNotFoundError';
  }
}

/** Reads `version`, `clips`, `since` and `partial` from a query string. Null when invalid. */
export function parseExportQuery(params: URLSearchParams): ExportOptions | null {
  const rawVersion = params.get('version') ?? 'latest';
  let version: ExportOptions['version'];
  if (rawVersion === 'latest' || rawVersion === 'all') {
    version = rawVersion;
  } else if (/^[1-9]\d{0,8}$/.test(rawVersion)) {
    version = Number(rawVersion);
  } else {
    return null;
  }

  let since: string | null = null;
  const rawSince = params.get('since');
  if (rawSince !== null && rawSince !== '') {
    // Only real ISO timestamps: Date.parse alone accepts all sorts of loose strings.
    if (
      !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(rawSince)
    ) {
      return null;
    }
    const ms = Date.parse(rawSince);
    if (Number.isNaN(ms)) return null;
    since = new Date(ms).toISOString();
  }

  const flag = (name: string) => params.get(name) === '1' || params.get(name) === 'true';
  return { version, clips: flag('clips'), since, partial: flag('partial') };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** A derived file that is missing or unreadable is simply left out of the export. */
async function readOptional<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path);
  } catch {
    return null;
  }
}

type PointerLike = Extract<CaptureEvent, { type: 'pointer' | 'click' }>;

const isPointerLike = (e: CaptureEvent): e is PointerLike =>
  e.type === 'pointer' || e.type === 'click';

/** For each word, the last pointer position recorded at or before the word started. */
function withPointers(
  words: TranscriptWord[],
  events: CaptureEvent[]
): (TranscriptWord & { pointer: WordPointer | null })[] {
  const pointers = events.filter(isPointerLike).sort((a, b) => a.t - b.t);
  return words.map((w) => {
    const ms = w.start * 1000;
    let found: PointerLike | null = null;
    for (const p of pointers) {
      if (p.t > ms) break;
      found = p;
    }
    return {
      word: w.word,
      start: w.start,
      end: w.end,
      pointer: found ? { x: found.x, y: found.y, inside: found.inside, vt: found.vt } : null,
    };
  });
}

/** The lowest and highest video time shown while the comment was recorded. */
function timeRange(paused: number | null, events: CaptureEvent[]): [number, number] | null {
  if (paused === null) return null;
  const times = [paused];
  for (const e of events) {
    if (e.type === 'seek' && Number.isFinite(e.to)) times.push(e.to);
  }
  return [Math.min(...times), Math.max(...times)];
}

interface Loaded {
  comment: ExportComment;
  endedAt: string | null;
  status: CommentStatus;
}

async function loadComment(
  ref: CommentRef,
  session: SessionRecord,
  opts: ExportOptions,
  probes: Map<number, ProbeInfo | null>
): Promise<Loaded | null> {
  const dir = commentDir(ref);
  const meta = await readCommentMeta(ref).catch(() => null);
  const status = await readOptional<CommentStatus>(join(dir, FILES.status));
  // No status, or still uploading: there is nothing to export yet.
  if (meta === null || status === null || status.state === 'receiving') return null;

  const cid = ref.commentId;
  const media = (name: string) => `media/${cid}/${name}`;
  const render = join(dir, FILES.renderDir);

  const eventsRaw = await readOptional<CaptureEvent[]>(join(dir, FILES.events));
  const events = Array.isArray(eventsRaw) ? eventsRaw : [];
  const transcript = await readOptional<Transcript>(join(dir, FILES.transcript));
  const momentsRaw = await readOptional<Moment[]>(join(dir, FILES.moments));
  const moments = Array.isArray(momentsRaw) ? momentsRaw : [];

  const fps = probes.get(meta.version)?.fps ?? 0;
  const paused = meta.pausedAtVideoTime;

  const exportMoments: ExportComment['moments'] = [];
  for (const m of moments) {
    if (!/^moment-\d{2,}$/.test(m.id)) continue;
    exportMoments.push({
      ...m,
      image: media(`${m.id}.jpg`),
      zoomImage: (await exists(join(render, `${m.id}-zoom.jpg`)))
        ? media(`${m.id}-zoom.jpg`)
        : null,
    });
  }

  const comment: ExportComment = {
    commentId: cid,
    sessionId: ref.sessionId,
    reviewerName: session.reviewerName,
    kind: meta.kind,
    version: meta.version,
    pausedAtVideoTime: paused,
    pausedAtFrame: paused !== null && fps > 0 ? Math.round(paused * fps) : null,
    durationMs: meta.durationMs ?? 0,
    videoTimeRange: timeRange(paused, events),
    state: status.state,
    micLost: meta.micLost === true,
    transcript:
      transcript && typeof transcript.text === 'string'
        ? {
            text: transcript.text.trim(),
            words: withPointers(Array.isArray(transcript.words) ? transcript.words : [], events),
          }
        : null,
    moments: exportMoments,
    files: {
      overview: (await exists(join(render, 'overview.jpg'))) ? media('overview.jpg') : null,
      audio: media(audioFileName(meta.audioMime)),
      clip: opts.clips && (await exists(join(render, FILES.clip))) ? media(FILES.clip) : null,
      events: `raw/${cid}/${FILES.events}`,
    },
    updatedAt: status.updatedAt,
    startedAt: meta.startedAt,
  };
  return { comment, endedAt: meta.endedAt, status };
}

/** True while the export should wait for this comment. */
function isPending(loaded: Loaded, opts: ExportOptions): boolean {
  const { state, steps } = loaded.status;
  if (state === 'queued' || state === 'processing') return true;
  // The clip renders after the comment is `done`, so it only holds up an export that wants it.
  return (
    opts.clips && state === 'done' && loaded.comment.kind === 'moment' && steps?.clip === 'pending'
  );
}

/**
 * Collects everything the export needs for one video. Returns `{ pending }` instead when
 * included comments are still being processed, unless `opts.partial` is set.
 * Throws `ExportNotFoundError` for an unknown video or version.
 */
export async function buildExportModel(
  videoId: string,
  opts: ExportOptions,
  now: Date
): Promise<ExportModel | { pending: number }> {
  const video = ID_RE.test(videoId) ? await getVideo(videoId) : null;
  if (video === null) throw new ExportNotFoundError(`No video with the id "${videoId}".`);

  const known = video.versions.map((v) => v.version).sort((a, b) => a - b);
  const target = opts.version === 'latest' ? video.latestVersion : opts.version;
  if (target !== 'all' && !known.includes(target)) {
    throw new ExportNotFoundError(`The video "${videoId}" has no version ${target}.`);
  }
  if (known.length === 0) throw new ExportNotFoundError(`The video "${videoId}" has no versions.`);

  const probes = new Map<number, ProbeInfo | null>();
  for (const v of known) {
    probes.set(v, await readOptional<ProbeInfo>(join(versionDir(videoId, v), 'probe.json')));
  }

  const main: Loaded[] = [];
  const earlier = new Map<number, Loaded[]>();
  const sessions: SessionRecord[] = [];
  const sinceMs = opts.since === null ? null : Date.parse(opts.since);

  for (const session of await listSessions(videoId)) {
    const isMain = target === 'all' || session.version === target;
    const isEarlier = target !== 'all' && session.version < target;
    if (!isMain && !isEarlier) continue;
    if (isMain) sessions.push(session);

    for (const ref of await listComments(videoId, session.sessionId)) {
      const loaded = await loadComment(ref, session, opts, probes);
      if (loaded === null) continue;
      if (isMain) {
        // `since` picks out what is new in this version. Earlier versions are kept whole.
        if (sinceMs !== null) {
          const ended = loaded.endedAt === null ? Number.NaN : Date.parse(loaded.endedAt);
          if (!(ended > sinceMs)) continue;
        }
        main.push(loaded);
      } else {
        const list = earlier.get(session.version) ?? [];
        list.push(loaded);
        earlier.set(session.version, list);
      }
    }
  }

  if (!opts.partial) {
    const all = [...main, ...[...earlier.values()].flat()];
    const pending = all.filter((l) => isPending(l, opts)).length;
    if (pending > 0) return { pending };
  }

  const byStart = (a: Loaded, b: Loaded) =>
    a.comment.startedAt.localeCompare(b.comment.startedAt) ||
    a.comment.commentId.localeCompare(b.comment.commentId);
  const comments = (list: Loaded[]) => [...list].sort(byStart).map((l) => l.comment);

  const probe = probes.get(target === 'all' ? video.latestVersion : target) ?? null;
  return {
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    video: {
      videoId: video.videoId,
      title: video.title,
      version: target,
      fps: probe?.fps ?? 0,
      width: probe?.width ?? 0,
      height: probe?.height ?? 0,
      duration: probe?.duration ?? 0,
    },
    sessions,
    comments: comments(main),
    previous: [...earlier.entries()]
      .sort(([a], [b]) => a - b)
      .map(([version, list]) => ({ version, comments: comments(list) })),
  };
}
