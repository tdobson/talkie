import { randomBytes, randomInt } from 'node:crypto';
import { slugify } from '@/lib/format';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUFFIX_LENGTH = 4;

/** A review-link token: 32 random bytes as base64url (43 characters). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** `slugify(title)` plus a dash and 4 random characters from [a-z0-9]. */
export function newVideoId(title: string): string {
  let suffix = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  }
  return `${slugify(title)}-${suffix}`;
}

/**
 * True for a lowercase, dashed UUID. Uppercase is refused on purpose so one id can never
 * name two directories (or the same directory twice on a case-insensitive file system).
 */
export function isUuid(s: string): boolean {
  return typeof s === 'string' && UUID_RE.test(s);
}
