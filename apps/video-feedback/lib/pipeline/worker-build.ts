// Builds the processing worker into lib/pipeline/worker-dist/worker.mjs (not checked in), one
// file with the app code in it. sharp and playwright-core stay outside: they are native or
// large, and the standalone server already carries them in node_modules.
//
// Run it at low priority: ./scripts/lowprio.sh tsx lib/pipeline/worker-build.ts
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
export const WORKER_DIST = join(here, 'worker-dist');

export async function buildWorker(outDir: string = WORKER_DIST): Promise<string> {
  const outfile = join(outDir, 'worker.mjs');
  await build({
    entryPoints: [join(here, 'worker-entry.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    tsconfig: join(here, '..', '..', 'tsconfig.json'),
    external: ['sharp', 'playwright-core'],
    // Bundled CommonJS that calls require() needs one in an ES module.
    banner: {
      js: "import { createRequire as __vfCreateRequire } from 'node:module'; const require = __vfCreateRequire(import.meta.url);",
    },
    logLevel: 'warning',
  });
  return outfile;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out = await buildWorker();
  console.log(`worker built in ${out}`);
}
