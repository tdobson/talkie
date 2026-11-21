import { TALKIE_MAJOR, type TalkieFilm, validateFilm } from '@talkie/format';
import { copy } from '@/lib/review/copy';

/** The file every film has at its root. */
export const FILM_JSON = 'talkie.json';

/** An import that was turned down for a reason the admin can act on. The message is shown as is. */
export class FilmRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilmRefused';
  }
}

/** The "did not pass validation" refusal, with at most the first three errors. */
export function invalidFilm(errors: string[]): FilmRefused {
  return new FilmRefused(copy.admin.filmInvalid.replace('{errors}', errors.slice(0, 3).join('; ')));
}

/**
 * Checks the text of a talkie.json. Throws `FilmRefused` for a film from a later format version
 * or one that does not pass `validateFilm`, which also checks every path with `isSafeRelativePath`.
 */
export function parseFilm(text: string): TalkieFilm {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalidFilm(['talkie.json is not valid JSON']);
  }
  const major = (parsed as { talkie?: unknown } | null)?.talkie;
  if (typeof major === 'number' && Number.isInteger(major) && major > TALKIE_MAJOR) {
    throw new FilmRefused(copy.admin.filmVersion.replace('{major}', String(major)));
  }
  const result = validateFilm(parsed);
  if (!result.ok) throw invalidFilm(result.errors.map((e) => `${e.path}: ${e.message}`));
  return result.film;
}

/**
 * Every file a film is made of: talkie.json and the scenes, audio, captions and posters it lists.
 * This is the allow-list for unpacking a film and for serving it. Nothing else is part of a film.
 */
export function listedPaths(film: TalkieFilm): string[] {
  const paths = new Set<string>([FILM_JSON]);
  for (const scene of film.scenes) paths.add(scene.src);
  for (const track of film.audio) paths.add(track.src);
  for (const captions of film.captions) paths.add(captions.src);
  paths.add(film.poster.png);
  if (film.poster.svg !== undefined) paths.add(film.poster.svg);
  return [...paths];
}
