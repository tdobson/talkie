/** `3 comments`, `1 comment`. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));

/** File size in decimal units, as a file manager shows it. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${trim(bytes / 1e9, 2)} GB`;
  if (bytes >= 1e6) return `${trim(bytes / 1e6, 1)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

// Locale and time zone are fixed so the server and the browser render the same text.
const whenFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `20 Nov 2026, 14:30` in UK time, or `Never` when there is no usable timestamp. */
export function formatWhen(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Never';
  const parts = Object.fromEntries(whenFormat.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}
