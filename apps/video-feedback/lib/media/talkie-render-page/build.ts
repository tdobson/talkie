// Builds the Talkie render page into dist/ (not checked in):
//
//   index.html             the page
//   main.js                main.ts with the player engine and dotlottie-web, in one file
//   dotlottie-player.wasm  the renderer, so nothing is fetched from a CDN
//   chromium-lowprio.sh    the low-priority wrapper playwright-core starts Chromium through
//
// and copies the same WASM to public/talkie/ (not checked in either), where the reviewer's
// browser fetches it from (TALKIE_WASM_PATH in components/review/media/TalkieAdapter.ts).
//
// Run it at low priority: ./scripts/lowprio.sh tsx lib/media/talkie-render-page/build.ts
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..', '..', '..');
const packages = join(appRoot, '..', '..', 'packages');

export const RENDER_PAGE_DIST = join(here, 'dist');
/** Served by Next as /talkie/dotlottie-player.wasm, for the reviewer's player. */
export const PUBLIC_WASM = join(appRoot, 'public', 'talkie', 'dotlottie-player.wasm');

/** dotlottie-web is a dependency of @talkie/player, so it is looked up from there. */
function dotLottieWasm(): string {
  const require = createRequire(join(packages, 'player', 'package.json'));
  return join(dirname(require.resolve('@lottiefiles/dotlottie-web')), 'dotlottie-player.wasm');
}

export async function buildRenderPage(outDir: string = RENDER_PAGE_DIST): Promise<string> {
  await mkdir(outDir, { recursive: true });
  await build({
    entryPoints: [join(here, 'main.ts')],
    outfile: join(outDir, 'main.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
    // Talkie packages are bundled from source, as the tests use them, so no package build is
    // needed first.
    alias: {
      '@talkie/format': join(packages, 'format', 'src', 'index.ts'),
      '@talkie/player': join(packages, 'player', 'src', 'index.ts'),
    },
  });
  await copyFile(join(here, 'index.html'), join(outDir, 'index.html'));
  await copyFile(dotLottieWasm(), join(outDir, 'dotlottie-player.wasm'));
  await copyFile(join(here, 'chromium-lowprio.sh'), join(outDir, 'chromium-lowprio.sh'));
  await chmod(join(outDir, 'chromium-lowprio.sh'), 0o755);
  return outDir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    const dir = await buildRenderPage(process.argv[2]);
    await mkdir(dirname(PUBLIC_WASM), { recursive: true });
    await copyFile(dotLottieWasm(), PUBLIC_WASM);
    return dir;
  })().then(
    (dir) => console.log(`render page built in ${dir}`),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    }
  );
}
