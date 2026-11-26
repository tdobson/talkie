import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/lib/config';
import { FILES } from '@/lib/pipeline/steps/types';
import { commentDir } from '@/lib/storage/paths';
import type { CommentRef } from '@/lib/types';

// The stills of a comment, sized for a model. They are drawn at the film's size (1920 wide
// for most films); a model sees no more than about 1280 across, so they are scaled down once,
// kept on disk, and sent at a third of the bytes.

/** Widest still sent to an agent. */
export const AGENT_IMAGE_WIDTH = 1280;

/** Still names a comment can have: `overview.jpg`, `moment-01.jpg`, `moment-01-zoom.jpg`. */
export const STILL_NAME_RE = /^(overview|moment-\d{2,}(-zoom)?)\.jpg$/;

export function imageCacheDir(): string {
  return join(config().dataDir, 'mcp', 'images');
}

/** Scales a JPEG to at most AGENT_IMAGE_WIDTH wide. Replaced in tests. */
export type Shrink = (input: Buffer) => Promise<Buffer>;

const sharpShrink: Shrink = async (input) => {
  // Loaded only when a still is asked for: the server does not otherwise need libvips.
  const { sharp } = await import('@/lib/render/sharp');
  return sharp(input)
    .resize({ width: AGENT_IMAGE_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
};

let shrink: Shrink = sharpShrink;

/** For tests: replace the scaler. Returns a function that puts the real one back. */
export function setShrinkForTests(fn: Shrink): () => void {
  shrink = fn;
  return () => {
    shrink = sharpShrink;
  };
}

/**
 * One still of a comment, scaled for an agent, or null when the comment has no such still.
 * A reprocess writes the stills again under the same names, so the cache key includes the
 * file's size and time: a new still is never answered with an old one.
 */
export async function stillForAgent(ref: CommentRef, name: string): Promise<Buffer | null> {
  if (!STILL_NAME_RE.test(name)) return null;
  const path = join(commentDir(ref), FILES.renderDir, name);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;

  const key = createHash('sha256')
    .update(`${path}:${info.size}:${info.mtimeMs}:${AGENT_IMAGE_WIDTH}`)
    .digest('hex');
  const cached = join(imageCacheDir(), `${key}.jpg`);
  try {
    return await readFile(cached);
  } catch {
    // Not made yet.
  }

  const original = await readFile(path);
  let small: Buffer;
  try {
    small = await shrink(original);
  } catch (err) {
    // A still that cannot be scaled is still worth sending as it is.
    console.error('[mcp] could not scale a still:', err);
    return original;
  }
  try {
    await mkdir(imageCacheDir(), { recursive: true });
    const tmp = `${cached}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, small);
    await rename(tmp, cached);
  } catch {
    // The cache is a nicety: answer anyway.
  }
  void sweepCache();
  return small;
}

/** Cached stills are dropped after this long; a reprocess leaves the old ones behind. */
export const IMAGE_CACHE_DAYS = 30;
let lastSweep = 0;

/** At most once an hour, drops cached stills not made in the last IMAGE_CACHE_DAYS. */
async function sweepCache(now = Date.now()): Promise<void> {
  if (now - lastSweep < 3_600_000) return;
  lastSweep = now;
  const dir = imageCacheDir();
  try {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);
      if (info && now - info.mtimeMs > IMAGE_CACHE_DAYS * 86_400_000)
        await rm(path, { force: true });
    }
  } catch {
    // Nothing cached yet, or the folder is busy: next time.
  }
}
