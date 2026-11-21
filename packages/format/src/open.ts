import { strFromU8, unzipSync } from 'fflate';
import { TalkieError } from './errors';
import { mimeFor } from './mime';
import type { TalkieFilm } from './types';
import { validateFilm } from './validate';

export interface FilmSource {
  readonly kind: 'folder' | 'packed';
  /** Read and parse a JSON file inside the film. */
  json(path: string): Promise<unknown>;
  /** A URL the browser can load the file from. */
  url(path: string): Promise<string>;
  /** Release any blob URLs. Call when the film is no longer shown. */
  dispose(): void;
}
export type FilmInput = string | URL | Blob | ArrayBuffer | Uint8Array;
export interface OpenOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** Open a film from a folder URL, a .lottie URL, or the bytes of a .lottie. */
export async function openFilm(
  input: FilmInput,
  opts: OpenOptions = {}
): Promise<{ film: TalkieFilm; source: FilmSource }> {
  const f = opts.fetch ?? fetch;
  let source: FilmSource;
  if (typeof input === 'string' || input instanceof URL) {
    const url = new URL(
      String(input),
      opts.baseUrl ?? (typeof location !== 'undefined' ? location.href : undefined)
    );
    if (url.pathname.endsWith('.lottie')) {
      const response = await fetchOk(f, url);
      source = packedSource(new Uint8Array(await response.arrayBuffer()));
    } else {
      if (!url.pathname.endsWith('/')) {
        url.pathname += '/';
      }
      source = folderSource(url, f);
    }
  } else if (input instanceof Uint8Array) {
    source = packedSource(input);
  } else if (input instanceof ArrayBuffer) {
    source = packedSource(new Uint8Array(input));
  } else {
    source = packedSource(new Uint8Array(await input.arrayBuffer()));
  }

  const result = validateFilm(await source.json('talkie.json'));
  if (!result.ok) {
    const v = result.errors.find((e) => e.rule === 'version');
    throw v
      ? new TalkieError('unsupported-version', v.message, result.errors)
      : new TalkieError(
          'invalid-film',
          result.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
          result.errors
        );
  }
  return { film: result.film, source };
}

async function fetchOk(f: typeof fetch, url: URL): Promise<Response> {
  let r: Response;
  try {
    r = await f(url);
  } catch (e) {
    throw new TalkieError('network', `could not fetch ${url}`, e);
  }
  if (!r.ok) {
    throw new TalkieError('network', `${url} returned HTTP ${r.status}`);
  }
  return r;
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new TalkieError('invalid-film', `${path} is not valid JSON`, e);
  }
}

function folderSource(base: URL, f: typeof fetch): FilmSource {
  return {
    kind: 'folder',
    json: async (p) => {
      const url = new URL(p, base);
      return parseJson(await (await fetchOk(f, url)).text(), url.href);
    },
    url: async (p) => new URL(p, base).href,
    dispose() {},
  };
}

function packedSource(bytes: Uint8Array): FilmSource {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (e) {
    throw new TalkieError('invalid-film', 'not a valid .lottie (zip) file', e);
  }
  const urls = new Map<string, string>();
  const get = (p: string) => {
    const b = Object.hasOwn(files, p) ? files[p] : undefined;
    if (!b) {
      throw new TalkieError('invalid-film', `${p} is missing from the .lottie`);
    }
    return b;
  };
  return {
    kind: 'packed',
    json: async (p) => parseJson(strFromU8(get(p)), p),
    url: async (p) => {
      let url = urls.get(p);
      if (url === undefined) {
        url = URL.createObjectURL(new Blob([get(p) as BlobPart], { type: mimeFor(p) }));
        urls.set(p, url);
      }
      return url;
    },
    dispose() {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    },
  };
}
