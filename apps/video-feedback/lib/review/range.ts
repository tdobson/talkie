const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

/**
 * Parses an HTTP `Range` header for a resource of `size` bytes.
 *
 * Returns the inclusive byte range to serve, `'invalid'` when the range cannot be satisfied
 * (answer 416), or `null` when there is no usable range and the whole resource should be sent.
 * Only a single `bytes` range is supported: anything else (several ranges, another unit, bad
 * syntax) is ignored, which RFC 9110 allows.
 */
export function parseRange(
  header: string | null,
  size: number
): { start: number; end: number } | 'invalid' | null {
  if (header === null) return null;
  const m = RANGE_RE.exec(header.trim());
  if (!m) return null;
  const [, first = '', last = ''] = m;
  if (first === '' && last === '') return null;

  if (first === '') {
    // Suffix form: the last N bytes.
    const length = Number(last);
    if (!Number.isSafeInteger(length)) return null;
    if (length === 0 || size === 0) return 'invalid';
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(first);
  const end = last === '' ? Number.POSITIVE_INFINITY : Number(last);
  if (!Number.isSafeInteger(start) || (last !== '' && !Number.isSafeInteger(end))) return null;
  if (end < start) return null;
  if (start >= size) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}
