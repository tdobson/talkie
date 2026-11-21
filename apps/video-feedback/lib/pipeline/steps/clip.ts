import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { frameSourceFor } from '@/lib/media/frame-sources';
import { renderClip } from '@/lib/render/clip';
import { type RenderStepContext, readEvents, renderDir } from './renderContext';
import { audioFileName, FILES } from './types';

/** Writes render/clip.mp4: the reconstructed view of the comment, set to its audio. */
export async function clipStep(ctx: RenderStepContext): Promise<void> {
  const { ref, dir, meta, probe } = ctx;
  const name = audioFileName(meta.audioMime);
  const audio = join(dir, name);
  try {
    await access(audio);
  } catch {
    throw new Error(`Cannot render the clip: ${name} is missing for this comment.`);
  }
  const outDir = renderDir(dir);
  await mkdir(outDir, { recursive: true });
  const source = await (ctx.frameSource ?? frameSourceFor)(ref.videoId, meta.version);
  try {
    await renderClip({
      source,
      audio,
      meta,
      events: await readEvents(dir),
      probe,
      out: join(outDir, FILES.clip),
    });
  } finally {
    await source.close();
  }
  ctx.log?.('clip');
}
