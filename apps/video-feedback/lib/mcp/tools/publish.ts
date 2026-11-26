import { posix } from 'node:path';
import { isWorkingOn, readPipelineStatus } from '@/lib/pipeline/pipeline-status';
import { prepareReprocess, type ReprocessOptions } from '@/lib/pipeline/reprocess';
import { STEP_ORDER } from '@/lib/pipeline/steps/types';
import { kickWorker } from '@/lib/pipeline/worker-host';
import { getVideo, saveVideo } from '@/lib/storage/repo';
import type { ImportRequest } from '@/lib/types';
import { importFromInbox, listInbox, withVideoLock } from '@/lib/videos/import';
import { requireVideo, reviewUrlOf, VIDEO_ID_PROP } from '../common';
import {
  type ToolContext,
  ToolError,
  jsonContent,
  ok,
  type PropSchema,
  type Tool,
  textContent,
} from '../types';
import {
  createUpload,
  failedNext,
  isExpired,
  nextAfterImport,
  PART_BLOCK_BYTES,
  PART_BLOCKS,
  readUpload,
  UPLOAD_ID_RE,
  type UploadRecord,
  uploadLimits,
} from '../uploads';

// Tools that put films up and change videos: upload_film (with get_upload to follow it),
// list_inbox and import_from_inbox for files already on the server, rename_video and
// reprocess_comments.

const MAX_TITLE_LENGTH = 200;
const FILM_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.lottie'];
const WHAT_IT_TAKES =
  'The platform takes an H.264 MP4 (yuv420p, so browsers can play it; .mp4, .m4v or .mov) or a packed Talkie film (.lottie).';
const UPLOAD_MAX_GIB = uploadLimits.totalMaxBytes / 1024 ** 3;
const UPLOAD_TAKES = `${WHAT_IT_TAKES} An upload can be at most ${UPLOAD_MAX_GIB} GiB.`;
const LINK_LIFE = `The link works for ${uploadLimits.ttlMs / 3_600_000} hours, and each part that arrives gives it another ${uploadLimits.ttlMs / 3_600_000} hours from then, up to ${uploadLimits.maxLifetimeMs / 3_600_000} hours from when it was made.`;
// Claude Code's Bash tool stops a foreground command at 10 minutes; at a modest 3 Mbit/s uplink
// 200 MB takes about that long.
const RUN_IN_BACKGROUND =
  'For a film over about 200 MB, run the command in the background (in Claude Code, the Bash tool with run_in_background: a foreground command is stopped after 10 minutes, a background one is not). If it stops part way, run the same command again: it skips the parts already sent.';

const MODE_PROP: PropSchema = {
  type: 'string',
  enum: ['new', 'version'],
  description:
    '"new" makes a new video (give a title). "version" adds the next version of an existing video (give its videoId), so reviewers keep the same link.',
};

const TITLE_PROP: PropSchema = {
  type: 'string',
  description: 'The title of the new video, as reviewers will see it. Only for mode "new".',
  maxLength: MAX_TITLE_LENGTH,
};

const VERSION_VIDEO_PROP: PropSchema = {
  ...VIDEO_ID_PROP,
  description: `${VIDEO_ID_PROP.description} Only for mode "version": the video this is the next version of.`,
};

type Target = { mode: 'new'; title: string } | { mode: 'version'; videoId: string };

/** Checks mode, title and videoId together: each mode takes one and not the other. */
async function checkTarget(args: Record<string, unknown>): Promise<Target> {
  if (args.mode === 'new') {
    if (args.videoId !== undefined) {
      throw new ToolError(
        'A videoId is only for mode "version". To add a new cut of that video, use mode "version"; for a new video, leave videoId out and give a title.'
      );
    }
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (title === '') throw new ToolError('Mode "new" needs a title for the new video.');
    return { mode: 'new', title };
  }
  if (args.title !== undefined) {
    throw new ToolError(
      'A title is only for mode "new". A new version keeps the title of its video (rename_video changes it).'
    );
  }
  if (args.videoId === undefined) {
    throw new ToolError(
      'Mode "version" needs the videoId of the video this is the next version of. list_videos shows them.'
    );
  }
  const video = await requireVideo(args.videoId);
  return { mode: 'version', videoId: video.videoId };
}

// Upload

/** `'...'` for POSIX sh: every single quote closes the string, adds an escaped quote, reopens. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface CommandOptions {
  /** dd block size and blocks per part. Tests use small parts; the real one is 1 MiB x 64. */
  blockBytes?: number;
  blocks?: number;
}

/**
 * The one command an agent runs to send a film: POSIX sh, so it works in sh, bash and zsh on
 * Linux, WSL and macOS, with nothing but dd, curl and wc. It runs in a subshell so nothing it
 * sets (or an exit) touches the agent's shell.
 *
 * It cuts the file into parts with dd. For each it first asks the server what it holds as that
 * part: the same size as the local part means it arrived on an earlier run, so running the
 * command again resumes. Otherwise it sends the part with curl (retried). At the first part
 * refused it prints the server's reason on stderr and stops with exit 1, without the finish,
 * whose "part missing" would hide the real reason (too large, out of disk, expired). With every
 * part in, it asks the server to finish: the server refuses unless the parts add up to the size
 * of the file, so a part that did not arrive can never import a cut-short film. The finish curl
 * has no -f, so its JSON is printed on stdout whatever the answer.
 *
 * --fail-with-body came in curl 7.76 (2021); an older curl (Ubuntu 20.04 has 7.68) falls back
 * to -f, which still stops at a refused part but shows only the status.
 */
export function uploadCommand(path: string, uploadUrl: string, opts: CommandOptions = {}): string {
  const bs = opts.blockBytes ?? PART_BLOCK_BYTES;
  const count = opts.blocks ?? PART_BLOCKS;
  const sendParts = [
    `while dd if="$f" of="$t" bs=${bs} skip=$((i*${count})) count=${count} 2>/dev/null && [ -s "$t" ]; do`,
    'n=$(($(wc -c < "$t")));',
    'if [ "$(curl -sS -m 60 "$u/part/$i" 2>/dev/null)" = "$n" ]; then echo "upload: part $i already there" >&2;',
    'elif r=$(curl -sS $ff --retry 3 -T "$t" "$u/part/$i" 2>&1); then echo "upload: part $i sent" >&2;',
    'else echo "$r" >&2; echo "upload: part $i was not taken, for the reason above. Once that is sorted, run the same command again: it skips the parts already sent." >&2; ok=0; break; fi;',
    'i=$((i+1)); done',
  ].join(' ');
  return [
    `( f=${shellQuote(path)}; u=${shellQuote(uploadUrl)}`,
    `if [ ! -f "$f" ]; then echo "upload: there is no file at $f" >&2; exit 1; fi`,
    `t=$(mktemp "\${TMPDIR:-/tmp}/vf-upload.XXXXXX") || exit 1`,
    'ff=--fail-with-body; curl $ff --version >/dev/null 2>&1 || ff=-f',
    'i=0; ok=1',
    sendParts,
    'rm -f "$t"',
    '[ "$ok" = 1 ] || exit 1',
    `curl -sS -X POST "$u/finish?bytes=$(($(wc -c < "$f")))" )`,
  ].join('; ');
}

// Control characters would break the one-line command; a film's path never has them.
// biome-ignore lint/suspicious/noControlCharactersInRegex: finding them is the point
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** The name the film gets on the server: plain characters only, never hidden. */
export function serverFilename(name: string): string {
  return name
    .replace(/[^A-Za-z0-9._ ()+-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s-]+/, '')
    .trim();
}

function checkFilename(args: Record<string, unknown>, path: string): string {
  const given = typeof args.filename === 'string' ? args.filename : posix.basename(path);
  const filename = serverFilename(given);
  const ext = posix.extname(filename).toLowerCase();
  if (!FILM_EXTENSIONS.includes(ext) || filename.length <= ext.length) {
    throw new ToolError(
      `"${given}" is not a film this platform takes. ${UPLOAD_TAKES} Convert it first (for an MP4: ffmpeg -i in -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart out.mp4).`
    );
  }
  return filename;
}

function createdBy(ctx: ToolContext): string | null {
  if (ctx.identity === null) return null;
  return ctx.identity.email ?? 'service token';
}

const uploadFilm: Tool = {
  name: 'upload_film',
  title: 'Upload a film',
  description: `Puts a film from your machine up for review, as a new video or as the next version of one. Returns one shell command (sh, bash or zsh; needs curl and dd) that sends the file in parts and imports it; run it exactly as given. It prints JSON with the videoId and the review link. ${RUN_IN_BACKGROUND} ${LINK_LIFE} ${UPLOAD_TAKES}`,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Absolute path of the film on your machine (on WSL, the Linux path, for example /mnt/c/Users/...). Only used to write the command.',
        minLength: 2,
        maxLength: 4096,
      },
      mode: MODE_PROP,
      title: TITLE_PROP,
      videoId: VERSION_VIDEO_PROP,
      filename: {
        type: 'string',
        description: 'Name for the file on the server. Default: the name in path.',
        maxLength: 200,
      },
    },
    required: ['path', 'mode'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(args, ctx) {
    const path = String(args.path);
    if (!path.startsWith('/')) {
      throw new ToolError(
        `"path" must be absolute (start with /), for example ${posix.join('/home/you', path)}. On WSL use the Linux path, such as /mnt/c/Users/...`
      );
    }
    if (CONTROL_RE.test(path)) {
      throw new ToolError(
        '"path" has a line break or control character in it. Rename the file first.'
      );
    }
    const filename = checkFilename(args, path);
    const target = await checkTarget(args);
    const { record, token } = await createUpload({
      filename,
      ...target,
      createdBy: createdBy(ctx),
    });
    const command = uploadCommand(path, `${ctx.baseUrl}/api/upload/${token}`);
    const what =
      target.mode === 'new'
        ? `a new video called "${target.title}"`
        : `the next version of ${target.videoId}`;
    return ok(
      textContent(
        [
          `Run this command on the machine that has the film. It uploads ${path} as ${what}:`,
          '',
          '```sh',
          command,
          '```',
          '',
          `It sends the file in parts of ${(PART_BLOCK_BYTES * PART_BLOCKS) / 1024 / 1024} MiB (each retried if the network drops), then the server joins them and imports the film. It prints a line per part on stderr, then JSON on stdout: {"ok": true, "videoId", "version", "reviewUrl", "next"} when it worked, or {"ok": false, "reason"} saying what to fix. If a part is refused it prints the server's reason on stderr and stops with exit status 1, before the JSON. If it says the film is still importing, call get_upload with uploadId "${record.uploadId}".`,
          '',
          RUN_IN_BACKGROUND,
          '',
          `uploadId: ${record.uploadId}`,
          `Expires: ${record.expiresAt} unless a part arrives first. ${LINK_LIFE} After that, call upload_film again.`,
          `Limits: at most ${UPLOAD_MAX_GIB} GiB; .mp4, .m4v or .mov (H.264, yuv420p) or .lottie.`,
          'Give the review link to Tim, not to reviewers.',
        ].join('\n')
      )
    );
  },
};

function uploadView(record: UploadRecord) {
  const finished = record.state === 'done' || record.state === 'failed';
  const expired = !finished && record.state !== 'importing' && isExpired(record);
  const state = expired ? 'expired' : record.state;
  const next: Record<string, string> = {
    waiting: 'Nothing has arrived yet. Run the command upload_film gave you.',
    receiving:
      'Parts are arriving. The command finishes by itself; if it stopped part way, run the same command again: it skips the parts already sent.',
    importing: 'The film is being imported. Call get_upload again in a minute.',
    done: nextAfterImport(record.result?.videoId ?? ''),
    failed: failedNext(record),
    expired: 'The link has expired. Call upload_film again for a new command.',
  };
  return {
    uploadId: record.uploadId,
    state,
    filename: record.filename,
    mode: record.mode,
    ...(record.title !== undefined ? { title: record.title } : {}),
    ...(record.videoId !== undefined ? { videoId: record.videoId } : {}),
    receivedBytes: record.receivedBytes,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    ...(record.inboxFile ? { inboxFile: record.inboxFile } : {}),
    ...(record.result ? { result: record.result } : {}),
    ...(record.error && record.state !== 'done' ? { error: record.error } : {}),
    next: next[state],
  };
}

const getUploadTool: Tool = {
  name: 'get_upload',
  title: 'Check an upload',
  description:
    'How an upload_film upload is going: state (waiting, receiving, importing, done, failed or expired), bytes received, and once done the videoId, version and review link, or the reason it failed and what to do. Use it when the upload command said the film is still importing, or stopped.',
  inputSchema: {
    type: 'object',
    properties: {
      uploadId: {
        type: 'string',
        description: 'The uploadId upload_film gave you (16 letters and digits).',
        maxLength: 16,
      },
    },
    required: ['uploadId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(args) {
    const uploadId = String(args.uploadId);
    const record = UPLOAD_ID_RE.test(uploadId) ? await readUpload(uploadId) : null;
    if (record === null) {
      throw new ToolError(
        `There is no upload "${uploadId}". Uploads are removed a day after they are made: call upload_film for a new one.`
      );
    }
    return ok(jsonContent(uploadView(record)));
  },
};

// Inbox

const listInboxTool: Tool = {
  name: 'list_inbox',
  title: 'List the inbox',
  description:
    'The files waiting in the inbox on the server (MP4s, packed Talkie films, film folders), newest first, with sizes. import_from_inbox imports one by its filename. Only needed when a file was copied to the server another way; upload_film imports by itself.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run() {
    const files = await listInbox();
    if (files.length === 0) return ok(textContent('The inbox is empty.'));
    return ok(jsonContent(files));
  },
};

const importFromInboxTool: Tool = {
  name: 'import_from_inbox',
  title: 'Import from the inbox',
  description: `Imports a file from the server's inbox (list_inbox shows them) as a new video or the next version of one, and returns the videoId, version and review link. The file leaves the inbox once it is in. If it is refused, the reason says what to fix and the file stays. ${WHAT_IT_TAKES}`,
  inputSchema: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'The filename, exactly as list_inbox shows it.',
        maxLength: 255,
      },
      mode: MODE_PROP,
      title: TITLE_PROP,
      videoId: VERSION_VIDEO_PROP,
    },
    required: ['filename', 'mode'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(args, ctx) {
    const target = await checkTarget(args);
    const filename = String(args.filename);
    const req: ImportRequest =
      target.mode === 'new'
        ? { filename, mode: 'new', title: target.title }
        : { filename, mode: 'version', videoId: target.videoId };
    const result = await importFromInbox(req);
    if (!result.ok) {
      throw new ToolError(
        `The import was refused: ${result.reason} The file stays in the inbox (list_inbox shows it).`
      );
    }
    const video = await getVideo(result.videoId);
    return ok(
      jsonContent({
        videoId: result.videoId,
        version: result.version,
        ...(video ? { reviewUrl: reviewUrlOf(video, ctx.baseUrl) } : {}),
        next: nextAfterImport(result.videoId),
      })
    );
  },
};

// Changes to a video

const renameVideo: Tool = {
  name: 'rename_video',
  title: 'Rename a video',
  description:
    'Changes the title of a video (what reviewers see). The videoId and review link stay the same. Returns the new title.',
  inputSchema: {
    type: 'object',
    properties: {
      videoId: VIDEO_ID_PROP,
      title: { type: 'string', description: 'The new title.', maxLength: MAX_TITLE_LENGTH },
    },
    required: ['videoId', 'title'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args) {
    const { videoId } = await requireVideo(args.videoId);
    const title = String(args.title).trim();
    if (title === '') throw new ToolError('"title" must not be empty.');
    // Under the video's lock, so a version being imported at the same time is not lost.
    const previous = await withVideoLock(videoId, async () => {
      const video = await getVideo(videoId);
      if (video === null) return null;
      await saveVideo({ ...video, title });
      return video.title;
    });
    if (previous === null)
      throw new ToolError(`The video "${videoId}" has gone. list_videos shows every video.`);
    return ok(jsonContent({ videoId, title, previousTitle: previous }));
  },
};

const reprocessComments: Tool = {
  name: 'reprocess_comments',
  title: 'Process comments again',
  description:
    'Runs comments through processing again (transcript, stills, clip). With only videoId it retries the comments that failed. Give commentId for one comment, version for the comments on one version, and fromStep to redo from that step on (it rebuilds what that step and later ones made). A comment the server is working on right now is left alone. Returns how many were queued; wait_for_feedback reports them again when they are done.',
  inputSchema: {
    type: 'object',
    properties: {
      videoId: VIDEO_ID_PROP,
      version: {
        type: 'integer',
        minimum: 1,
        description: 'Only the comments made on this version.',
      },
      commentId: {
        type: 'string',
        description: 'Only this comment (its id, as get_feedback gives it).',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
      },
      fromStep: {
        type: 'string',
        enum: STEP_ORDER,
        description:
          'The first step to run again. In order: audio, silence, transcribe, moments (where they pointed), stills, clip. Default: where it failed, or transcribe.',
      },
    },
    required: ['videoId'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(args) {
    const video = await requireVideo(args.videoId);
    const opts: ReprocessOptions = {};
    if (args.version !== undefined) {
      const version = Number(args.version);
      if (!video.versions.some((v) => v.version === version)) {
        throw new ToolError(
          `${video.videoId} has no version ${version}. Its versions are ${video.versions.map((v) => v.version).join(', ') || 'none yet'}.`
        );
      }
      opts.version = version;
    }
    if (args.commentId !== undefined) opts.commentId = String(args.commentId);
    if (args.fromStep !== undefined) opts.fromStep = args.fromStep as ReprocessOptions['fromStep'];

    // As the admin reprocess route does: a comment the worker is on right now is skipped, as its
    // files are in use (the clip pass would otherwise write `done` over the re-queued status).
    const working = await readPipelineStatus();
    const jobs = await prepareReprocess(video.videoId, opts, (ref) =>
      isWorkingOn(working, ref.commentId)
    );
    kickWorker();
    const commentIds = jobs.map((job) => job.ref.commentId);
    if (jobs.length === 0) {
      const why =
        Object.keys(opts).length === 0
          ? 'No comment on this video has failed, so there was nothing to retry. To redo comments that worked, give commentId, version or fromStep.'
          : 'No comment matched (comments still uploading, or being worked on right now, are left alone).';
      return ok(jsonContent({ queued: 0, commentIds, note: why }));
    }
    return ok(
      jsonContent({
        queued: jobs.length,
        commentIds,
        next: 'They are queued now. wait_for_feedback reports each one again when it is done.',
      })
    );
  },
};

export const publishTools: Tool[] = [
  uploadFilm,
  getUploadTool,
  listInboxTool,
  importFromInboxTool,
  renameVideo,
  reprocessComments,
];
