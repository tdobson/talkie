import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { FILES } from '@/lib/pipeline/steps/types';
import { commentDir } from '@/lib/storage/paths';
import { renderFeedbackMd } from './markdown';
import type { ExportComment, ExportModel, ExportOptions } from './model';
import { renderReadme } from './readme';

/**
 * A strong ETag for an export: SHA-256 over the sorted `commentId:updatedAt` pairs and the
 * options that change what goes in. The export time is left out, so it is stable until a
 * comment changes.
 */
export function exportEtag(model: ExportModel, opts?: Partial<ExportOptions>): string {
  const pair = (c: ExportComment) => `${c.commentId}:${c.updatedAt}`;
  const pairs = [
    ...model.comments.map(pair),
    ...model.previous.flatMap((p) => p.comments.map((c) => `v${p.version}/${pair(c)}`)),
  ].sort();
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify({
      schemaVersion: model.schemaVersion,
      videoId: model.video.videoId,
      version: model.video.version,
      clips: opts?.clips ?? false,
      since: opts?.since ?? null,
      pairs,
    })
  );
  return `"${hash.digest('hex')}"`;
}

/** `<videoId>-v<n|all>-<YYYYMMDD-HHmm>.zip`, with the time in UTC. */
export function zipFilename(model: ExportModel, now: Date): string {
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 16).replace(':', '')}`;
  return `${model.video.videoId}-v${model.video.version}-${stamp}.zip`;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

const RAW_FILES = [FILES.events, FILES.transcript, FILES.moments, 'meta.json'] as const;

/**
 * Writes the export bundle to `out` and resolves once `out` has taken all of it.
 * Files a comment does not have (no stills yet, say) are left out.
 */
export async function writeZip(
  model: ExportModel,
  opts: ExportOptions,
  out: NodeJS.WritableStream
): Promise<void> {
  const zip = new yazl.ZipFile();
  const mtime = new Date(model.exportedAt);
  const failure = new Promise<never>((_, reject) => {
    zip.on('error', reject);
  });
  // Until someone awaits it below, a rejection here must not count as unhandled.
  failure.catch(() => {});
  const piped = pipeline(zip.outputStream, out);
  piped.catch(() => {});

  const text = (name: string, body: string) =>
    zip.addBuffer(Buffer.from(body, 'utf8'), name, { mtime });

  const addComment = async (c: ExportComment, prefix: string, raw: boolean) => {
    const dir = commentDir({
      videoId: model.video.videoId,
      sessionId: c.sessionId,
      commentId: c.commentId,
    });
    const render = join(dir, FILES.renderDir);
    const media: [string | null, string][] = [
      [c.files.overview, render],
      [c.files.audio, dir],
      [opts.clips ? c.files.clip : null, render],
      ...c.moments.flatMap((m): [string | null, string][] => [
        [m.image, render],
        [m.zoomImage, render],
      ]),
    ];
    for (const [zipPath, from] of media) {
      if (zipPath === null) continue;
      const src = join(from, basename(zipPath));
      if (await isFile(src)) zip.addFile(src, `${prefix}${zipPath}`);
    }
    if (!raw) return;
    for (const name of RAW_FILES) {
      const src = join(dir, name);
      if (await isFile(src)) zip.addFile(src, `raw/${c.commentId}/${name}`);
    }
  };

  const fill = async () => {
    text('README.md', renderReadme(model));
    text('feedback.md', renderFeedbackMd(model));
    text('feedback.json', `${JSON.stringify(model, null, 2)}\n`);
    for (const c of model.comments) await addComment(c, '', true);
    for (const p of model.previous) {
      const prefix = `previous/v${p.version}/`;
      const earlier: ExportModel = {
        ...model,
        video: { ...model.video, version: p.version },
        sessions: [],
        comments: p.comments,
        previous: [],
      };
      text(`${prefix}feedback.md`, renderFeedbackMd(earlier));
      for (const c of p.comments) await addComment(c, prefix, false);
    }
    zip.end();
  };

  await Promise.race([Promise.all([fill(), piped]), failure]);
}
