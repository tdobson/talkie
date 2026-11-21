import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Loaders, SceneDef } from '@talkie/author';
import { importDefault, type LoadOptions, type ResolvedConfig } from './config';
import type { LineIdentity } from './voice-cache';

export interface ScriptLine {
  id: string;
  /** What the voice says. */
  text: string;
  /** What the caption shows instead, when it differs. */
  caption?: string;
}
export interface Script {
  lines: ScriptLine[];
  minDuration?: number;
  /** SHA-256 of the script file. */
  hash: string;
}

export const sha256 = (data: Uint8Array | string): string =>
  createHash('sha256').update(data).digest('hex');

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Every scene id, in film order. */
export const sceneOrder = (config: ResolvedConfig): string[] =>
  config.chapters.flatMap((chapter) => chapter.scenes);

/** Read `script/<sceneId>.json`. */
export async function readScript(projectDir: string, sceneId: string): Promise<Script> {
  const name = `script/${sceneId}.json`;
  let bytes: Buffer;
  try {
    bytes = await readFile(join(projectDir, 'script', `${sceneId}.json`));
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(`scene ${sceneId} has no script (${name})`);
    }
    throw error;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
  if (!Array.isArray(parsed?.lines) || parsed.lines.length === 0) {
    throw new Error(`${name} has no lines`);
  }
  const lines = parsed.lines.map((line: any, i: number): ScriptLine => {
    if (typeof line?.id !== 'string' || !line.id || typeof line.text !== 'string' || !line.text) {
      throw new Error(`${name}: line ${i + 1} needs an id and a text`);
    }
    if (line.caption !== undefined && typeof line.caption !== 'string') {
      throw new Error(`${name}: the caption of line ${line.id} must be a string`);
    }
    return {
      id: line.id,
      text: line.text,
      ...(line.caption === undefined ? {} : { caption: line.caption }),
    };
  });
  const { minDuration } = parsed;
  if (
    minDuration !== undefined &&
    (typeof minDuration !== 'number' || !Number.isFinite(minDuration) || minDuration < 0)
  ) {
    throw new Error(`${name}: minDuration must be a number of seconds`);
  }
  return { lines, ...(minDuration === undefined ? {} : { minDuration }), hash: sha256(bytes) };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The text handed to the voice: the script text with the lexicon's respellings. Whole words only,
 * whatever their case; the longest entry wins where two overlap. Captions keep the written words.
 */
export function spokenText(text: string, lexicon: Record<string, string>): string {
  const words = Object.keys(lexicon)
    .filter((word) => word.length > 0)
    .toSorted((a, b) => b.length - a.length || (a < b ? -1 : 1));
  if (words.length === 0) {
    return text;
  }
  const byLower = new Map(words.map((word) => [word.toLowerCase(), lexicon[word]]));
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${words.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`,
    'giu'
  );
  return text.replace(pattern, (match) => byLower.get(match.toLowerCase()) ?? match);
}

/** Everything that changes how a line sounds. Its `lineHash` is the key of the voice cache. */
export function lineIdentity(config: ResolvedConfig, text: string): LineIdentity {
  const { provider, voice, prompt, lexicon } = config.voice;
  return { provider, voice, prompt, spokenText: spokenText(text, lexicon) };
}

/** What a scene read through its loaders while it compiled. */
export interface LoaderUse {
  /** Drawing name to the SHA-256 of its file. */
  art: Map<string, string>;
  /** SHA-256 of the label font, or null when no label was drawn. */
  font: string | null;
}

function artFile(projectDir: string, name: string): string {
  const parts = name.split('/');
  if (name.includes('\\') || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`art name "${name}" must be a path inside art/, such as "roof/tile"`);
  }
  return `${join(projectDir, 'art', ...parts)}.svg`;
}

/** SHA-256 of a project file, or 'missing'. */
function fileHash(file: string): string {
  try {
    return sha256(readFileSync(file));
  } catch (error) {
    if (isMissing(error)) {
      return 'missing';
    }
    throw error;
  }
}
export const artHash = (projectDir: string, name: string): string =>
  fileHash(artFile(projectDir, name));
export const fontHash = (projectDir: string, config: ResolvedConfig): string =>
  fileHash(join(projectDir, config.font));

/**
 * Loaders that read from the project folder. A drawing's name is its path under `art/` without
 * `.svg`: "roof/tile" is `art/roof/tile.svg`. Each read is recorded with the hash of what was read.
 */
export function artLoaders(
  projectDir: string,
  config: ResolvedConfig
): { loaders: Loaders; used: LoaderUse } {
  const used: LoaderUse = { art: new Map(), font: null };
  const loaders: Loaders = {
    svg(name) {
      const file = artFile(projectDir, name);
      let bytes: Buffer;
      try {
        bytes = readFileSync(file);
      } catch (error) {
        if (isMissing(error)) {
          throw new Error(`no drawing called "${name}" (art/${name}.svg)`);
        }
        throw error;
      }
      used.art.set(name, sha256(bytes));
      return bytes.toString('utf8');
    },
    font() {
      let bytes: Buffer;
      try {
        bytes = readFileSync(join(projectDir, config.font));
      } catch (error) {
        if (isMissing(error)) {
          throw new Error(`labels need a font, and ${config.font} does not exist`);
        }
        throw error;
      }
      used.font = sha256(bytes);
      // a copy in a buffer of its own: a Node Buffer may be a view into a shared pool
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      return copy;
    },
  };
  return { loaders, used };
}

/**
 * SHA-256 over a scene's source: `scenes/<sceneId>.ts` and every other file under `scenes/` that is
 * not itself a scene of the film (shared helpers, which any scene may import).
 */
export async function sceneSourceHash(
  projectDir: string,
  sceneId: string,
  allSceneIds: string[]
): Promise<string> {
  const root = join(projectDir, 'scenes');
  const others = new Set(allSceneIds.filter((id) => id !== sceneId).map((id) => `${id}.ts`));
  let entries;
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(`scene ${sceneId} has no source (scenes/${sceneId}.ts)`);
    }
    throw error;
  }
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .filter((path) => !others.has(path))
    .toSorted((a, b) => (a < b ? -1 : 1));
  if (!files.includes(`${sceneId}.ts`)) {
    throw new Error(`scene ${sceneId} has no source (scenes/${sceneId}.ts)`);
  }
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(`${path}\n${sha256(await readFile(join(root, ...path.split('/'))))}\n`);
  }
  return hash.digest('hex');
}

/** Import `scenes/<sceneId>.ts` and return the scene it exports by default. */
export async function loadScene(
  projectDir: string,
  sceneId: string,
  opts: LoadOptions = {}
): Promise<SceneDef> {
  const name = `scenes/${sceneId}.ts`;
  const def = (await importDefault(
    projectDir,
    join(projectDir, 'scenes', `${sceneId}.ts`),
    opts
  )) as Partial<SceneDef> | undefined;
  if (!def || typeof def.id !== 'string' || typeof def.build !== 'function') {
    throw new Error(`${name} must export a scene by default: export default scene(...)`);
  }
  if (def.id !== sceneId) {
    throw new Error(`${name} exports scene "${def.id}"; the id must match the file name`);
  }
  return def as SceneDef;
}
