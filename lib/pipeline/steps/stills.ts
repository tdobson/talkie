import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderMomentStill, renderOverview } from '@/lib/render/stills';
import { sourcePath } from '@/lib/storage/paths';
import type { Moment } from '@/lib/types';
import { type RenderStepContext, readEvents, renderDir } from './renderContext';

const MOMENT_ID_RE = /^moment-\d{2,}$/;
const STALE_RE = /^moment-\d{2,}(-zoom)?\.jpg(\.tmp)?$/;

async function writeAtomic(path: string, data: Buffer): Promise<void> {
  const tmp = `${path}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

async function readMoments(dir: string): Promise<Moment[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, 'moments.json'), 'utf8'));
    return Array.isArray(parsed) ? (parsed as Moment[]) : [];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/**
 * Writes render/moment-NN.jpg (plus render/moment-NN-zoom.jpg for zoomed moments) for every
 * moment in moments.json, and render/overview.jpg. Stills left by an earlier run are removed
 * first, so the folder always matches moments.json.
 */
export async function stillsStep(ctx: RenderStepContext): Promise<void> {
  const { ref, dir, meta, probe } = ctx;
  const src = sourcePath(ref.videoId, meta.version);
  const outDir = renderDir(dir);
  await mkdir(outDir, { recursive: true });

  const moments = await readMoments(dir);
  const events = await readEvents(dir);

  for (const name of await readdir(outDir)) {
    if (STALE_RE.test(name)) await rm(join(outDir, name), { force: true });
  }

  for (const m of moments) {
    if (!MOMENT_ID_RE.test(m.id)) throw new Error(`Invalid moment id in moments.json: ${m.id}`);
    const { full, zoom } = await renderMomentStill(src, m, events, probe);
    await writeAtomic(join(outDir, `${m.id}.jpg`), full);
    if (zoom) await writeAtomic(join(outDir, `${m.id}-zoom.jpg`), zoom);
    ctx.log?.(`still ${m.id}${zoom ? ' (with zoom crop)' : ''}`);
  }

  await writeAtomic(join(outDir, 'overview.jpg'), await renderOverview(src, meta, events, probe));
  ctx.log?.('overview');
}
