/** Formats seconds of video time as `m:ss.t` (minutes are not wrapped into hours). */
export function formatVideoTime(seconds: number): string {
  // Round to tenths first so 59.96 becomes 1:00.0 rather than 0:60.0.
  const tenths = Math.max(0, Math.round(seconds * 10));
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  const secs = Math.floor(rest / 10);
  return `${minutes}:${String(secs).padStart(2, '0')}.${rest % 10}`;
}

const SLUG_MAX = 40;

/** Lowercase, dash-separated, ASCII-only slug of at most 40 characters. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return slug || 'video';
}
