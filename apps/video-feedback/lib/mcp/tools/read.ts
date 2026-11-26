import { summariseVideos } from '@/lib/admin/summary';
import {
  buildExportModel,
  type ExportComment,
  type ExportModel,
  ExportNotFoundError,
  parseExportQuery,
} from '@/lib/export/model';
import { isWorkingOn, readPipelineStatus } from '@/lib/pipeline/pipeline-status';
import { readStatus } from '@/lib/pipeline/status';
import { limits } from '@/lib/limits';
import { listComments, listSessions, listVideos, readCommentMeta } from '@/lib/storage/repo';
import type { CommentMeta, CommentState, CommentStatus, VideoRecord } from '@/lib/types';
import {
  type CommentFormat,
  commentText,
  IMAGE_COST_CHARS,
  IMAGE_MODE_DESCRIPTION,
  IMAGE_MODES,
  type ImageMode,
  MAX_IMAGES_PER_ANSWER,
  oneLine,
  type Packed,
  packComments,
} from '../comments';
import {
  kindOf,
  parseVersion,
  requireVideo,
  reviewUrlOf,
  VERSION_PROP,
  VIDEO_ID_PROP,
} from '../common';
import { jsonContent, ok, type Tool, type ToolAnnotations, textContent, ToolError } from '../types';

// The read-only tools: what videos there are, who has reviewed them, and the feedback itself.
// Everything comes from the same files the export reads, so an agent sees what a person
// downloading export.json would see.

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
/** Processing comments get_video lists one by one; the rest are only counted. */
const MAX_PENDING_LISTED = 20;
/**
 * Text budget of a get_comment answer. Larger than a page's, as the words list of one long
 * comment can run to tens of thousands of characters, and one comment always goes in whole.
 */
const COMMENT_TEXT_BUDGET = 60_000;
/** Reviewers named in a get_feedback header at most. */
const MAX_REVIEWERS_LISTED = 30;
/** Characters Claude Code keeps of an answer, counting each image as IMAGE_COST_CHARS. */
const ANSWER_CHARS = 90_000;

const at = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

function errorOf(err: unknown): never {
  if (err instanceof ExportNotFoundError) {
    throw new ToolError(
      `${err.message} list_videos shows every video, and get_video lists the versions of one.`
    );
  }
  throw err;
}

// list_videos

const listVideosTool: Tool = {
  name: 'list_videos',
  title: 'List videos',
  description:
    'Every video on the review platform, newest first, as JSON: its id, title, kind (mp4 or talkie), latest version, number of versions, review link, and how much feedback the latest version has (sessions = reviewers, comments, processingOrClipRendering = comments the server still has work on: either their words and stills are not ready yet, or they are ready and only the video clip is still rendering, so this can be above 0 while get_feedback already shows every word; get_video splits the two. Then failedComments, emptyComments = pauses with nothing said, lastActivity). Start here to find a video id. Use "query" to narrow by title or id.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Only videos whose title or id contains this (any case).',
        maxLength: 200,
      },
    },
    additionalProperties: false,
  },
  annotations: { title: 'List videos', ...READ_ONLY },
  async run(args, ctx) {
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const records = new Map((await listVideos()).map((v) => [v.videoId, v]));
    const summaries = (await summariseVideos(ctx.baseUrl)).filter(
      (s) =>
        query === '' ||
        s.videoId.toLowerCase().includes(query) ||
        s.title.toLowerCase().includes(query)
    );

    if (summaries.length === 0) {
      return ok(
        textContent(
          query === '' || records.size === 0
            ? 'There are no videos yet. upload_film puts a film up for review.'
            : `No video has "${oneLine(String(args.query))}" in its title or id. Call list_videos with no query to see them all, or upload_film to put a new film up.`
        )
      );
    }

    const videos = summaries.map((s) => {
      const record = records.get(s.videoId);
      const latest = s.versions.find((v) => v.version === s.latestVersion);
      return {
        videoId: s.videoId,
        title: oneLine(s.title),
        kind: record ? kindOf(record, s.latestVersion) : 'mp4',
        latestVersion: s.latestVersion,
        versions: record?.versions.length ?? s.versions.length,
        reviewUrl: s.reviewUrl,
        onLatestVersion: {
          sessions: latest?.sessions ?? 0,
          comments: latest?.comments ?? 0,
          // summariseVideos counts a done comment whose clip is still rendering as pending too,
          // so the name says both: an agent must not wait for words that are already there.
          processingOrClipRendering: latest?.pendingProcessing ?? 0,
          failedComments: latest?.failedComments ?? 0,
          emptyComments: latest?.emptyComments ?? 0,
          lastActivity: latest?.lastActivity ?? null,
        },
      };
    });
    const what = query === '' ? 'videos' : `videos matching "${oneLine(String(args.query))}"`;
    return ok(
      textContent(
        `${videos.length} ${what}, newest first. Read a video's feedback with get_feedback (videoId); get_video shows its versions and reviewers.`
      ),
      jsonContent(videos)
    );
  },
};

// get_video

type StateCounts = Partial<Record<CommentState, number>>;

interface CommentFacts {
  commentId: string;
  sessionId: string;
  meta: CommentMeta;
  status: CommentStatus | null;
}

/** True while the transcript and stills are not ready yet: the server still has to do them. */
const isProcessing = (s: CommentStatus | null) =>
  s?.state === 'queued' || s?.state === 'processing';

/** An upload that went quiet long ago: the server finishes it, so it counts as processing. */
function isStaleUpload(s: CommentStatus | null, now: number): boolean {
  if (s?.state !== 'receiving') return false;
  const updated = Date.parse(s.updatedAt);
  return Number.isFinite(updated) && now - updated >= limits.staleReceivingMs;
}

function bump(counts: StateCounts, state: CommentState | 'unknown'): void {
  if (state === 'unknown') return;
  counts[state] = (counts[state] ?? 0) + 1;
}

const getVideoTool: Tool = {
  name: 'get_video',
  title: 'Get a video',
  description:
    'One video in detail, as JSON: its review link, every version (when imported, from which file, mp4 or talkie, and its feedback counts), every reviewer (session: name, version watched, when they started, whether they pressed Done or are still watching, their comments by state), and which comments the server is still processing (and whether the worker is on one right now). Use it before get_feedback to see who has reviewed which version, or to check what is still to come.',
  inputSchema: {
    type: 'object',
    properties: { videoId: VIDEO_ID_PROP },
    required: ['videoId'],
    additionalProperties: false,
  },
  annotations: { title: 'Get a video', ...READ_ONLY },
  async run(args, ctx) {
    const video = await requireVideo(args.videoId);
    const now = Date.now();
    const sessions = await listSessions(video.videoId);

    const byVersion = new Map<
      number,
      { sessions: number; comments: number; byState: StateCounts; clipsRendering: number }
    >();
    const versionCounts = (version: number) => {
      let entry = byVersion.get(version);
      if (!entry) {
        entry = { sessions: 0, comments: 0, byState: {}, clipsRendering: 0 };
        byVersion.set(version, entry);
      }
      return entry;
    };
    for (const v of video.versions) versionCounts(v.version);

    const pending: (CommentFacts & { reviewerName: string })[] = [];
    const reviewers: {
      reviewerName: string;
      version: number;
      startedAt: string;
      doneAt: string;
      comments: StateCounts;
    }[] = [];
    for (const session of sessions) {
      const counts = versionCounts(session.version);
      counts.sessions += 1;
      const byState: StateCounts = {};
      for (const ref of await listComments(video.videoId, session.sessionId)) {
        const meta = await readCommentMeta(ref).catch(() => null);
        if (meta === null) continue;
        // A status file that cannot be read must not take the whole answer down.
        const status = await readStatus(ref).catch(() => null);
        const state = status?.state ?? 'unknown';
        bump(byState, state);
        bump(counts.byState, state);
        counts.comments += 1;
        if (status?.state === 'done' && meta.kind === 'moment' && status.steps.clip === 'pending') {
          counts.clipsRendering += 1;
        }
        if (isProcessing(status) || isStaleUpload(status, now)) {
          pending.push({
            commentId: ref.commentId,
            sessionId: ref.sessionId,
            meta,
            status,
            reviewerName: session.reviewerName,
          });
        }
      }
      reviewers.push({
        reviewerName: oneLine(session.reviewerName),
        version: session.version,
        startedAt: session.startedAt,
        doneAt: session.doneAt ?? 'still watching',
        comments: byState,
      });
    }

    const worker = pending.length > 0 ? await readPipelineStatus() : null;
    pending.sort((a, b) => a.meta.startedAt.localeCompare(b.meta.startedAt));
    const processing = pending.slice(0, MAX_PENDING_LISTED).map((p) => ({
      commentId: p.commentId,
      reviewerName: oneLine(p.reviewerName),
      version: p.meta.version,
      state:
        p.status?.state === 'receiving' ? 'upload stopped, server finishing it' : p.status?.state,
      startedAt: p.meta.startedAt,
      workerOnItNow: isWorkingOn(worker, p.commentId, now),
    }));

    const versions = [...video.versions]
      .sort((a, b) => a.version - b.version)
      .map((v) => {
        const counts = versionCounts(v.version);
        return {
          version: v.version,
          importedAt: v.importedAt,
          originalFilename: oneLine(v.originalFilename),
          kind: kindOf(video, v.version),
          sessions: counts.sessions,
          comments: counts.comments,
          commentsByState: counts.byState,
          ...(counts.clipsRendering > 0 ? { clipsRendering: counts.clipsRendering } : {}),
        };
      });

    const lines = [
      `"${oneLine(video.title)}" (${video.videoId}): ${video.versions.length} version${video.versions.length === 1 ? '' : 's'}, latest ${video.latestVersion} (${kindOf(video, video.latestVersion)}), ${sessions.length} reviewer session${sessions.length === 1 ? '' : 's'}.`,
      'Comment states: done = transcript and stills ready, empty = they paused but said nothing, failed = processing failed, queued or processing = not ready yet, receiving = still being recorded or uploaded. clipsRendering only delays the video clip of a comment: its words and stills are ready.',
      pending.length === 0
        ? 'Nothing is still processing.'
        : `${pending.length} comment${pending.length === 1 ? ' is' : 's are'} still processing${pending.length > MAX_PENDING_LISTED ? ` (the first ${MAX_PENDING_LISTED} are listed)` : ''}. wait_for_feedback returns them when they are ready.`,
      'Read the feedback with get_feedback (videoId, and version for an older one).',
    ];
    return ok(
      textContent(lines.join('\n')),
      jsonContent({
        videoId: video.videoId,
        title: oneLine(video.title),
        reviewUrl: reviewUrlOf(video, ctx.baseUrl),
        createdAt: video.createdAt,
        latestVersion: video.latestVersion,
        versions,
        reviewers,
        processing,
      })
    );
  },
};

// get_feedback

const SORTS = ['film', 'recent', 'oldest'] as const;
type Sort = (typeof SORTS)[number];

function parseSince(value: unknown): string | null {
  if (value === undefined || value === '') return null;
  // The export's own check, so "since" means the same here as in export.json?since=.
  const parsed = parseExportQuery(new URLSearchParams({ since: String(value) }));
  if (parsed === null || parsed.since === null) {
    throw new ToolError(
      '"since" must be an ISO time, for example "2026-11-20T10:00:00Z" (UTC) or "2026-11-20".'
    );
  }
  return parsed.since;
}

/** General comments are said at the end of the film, so they sort after every frame. */
const filmTime = (c: ExportComment) =>
  c.pausedAtVideoTime === null ? Number.POSITIVE_INFINITY : c.pausedAtVideoTime;

function sorted(comments: ExportComment[], sort: Sort): ExportComment[] {
  const list = [...comments];
  if (sort === 'oldest') {
    // New comments land at the end, so the offsets of pages already read stay put.
    return list.sort(
      (a, b) => a.startedAt.localeCompare(b.startedAt) || a.commentId.localeCompare(b.commentId)
    );
  }
  if (sort === 'recent') {
    return list.sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt) || a.commentId.localeCompare(b.commentId)
    );
  }
  return list.sort(
    (a, b) =>
      a.version - b.version ||
      filmTime(a) - filmTime(b) ||
      a.reviewerName.localeCompare(b.reviewerName) ||
      a.startedAt.localeCompare(b.startedAt) ||
      a.commentId.localeCompare(b.commentId)
  );
}

async function buildModel(
  videoId: string,
  version: number | 'latest' | 'all',
  since: string | null
): Promise<ExportModel> {
  const built = await buildExportModel(
    videoId,
    { version, clips: false, since, partial: true },
    new Date()
  ).catch(errorOf);
  // With partial set the export never waits, so this cannot happen; it keeps the types honest.
  if ('pending' in built) throw new ToolError('The feedback is still being processed. Try again.');
  return built;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The header first, then every comment's text, then the stills: the order packComments wants. */
function packedResult(head: string, packed: Packed) {
  return ok(textContent(head), ...packed.texts, ...packed.images);
}

function versionLine(video: VideoRecord, model: ExportModel): string {
  if (model.video.version === 'all') {
    const each = [...video.versions]
      .sort((a, b) => a.version - b.version)
      .map((v) => `${v.version} (${kindOf(video, v.version)})`)
      .join(', ');
    return `Versions: all, ${each}. Each comment says which version it is on.`;
  }
  const v = model.video.version;
  const latest =
    v === video.latestVersion ? ', the latest' : `; the latest is ${video.latestVersion}`;
  return `Version ${v} of ${video.versions.length}${latest}. Kind: ${kindOf(video, v)}.`;
}

function reviewersLine(model: ExportModel): string {
  if (model.sessions.length === 0) return 'Reviewers: nobody has opened this version yet.';
  const all = model.video.version === 'all';
  const shown = model.sessions.slice(0, MAX_REVIEWERS_LISTED);
  const each = shown.map((s) => {
    const name = JSON.stringify(oneLine(s.reviewerName));
    const on = all ? ` on version ${s.version}` : '';
    const done = s.doneAt ? `pressed Done ${at(s.doneAt)}` : 'still watching';
    return `${name}${on} (${done})`;
  });
  const rest = model.sessions.length - shown.length;
  const more = rest > 0 ? `, and ${rest} more (get_video lists them all)` : '';
  return `Reviewers (names as they typed them): ${each.join(', ')}${more}.`;
}

const getFeedbackTool: Tool = {
  name: 'get_feedback',
  title: 'Get feedback',
  description: `The comments on one version of a video, ready to act on. First a summary (reviewers, how many comments, what is still processing, feedback on earlier versions), then each comment's text: reviewer, time and frame in the film, what they said with 📍 where they pointed, the Talkie scene, frame, chapter and caption when it is a Talkie film. Then the stills as labelled images. Up to 10 comments a page (limit up to 25), fewer when their text is long, so the answer stays small enough to arrive whole; the summary says the offset of the next page. At most ${MAX_IMAGES_PER_ANSWER} images per answer: the summary says how many stills were left out, and get_comment gives one comment in full. Narrow with "since" (only comments finished after a time) or "reviewer".`,
  inputSchema: {
    type: 'object',
    properties: {
      videoId: VIDEO_ID_PROP,
      version: VERSION_PROP,
      since: {
        type: 'string',
        description:
          'An ISO time ("2026-11-20T10:00:00Z"): only comments that ended after it. Earlier-version counts are not narrowed by it.',
        maxLength: 40,
      },
      reviewer: {
        type: 'string',
        description: "Only this reviewer's comments: part of their name, any case.",
        maxLength: 100,
      },
      images: {
        type: 'string',
        enum: IMAGE_MODES,
        default: 'overview',
        description: IMAGE_MODE_DESCRIPTION,
      },
      includeEmpty: {
        type: 'boolean',
        default: false,
        description:
          'List the pauses where nothing was said too. By default they are only counted.',
      },
      sort: {
        type: 'string',
        enum: SORTS,
        default: 'film',
        description:
          '"film" (the default): in order of time in the film, then reviewer, general comments last. "recent": newest first. "oldest": in the order they were recorded, oldest first; new comments only ever join the end, so page with this one while a review is still going (the other orders can shift a comment onto a page already read).',
      },
      offset: {
        type: 'integer',
        minimum: 0,
        default: 0,
        description: 'How many comments to skip, for the next page.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        default: DEFAULT_LIMIT,
        description: `Most comments per page, 1 to ${MAX_LIMIT}. A page holds fewer when their text is long; the summary gives the next offset.`,
      },
    },
    required: ['videoId'],
    additionalProperties: false,
  },
  annotations: { title: 'Get feedback', ...READ_ONLY },
  async run(args, ctx) {
    const video = await requireVideo(args.videoId);
    const version = parseVersion(args.version);
    const since = parseSince(args.since);
    const reviewer = typeof args.reviewer === 'string' ? args.reviewer.trim().toLowerCase() : '';
    const images = (args.images as ImageMode | undefined) ?? 'overview';
    const includeEmpty = args.includeEmpty === true;
    const sort = (args.sort as Sort | undefined) ?? 'film';
    const offset = typeof args.offset === 'number' ? args.offset : 0;
    const limit = typeof args.limit === 'number' ? args.limit : DEFAULT_LIMIT;

    const model = await buildModel(video.videoId, version, since);
    const byReviewer = model.comments.filter(
      (c) => reviewer === '' || c.reviewerName.toLowerCase().includes(reviewer)
    );
    const empty = byReviewer.filter((c) => c.state === 'empty').length;
    // Sorted oldest first, empty pauses stay in the list: a comment that turns out empty after
    // its page was read must not shift every later offset and skip one.
    const keepEmpty = includeEmpty || sort === 'oldest';
    const listed = sorted(
      keepEmpty ? byReviewer : byReviewer.filter((c) => c.state !== 'empty'),
      sort
    );
    const processing = listed.filter(
      (c) => c.state === 'queued' || c.state === 'processing'
    ).length;
    const asked = listed.slice(offset, offset + limit);
    // The budget, not the limit, decides the real page: an answer past what Claude Code keeps
    // is cut, and the cut comments would be lost while the offset counted them as read.
    const packed = await packComments(asked, {
      videoId: video.videoId,
      baseUrl: ctx.baseUrl,
      images,
    });
    const page = packed.included;

    const lines: string[] = [];
    lines.push(`# Feedback on "${oneLine(video.title)}" (${video.videoId})`);
    lines.push(versionLine(video, model));
    lines.push(reviewersLine(model));
    const filters: string[] = [];
    if (since) filters.push(`ended after ${since}`);
    if (reviewer) filters.push(`reviewer name contains "${oneLine(String(args.reviewer))}"`);
    if (filters.length > 0) lines.push(`Only comments that: ${filters.join('; ')}.`);

    const order =
      sort === 'film'
        ? 'in film order'
        : sort === 'recent'
          ? 'newest first'
          : 'oldest first, in the order they were recorded';
    if (listed.length === 0) {
      lines.push('No comments to show.');
      if (model.sessions.length === 0) {
        lines.push(
          `Review link (give it to Tim, not to reviewers): ${reviewUrlOf(video, ctx.baseUrl)}`
        );
      } else if (since || reviewer) {
        lines.push('Try without "since" or "reviewer" to see every comment.');
      }
    } else if (page.length === 0) {
      lines.push(
        `No comments at offset ${offset}: there are ${listed.length}. Use an offset from 0 to ${listed.length - 1}.`
      );
    } else {
      lines.push(
        `Showing comments ${offset + 1}-${offset + page.length} of ${listed.length}, ${order}.`
      );
      if (page.length < asked.length) {
        lines.push(
          `This page stops at ${plural(page.length, 'comment')}, not ${asked.length}: their text is long, and a bigger answer would be cut off before you saw it.`
        );
      }
    }
    if (processing > 0) {
      lines.push(
        `Still processing: ${plural(processing, 'comment')} (no words or stills yet). wait_for_feedback returns them when they are ready.`
      );
    }
    if (empty > 0) {
      lines.push(
        keepEmpty
          ? `Empty pauses (paused but said nothing): ${empty}, listed${sort === 'oldest' && !includeEmpty ? ' (sort "oldest" always lists them, so offsets stay put)' : ''}.`
          : `Empty pauses (paused but said nothing): ${empty}, not listed. includeEmpty: true lists them.`
      );
    }
    for (const p of model.previous) {
      if (p.comments.length === 0) continue;
      lines.push(
        `Earlier version ${p.version}: ${plural(p.comments.length, 'comment')}, not shown here. Call get_feedback with version ${p.version} to read them (or version "all").`
      );
    }
    for (const o of model.olderAfterImport ?? []) {
      const who = o.reviewers.map((r) => JSON.stringify(oneLine(r))).join(', ');
      lines.push(
        `Note: ${plural(o.count, 'comment')} on version ${o.version} came after this version was imported, from ${who}: they were still watching the old cut. They may already be fixed, or still apply: call with version ${o.version} to read them.`
      );
    }
    if (packed.imagesLeftOut > 0) {
      lines.push(
        `Images: ${plural(packed.imagesShown, 'still')} shown, ${packed.imagesLeftOut} more left out to keep the answer small (at most ${MAX_IMAGES_PER_ANSWER} per answer). get_comment (videoId, commentId) gives one comment with its stills, or images: "overview" sends one per comment.`
      );
    }
    if (page.length > 0 && offset + page.length < listed.length) {
      lines.push(`More: call again with offset ${offset + page.length}.`);
    }

    return packedResult(lines.join('\n'), packed);
  },
};

// get_comment

const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const getCommentTool: Tool = {
  name: 'get_comment',
  title: 'Get one comment',
  description:
    'One comment in full: who, where in the film, what they said with 📍 where they pointed, and by default every still (the overview, each pointed-at moment and the zoomed-in views) plus each transcribed word with its time and where the pointer was at that word. Use it when get_feedback left the images out, or to see exactly what a reviewer pointed at while saying each word.',
  inputSchema: {
    type: 'object',
    properties: {
      videoId: VIDEO_ID_PROP,
      commentId: {
        type: 'string',
        description: 'The comment id, as get_feedback gives it ("## Comment <id>").',
        pattern: UUID_PATTERN,
      },
      images: {
        type: 'string',
        enum: IMAGE_MODES,
        default: 'all',
        description: IMAGE_MODE_DESCRIPTION,
      },
      words: {
        type: 'boolean',
        default: true,
        description: 'Include every word with its time and the pointer position.',
      },
    },
    required: ['videoId', 'commentId'],
    additionalProperties: false,
  },
  annotations: { title: 'Get one comment', ...READ_ONLY },
  async run(args, ctx) {
    const video = await requireVideo(args.videoId);
    const commentId = String(args.commentId).toLowerCase();
    const model = await buildModel(video.videoId, 'all', null);
    const comment = model.comments.find((c) => c.commentId === commentId);
    if (!comment) {
      throw new ToolError(
        `There is no comment ${commentId} on "${video.videoId}". get_feedback lists the comments of a video with their ids (a comment still being recorded shows up once its upload ends).`
      );
    }
    const format: CommentFormat = {
      videoId: video.videoId,
      baseUrl: ctx.baseUrl,
      images: (args.images as ImageMode | undefined) ?? 'all',
      words: args.words !== false,
    };
    // One comment always goes in whole; the budget only matters for its stills, which are capped
    // so a comment with many moments still arrives without being cut off.
    // A long comment's words leave less room for stills: never more than the answer can carry.
    const textLength = commentText(comment, format).length;
    const maxImages = Math.max(
      0,
      Math.min(MAX_IMAGES_PER_ANSWER, Math.floor((ANSWER_CHARS - textLength) / IMAGE_COST_CHARS))
    );
    const packed = await packComments([comment], format, {
      textBudget: COMMENT_TEXT_BUDGET,
      maxImages,
    });
    const lines = [
      `"${oneLine(video.title)}" (${video.videoId}), version ${comment.version} (${kindOf(video, comment.version)}).`,
    ];
    if (packed.imagesLeftOut > 0) {
      lines.push(
        `Images: ${plural(packed.imagesShown, 'still')} shown, ${packed.imagesLeftOut} more left out to keep the answer small (at most ${MAX_IMAGES_PER_ANSWER} per answer). images: "moments" (each pointed-at moment, no zoomed views) or "overview" (one still) picks fewer.`
      );
    }
    return packedResult(lines.join('\n'), packed);
  },
};

export const readTools: Tool[] = [listVideosTool, getVideoTool, getFeedbackTool, getCommentTool];
