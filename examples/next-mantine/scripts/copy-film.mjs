// Copies the built sample film and the dotLottie drawing engine into public/, so the app serves
// both itself and works with no network. Runs before "dev" and "build".
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const film = resolve(app, '../sample-film/dist/film');
const target = join(app, 'public/films/sample');

if (!existsSync(join(film, 'talkie.json'))) {
  console.error(
    `No built film at ${film}.\nBuild it first, from the repo root: yarn build && yarn sample`
  );
  process.exit(1);
}

/** The nearest node_modules folder, walking up from the app, that holds the package. */
function findPackage(name) {
  for (let dir = app; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (dirname(dir) === dir) {
      console.error(`Cannot find ${name} in any node_modules folder above ${app}`);
      process.exit(1);
    }
  }
}

await rm(target, { recursive: true, force: true });
await mkdir(dirname(target), { recursive: true });
await cp(film, target, { recursive: true });

const wasmDir = join(findPackage('@lottiefiles/dotlottie-web'), 'dist');
const wasmFiles = (await readdir(wasmDir)).filter((file) => file.endsWith('.wasm')).sort();
for (const file of wasmFiles) {
  await cp(join(wasmDir, file), join(app, 'public', file));
}

console.log(`Copied the sample film to public/films/sample and ${wasmFiles.join(', ')} to public`);
