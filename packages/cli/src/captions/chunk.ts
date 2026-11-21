// Ported unchanged from ~/dev/md-roofkit-films/tools/lib/plan.mjs (chunkCaption and glueNumbers).
// Lines over about 96 characters are split into chunks at sentence, then clause, boundaries.

const MAX_CHARS = 96;
const ORPHAN = 30; // a chunk shorter than this is an orphan
const MAX_MERGED = 112; // still two lines on the plate (about 56 characters a line at 44 px)

// Numbers are never split across caption plates ("one thousand seven hundred / and thirty-three
// millimetres", "120 to / 150"): a numeric phrase (digits or spelled-out numbers, joined by "and", "to",
// "or", "by" or "x", with "a" before hundred / thousand and a unit after) is glued together before splitting.
const NUMW =
  'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|quarter';
const NUM_RE = new RegExp(`^(?:\\d+(?:[.,]\\d+)*(?:mm|m)?|(?:${NUMW})(?:-(?:${NUMW}))*)$`, 'i');
const UNIT_RE =
  /^(?:mm|millimetres?|millimeters?|metres?|meters?|degrees?|percent|per|cent|centimetres?|cm|m)$/i;
const JOIN_RE = /^(?:and|to|or|by|x)$/i;
const GLUE = '\uE000';

function glueNumbers(text: string): string {
  const w = text.split(' ');
  const bare = (x: string) => x.replace(/[.,;:!?)"']+$/, '');
  const ends = (x: string) => /[.,;:!?]$/.test(x);
  const isNum = (i: number) => i < w.length && NUM_RE.test(bare(w[i]));
  const startsNum = (i: number) =>
    isNum(i) || (i + 1 < w.length && /^an?$/i.test(w[i]) && /^(hundred|thousand)/i.test(w[i + 1]));
  const out: string[] = [];
  for (let i = 0; i < w.length;) {
    if (!startsNum(i)) {
      out.push(w[i++]);
      continue;
    }
    let j = i; // [i, j] is the phrase
    for (;;) {
      if (ends(w[j])) {
        break;
      }
      if (isNum(j + 1) || (/^an?$/i.test(w[j + 1] || '') && startsNum(j + 1))) {
        j++;
        continue;
      }
      if (JOIN_RE.test(w[j + 1] || '') && startsNum(j + 2)) {
        j += 2;
        continue;
      }
      if (UNIT_RE.test(bare(w[j + 1] || '')) && NUM_RE.test(bare(w[j]))) {
        j++;
        continue;
      }
      break;
    }
    out.push(w.slice(i, j + 1).join(GLUE));
    i = j + 1;
  }
  return out.join(' ');
}

/** Split caption text into chunks of at most about MAX_CHARS at sentence, then clause, boundaries; never inside a number. */
export function chunkCaption(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= MAX_CHARS) {
    return [t];
  }
  const g = glueNumbers(t);
  const pieces: string[] = [];
  for (const sentence of g.split(/(?<=[.!?])\s+/)) {
    if (sentence.length <= MAX_CHARS) {
      pieces.push(sentence);
      continue;
    }
    // clause split: after commas/semicolons/colons, or before common joiners
    const parts = sentence.split(
      /(?<=[,;:])\s+|\s+(?=(?:and|but|then|so|which|because|before|while)\s)/
    );
    let cur = '';
    for (const p of parts) {
      if (cur && `${cur} ${p}`.length > MAX_CHARS) {
        pieces.push(cur);
        cur = p;
      } else {
        cur = cur ? `${cur} ${p}` : p;
      }
    }
    if (cur) {
      pieces.push(cur);
    }
  }
  // greedily merge neighbours that fit together
  const out: string[] = [];
  for (const p of pieces) {
    if (out.length && `${out[out.length - 1]} ${p}`.length <= MAX_CHARS) {
      out[out.length - 1] += ` ${p}`;
    } else {
      out.push(p);
    }
  }
  // no orphans: a chunk under ORPHAN characters joins its shorter neighbour if the pair still fits two lines
  for (let i = 0; i < out.length && out.length > 1;) {
    // a short whole sentence may stand alone; a short fragment of a sentence may not
    const fragment =
      /^[a-z]/.test(out[i]) ||
      (i > 0 && !/[.!?]$/.test(out[i - 1])) ||
      (i < out.length - 1 && !/[.!?]$/.test(out[i]));
    if (out[i].length >= ORPHAN || !fragment) {
      i++;
      continue;
    }
    const prev = i > 0 ? out[i - 1].length : Infinity;
    const next = i < out.length - 1 ? out[i + 1].length : Infinity;
    const j = prev <= next ? i - 1 : i + 1;
    if (Math.min(prev, next) + 1 + out[i].length > MAX_MERGED) {
      i++;
      continue;
    }
    const [a, b] = j < i ? [j, i] : [i, j];
    out.splice(a, 2, `${out[a]} ${out[b]}`);
    i = Math.max(0, a);
  }
  return out.map((c) => c.split(GLUE).join(' '));
}
