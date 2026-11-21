import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { writeWav } from '../../src/audio/wav';
import { loadConfig } from '../../src/config';
import { lineIdentity, readScript, sceneOrder } from '../../src/project';
import { lineHash, writeVoice } from '../../src/voice-cache';

export const FIXTURE = resolve(__dirname, '../fixtures/mini-film');
/** The fixture is built in a temp folder, where the workspace packages cannot be found by name. */
export const ALIAS = {
  '@talkie/author': resolve(__dirname, '../../../author/src/index.ts'),
  '@talkie/cli': resolve(__dirname, '../../src/config.ts'),
};
const RATE = 48000;
const PLAYER_SRC = resolve(__dirname, '../../../player/src');
// the format package is not built when the tests run, so the player is bundled from its source
const BUNDLE_ALIAS = { '@talkie/format': resolve(__dirname, '../../../format/src/index.ts') };

/** One second of a quiet tone. */
const sine = (hz: number) =>
  writeWav(
    Int16Array.from({ length: RATE }, (_, i) =>
      Math.round(6000 * Math.sin((2 * Math.PI * hz * i) / RATE))
    ),
    RATE
  );

/** A copy of the mini film in a temp folder, with every line voiced by a tone. */
export async function voicedProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'talkie-t11-'));
  await cp(FIXTURE, dir, { recursive: true });
  const config = await loadConfig(dir, { alias: ALIAS });
  let hz = 220;
  for (const sceneId of sceneOrder(config)) {
    for (const line of (await readScript(dir, sceneId)).lines) {
      hz += 110;
      const hash = lineHash(lineIdentity(config, line.text));
      await writeVoice(dir, line.id, { hash, wav: sine(hz), seconds: 1, text: line.text });
    }
  }
  return dir;
}

/** Build the player the way its own build script does, into a temp folder. */
export async function builtPlayer(): Promise<string> {
  const outdir = await mkdtemp(join(tmpdir(), 'talkie-player-'));
  await build({
    entryPoints: [join(PLAYER_SRC, 'index.ts'), join(PLAYER_SRC, 'define.ts')],
    bundle: true,
    alias: BUNDLE_ALIAS,
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    format: 'esm',
    platform: 'browser',
    external: ['@lottiefiles/dotlottie-web'],
    outdir,
    logLevel: 'silent',
  });
  await build({
    entryPoints: [join(PLAYER_SRC, 'define.ts')],
    bundle: true,
    alias: BUNDLE_ALIAS,
    format: 'esm',
    platform: 'browser',
    outfile: join(outdir, 'talkie-player.js'),
    logLevel: 'silent',
  });
  return outdir;
}
