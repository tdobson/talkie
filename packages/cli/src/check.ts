import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openFilm, TalkieError, type FilmSource, type TalkieFilm } from '@talkie/format';

/** A `fetch` for `file:` URLs, so a film folder on disk opens the way one on a server does. */
const diskFetch = (async (input: Parameters<typeof fetch>[0]) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  try {
    return new Response(new Uint8Array(await readFile(fileURLToPath(url))));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
      return new Response(null, { status: 404 });
    }
    throw error;
  }
}) as typeof fetch;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const seconds = (n: number) => `${Math.round(n * 1000) / 1000} s`;

/** Problems with opening the film at all, one line each. */
function openProblems(error: unknown): string[] {
  if (!(error instanceof TalkieError)) {
    throw error;
  }
  if (error.code === 'network') {
    return ['talkie.json is missing'];
  }
  if (Array.isArray(error.details) && error.details.length > 0) {
    return error.details.map((e) => `talkie.json: ${e.path}: ${e.message}`);
  }
  return [error.message.replace(/^file:\S*\/talkie\.json /, 'talkie.json ')];
}

/**
 * Check a built film, given as a folder or a `.lottie` file. Returns one line for each problem
 * found; an empty list means the film is sound.
 */
export async function checkFilm(target: string): Promise<string[]> {
  const path = resolve(target);
  const info = await stat(path).catch(() => null);
  if (!info) {
    return [`${target} does not exist`];
  }

  let film: TalkieFilm;
  let source: FilmSource;
  try {
    ({ film, source } = info.isDirectory()
      ? await openFilm(pathToFileURL(`${path}/`), { fetch: diskFetch })
      : await openFilm(new Uint8Array(await readFile(path))));
  } catch (error) {
    return openProblems(error);
  }

  const problems: string[] = [];
  try {
    const exists = async (file: string): Promise<boolean> => {
      try {
        const url = await source.url(file);
        return source.kind === 'packed' || (await diskFetch(url)).ok;
      } catch (error) {
        if (error instanceof TalkieError) {
          return false;
        }
        throw error;
      }
    };
    /** Parsed JSON, or undefined after noting why there is none. */
    const readJson = async (file: string): Promise<unknown> => {
      if (!(await exists(file))) {
        problems.push(`${file} is missing`);
        return undefined;
      }
      try {
        return await source.json(file);
      } catch (error) {
        if (error instanceof TalkieError) {
          problems.push(`${file} is not valid JSON`);
          return undefined;
        }
        throw error;
      }
    };
    const need = async (file: string) => {
      if (!(await exists(file))) {
        problems.push(`${file} is missing`);
      }
    };

    for (const track of film.audio) {
      await need(track.src);
    }
    for (const scene of film.scenes) {
      const animation = await readJson(scene.src);
      if (animation === undefined) {
        continue;
      }
      const { fr, ip, op } = isRecord(animation) ? animation : {};
      if (
        typeof fr !== 'number' ||
        typeof ip !== 'number' ||
        typeof op !== 'number' ||
        !(fr > 0) ||
        !(op > ip)
      ) {
        problems.push(`${scene.src} has no usable fr, ip and op`);
        continue;
      }
      const runs = (op - ip) / fr;
      const length = scene.end - scene.start;
      // one frame of slack, and a little for the arithmetic
      if (Math.abs(runs - length) > 1 / fr + 1e-9) {
        problems.push(
          `${scene.src} runs ${seconds(runs)}, but scene ${scene.id} is ${seconds(length)} long`
        );
      }
    }
    for (const captions of film.captions) {
      await need(captions.src);
    }
    await need(film.poster.png);
    if (film.poster.svg !== undefined) {
      await need(film.poster.svg);
    }

    const manifest = await readJson('manifest.json');
    if (manifest !== undefined) {
      const animations = isRecord(manifest) ? manifest.animations : undefined;
      const listed = Array.isArray(animations)
        ? animations.map((a) => (isRecord(a) ? String(a.id) : '?'))
        : [];
      const wanted = film.scenes.map((scene) => scene.id);
      if (listed.join('\n') !== wanted.join('\n')) {
        problems.push(
          `manifest.json lists animations ${listed.join(', ') || 'none'}, but the film has scenes ${wanted.join(', ')}`
        );
      }
    }
  } finally {
    source.dispose();
  }
  return problems;
}
