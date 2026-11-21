export interface Cue {
  start: number;
  end: number;
  text: string;
}

const TIME = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/;

function parseTime(s: string): number | null {
  const m = TIME.exec(s);
  if (!m) {
    return null;
  }
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/** Parse WebVTT into cues sorted by start time. Blocks that are not well-formed cues are skipped. */
export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l !== '');
    const first = lines[0] ?? '';
    if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(first)) {
      continue;
    }
    // The timing line is first, or second after an optional cue identifier.
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0 || at > 1) {
      continue;
    }
    const [from = '', rest = ''] = lines[at]!.split('-->');
    const start = parseTime(from.trim());
    const end = parseTime(rest.trim().split(/\s+/)[0] ?? '');
    if (start === null || end === null || end <= start) {
      continue;
    }
    const body = lines.slice(at + 1).join('\n');
    cues.push({ start, end, text: body.trim() });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The cue showing at time t (start inclusive, end exclusive), or null. */
export function cueAt(cues: Cue[], t: number): Cue | null {
  for (const cue of cues) {
    if (cue.start > t) {
      break;
    }
    if (t < cue.end) {
      return cue;
    }
  }
  return null;
}
