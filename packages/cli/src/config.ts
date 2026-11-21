import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';

export interface TalkieConfig {
  title: string;
  /** Width and height in pixels. Default [1920, 1080]. */
  size?: [number, number];
  /** Scene order comes from here. */
  chapters: Array<{ title: string; scenes: string[] }>;
  voice?: {
    provider?: 'openrouter' | 'fake';
    voice?: string;
    prompt?: string;
    lexicon?: Record<string, string>;
  };
  /** Path to a TTF for labels. Default 'fonts/label.ttf'. */
  font?: string;
  /** Figures the fact gate refuses. */
  conflicts?: string[];
  timing?: { lead?: number; gap?: number; tail?: number };
  /** Default 'en'. */
  captionsLang?: string;
}
export const defineConfig = (c: TalkieConfig) => c;

/** A config with every default filled in. */
export interface ResolvedConfig {
  title: string;
  size: [number, number];
  chapters: Array<{ title: string; scenes: string[] }>;
  voice: {
    provider: 'openrouter' | 'fake';
    voice: string;
    prompt: string;
    lexicon: Record<string, string>;
  };
  font: string;
  conflicts: string[];
  timing: { lead?: number; gap?: number; tail?: number };
  captionsLang: string;
}

/** What a line is voiced with when the config does not say. */
export const DEFAULT_VOICE = {
  provider: 'openrouter',
  voice: 'ballad',
  prompt:
    'Read this narration in a calm, clear Received Pronunciation English voice, at an even pace.',
} as const;

export interface LoadOptions {
  /** Module names mapped to files, for projects that cannot find a package by name. */
  alias?: Record<string, string>;
}

/** Scene ids and caption languages become file names, so they are kept plain. */
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Import the default export of a TypeScript module from a project. Nothing is cached, so an edited
 * file is read again on the next build.
 */
export async function importDefault(
  projectDir: string,
  file: string,
  { alias }: LoadOptions = {}
): Promise<unknown> {
  const jiti = createJiti(pathToFileURL(join(projectDir, 'talkie.config.ts')).href, {
    fsCache: false,
    moduleCache: false,
    ...(alias ? { alias } : {}),
  });
  // The require form, not jiti.import(): it also runs where dynamic import is unavailable (Jest).
  const loaded: unknown = jiti(file);
  return isRecord(loaded) && 'default' in loaded ? loaded.default : loaded;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function optionalSeconds(timing: Record<string, unknown>, key: string): number | undefined {
  const value = timing[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`talkie.config.ts: timing.${key} must be a number of seconds, 0 or more`);
  }
  return value;
}

/** Check a config and fill in its defaults. Throws on the first thing wrong. */
export function resolveConfig(input: unknown): ResolvedConfig {
  const fail = (message: string): never => {
    throw new Error(`talkie.config.ts: ${message}`);
  };
  if (!isRecord(input)) {
    return fail('the default export must be a config object');
  }
  const { title, size = [1920, 1080], chapters, voice = {}, timing = {} } = input;
  const { font = 'fonts/label.ttf', conflicts = [], captionsLang = 'en' } = input;
  if (typeof title !== 'string' || title.length === 0) {
    return fail('title must be a non-empty string');
  }
  if (
    !Array.isArray(size) ||
    size.length !== 2 ||
    !size.every((n) => Number.isInteger(n) && n > 0)
  ) {
    return fail('size must be [width, height] in whole pixels');
  }
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return fail('chapters must list at least one chapter');
  }
  const seen = new Set<string>();
  const resolvedChapters = chapters.map((chapter: unknown) => {
    if (!isRecord(chapter) || typeof chapter.title !== 'string' || chapter.title.length === 0) {
      return fail('every chapter needs a title');
    }
    if (!Array.isArray(chapter.scenes) || chapter.scenes.length === 0) {
      return fail(`chapter "${chapter.title}" has no scenes`);
    }
    for (const id of chapter.scenes) {
      if (typeof id !== 'string' || !PLAIN_NAME.test(id)) {
        return fail(`scene id ${JSON.stringify(id)} must be letters, digits, "-" and "_" only`);
      }
      if (seen.has(id)) {
        return fail(`scene ${id} is listed twice`);
      }
      seen.add(id);
    }
    return { title: chapter.title, scenes: [...(chapter.scenes as string[])] };
  });
  if (!isRecord(voice)) {
    return fail('voice must be an object');
  }
  const { provider = DEFAULT_VOICE.provider, lexicon = {} } = voice;
  if (provider !== 'openrouter' && provider !== 'fake') {
    return fail('voice.provider must be "openrouter" or "fake"');
  }
  for (const key of ['voice', 'prompt'] as const) {
    if (voice[key] !== undefined && typeof voice[key] !== 'string') {
      return fail(`voice.${key} must be a string`);
    }
  }
  if (!isRecord(lexicon) || !Object.values(lexicon).every((v) => typeof v === 'string')) {
    return fail('voice.lexicon must map words to their respellings');
  }
  if (typeof font !== 'string' || font.length === 0) {
    return fail('font must be the path of a TTF file');
  }
  if (!Array.isArray(conflicts) || !conflicts.every((c) => typeof c === 'string')) {
    return fail('conflicts must be a list of strings');
  }
  if (!isRecord(timing)) {
    return fail('timing must be an object');
  }
  if (typeof captionsLang !== 'string' || !PLAIN_NAME.test(captionsLang)) {
    return fail('captionsLang must be a language tag such as "en" or "en-GB"');
  }
  const resolvedTiming: ResolvedConfig['timing'] = {};
  for (const key of ['lead', 'gap', 'tail'] as const) {
    const seconds = optionalSeconds(timing, key);
    if (seconds !== undefined) {
      resolvedTiming[key] = seconds;
    }
  }
  return {
    title,
    size: [size[0], size[1]],
    chapters: resolvedChapters,
    voice: {
      provider,
      voice: (voice.voice as string | undefined) ?? DEFAULT_VOICE.voice,
      prompt: (voice.prompt as string | undefined) ?? DEFAULT_VOICE.prompt,
      lexicon: { ...(lexicon as Record<string, string>) },
    },
    font,
    conflicts: [...(conflicts as string[])],
    timing: resolvedTiming,
    captionsLang,
  };
}

/** Load `talkie.config.ts` from a project folder. */
export async function loadConfig(
  projectDir: string,
  opts: LoadOptions = {}
): Promise<ResolvedConfig> {
  const file = join(projectDir, 'talkie.config.ts');
  try {
    await access(file);
  } catch {
    throw new Error(`no talkie.config.ts in ${projectDir}`);
  }
  return resolveConfig(await importDefault(projectDir, file, opts));
}
