import { TALKIE_MAJOR, type TalkieFilm } from './types';

export interface ValidationError {
  path: string;
  rule: string;
  message: string;
}
export type ValidationResult =
  | { ok: true; film: TalkieFilm }
  | { ok: false; errors: ValidationError[] };

const EPS = 1e-3;

/**
 * Characters a URL parser rewrites or treats as a delimiter: controls and space (tab and newline
 * are stripped), '%' (encoded dots decode to '..'), and '?' and '#' (they end the path).
 */
const hasUnsafePathChar = (p: string): boolean => {
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || c === 0x25 || c === 0x3f || c === 0x23) return true;
  }
  return false;
};

/** True for a relative path that stays inside the film root, also once resolved as a URL. */
export function isSafeRelativePath(p: unknown): p is string {
  return (
    typeof p === 'string' &&
    p.length > 0 &&
    !hasUnsafePathChar(p) &&
    !p.startsWith('/') &&
    !p.includes('\\') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(p) &&
    !p.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')
  );
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Check a parsed talkie.json. Unknown keys are ignored. */
export function validateFilm(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const err = (path: string, rule: string, message: string) => {
    errors.push({ path, rule, message });
  };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ path: '', rule: 'type', message: 'talkie.json must be a JSON object' }],
    };
  }
  const f = input as Record<string, any>;

  if (!Number.isInteger(f.talkie) || f.talkie < 1) {
    err('talkie', 'required', 'talkie must be the integer format version');
  } else if (f.talkie > TALKIE_MAJOR) {
    err(
      'talkie',
      'version',
      `film uses format version ${f.talkie}; this reader supports up to ${TALKIE_MAJOR}`
    );
  }
  if (typeof f.title !== 'string' || f.title.length === 0) {
    err('title', 'required', 'title must be a non-empty string');
  }
  if (!num(f.duration) || f.duration <= 0) {
    err('duration', 'required', 'duration must be a positive number of seconds');
  }
  if (
    !Array.isArray(f.size) ||
    f.size.length !== 2 ||
    !f.size.every((n: unknown) => Number.isInteger(n) && (n as number) > 0)
  ) {
    err('size', 'required', 'size must be [width, height] in whole pixels');
  }

  if (!Array.isArray(f.audio) || f.audio.length === 0) {
    err('audio', 'required', 'audio must list at least one track');
  } else {
    f.audio.forEach((a: any, i: number) => {
      if (!isSafeRelativePath(a?.src)) {
        err(`audio[${i}].src`, 'path', 'audio src must be a relative path inside the film');
      }
      if (typeof a?.type !== 'string' || !a.type.startsWith('audio/')) {
        err(`audio[${i}].type`, 'required', 'audio type must be an audio/* MIME type');
      }
    });
    if (!f.audio.some((a: any) => typeof a?.type === 'string' && a.type.startsWith('audio/mp4'))) {
      err('audio', 'aac-required', 'every film must include an audio/mp4 (AAC) track');
    }
  }

  if (!Array.isArray(f.scenes) || f.scenes.length === 0) {
    err('scenes', 'required', 'scenes must list at least one scene');
  } else {
    const ids = new Set<string>();
    let prevEnd = 0;
    f.scenes.forEach((s: any, i: number) => {
      const p = `scenes[${i}]`;
      if (typeof s?.id !== 'string' || !s.id) {
        err(`${p}.id`, 'required', 'scene id must be a non-empty string');
      } else if (ids.has(s.id)) {
        err(`${p}.id`, 'unique-id', `scene id ${s.id} is used twice`);
      } else {
        ids.add(s.id);
      }
      if (!isSafeRelativePath(s?.src)) {
        err(`${p}.src`, 'path', 'scene src must be a relative path inside the film');
      }
      if (!num(s?.start) || !num(s?.end) || s.end <= s.start) {
        err(p, 'range', 'scene needs numeric start < end');
        return;
      }
      if (Math.abs(s.start - prevEnd) > EPS) {
        err(
          `${p}.start`,
          'contiguous',
          `scene ${s.id} starts at ${s.start} but the previous scene ends at ${prevEnd}`
        );
      }
      prevEnd = s.end;
    });
    if (num(f.duration) && Math.abs(prevEnd - f.duration) > EPS) {
      err(
        'scenes',
        'duration-match',
        `the last scene ends at ${prevEnd} but duration is ${f.duration}`
      );
    }
  }

  if (!Array.isArray(f.chapters)) {
    err('chapters', 'required', 'chapters must be an array (it may be empty)');
  } else {
    f.chapters.forEach((c: any, i: number) => {
      if (
        typeof c?.title !== 'string' ||
        !num(c?.start) ||
        c.start < 0 ||
        (num(f.duration) && c.start >= f.duration)
      ) {
        err(`chapters[${i}]`, 'required', 'chapter needs a title and a start inside the film');
      } else if (i > 0 && !(c.start > f.chapters[i - 1]?.start)) {
        err(`chapters[${i}]`, 'chapter-order', 'chapters must be sorted by start');
      }
    });
  }

  if (!Array.isArray(f.captions)) {
    err('captions', 'required', 'captions must be an array (it may be empty)');
  } else {
    f.captions.forEach((c: any, i: number) => {
      if (typeof c?.lang !== 'string' || typeof c?.label !== 'string') {
        err(`captions[${i}]`, 'required', 'captions need lang and label');
      }
      if (!isSafeRelativePath(c?.src)) {
        err(`captions[${i}].src`, 'path', 'captions src must be a relative path inside the film');
      }
    });
  }

  if (typeof f.poster !== 'object' || f.poster === null || !isSafeRelativePath(f.poster.png)) {
    err('poster.png', 'required', 'poster.png must be a relative path');
  } else if (f.poster.svg !== undefined && !isSafeRelativePath(f.poster.svg)) {
    err('poster.svg', 'path', 'poster.svg must be a relative path');
  }

  return errors.length ? { ok: false, errors } : { ok: true, film: f as unknown as TalkieFilm };
}
