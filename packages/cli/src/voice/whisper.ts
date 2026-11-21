const URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3';

/** A line whose transcript shares fewer of its words than this is flagged as a likely misread. */
export const MIN_SIMILARITY = 0.9;

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: Array<[number, string]> = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
];

/** 345 as "three hundred and forty five". */
function belowThousand(n: number): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) {
    words.push(ONES[hundreds], 'hundred');
    if (rest > 0) {
      words.push('and');
    }
  }
  if (rest >= 20) {
    words.push(TENS[Math.floor(rest / 10)]);
    if (rest % 10 > 0) {
      words.push(ONES[rest % 10]);
    }
  } else if (rest > 0 || hundreds === 0) {
    words.push(ONES[rest]);
  }
  return words;
}

const digitByDigit = (digits: string) => Array.from(digits, (d) => ONES[Number(d)]);

/** A whole number in British words. Numbers too long to name are read digit by digit. */
function integerWords(digits: string): string[] {
  if (digits.length > 15) {
    return digitByDigit(digits);
  }
  let n = Number(digits);
  if (n === 0) {
    return ['zero'];
  }
  const words: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      words.push(...belowThousand(Math.floor(n / size)), name);
      n %= size;
    }
  }
  if (n > 0) {
    // "one thousand and five", but "one thousand two hundred"
    if (words.length > 0 && n < 100) {
      words.push('and');
    }
    words.push(...belowThousand(n));
  }
  return words;
}

function numberWords(number: string): string {
  const [whole, fraction] = number.replaceAll(',', '').split('.');
  const words = integerWords(whole);
  if (fraction) {
    words.push('point', ...digitByDigit(fraction));
  }
  return words.join(' ');
}

/** Lower case, digits as words, no punctuation, single spaces: the form two texts are compared in. */
export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g, (number) => ` ${numberWords(number)} `)
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * How alike two texts are, word for word, from 0 to 1: twice the longest common run of words in
 * order, over the words in both. Both texts are normalised first.
 */
export function wordSimilarity(a: string, b: string): number {
  const x = normaliseText(a).split(' ').filter(Boolean);
  const y = normaliseText(b).split(' ').filter(Boolean);
  if (x.length === 0 && y.length === 0) {
    return 1;
  }
  let row = new Array<number>(y.length + 1).fill(0);
  for (const word of x) {
    const next = [0];
    for (let j = 1; j <= y.length; j++) {
      next.push(word === y[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1]));
    }
    row = next;
  }
  return (2 * row[y.length]) / (x.length + y.length);
}

export interface TranscribeOptions {
  /** Default: the `GROQ_API_KEY` environment variable. */
  key?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

/** What Whisper (Groq `whisper-large-v3`) hears in a WAV. */
export async function transcribe(
  wav: Uint8Array,
  options: TranscribeOptions = {}
): Promise<string> {
  const key = options.key ?? process.env.GROQ_API_KEY ?? '';
  if (!key) {
    throw new Error('GROQ_API_KEY is not set. The --check option needs it to listen to each line.');
  }
  const form = new FormData();
  form.set('model', MODEL);
  form.set('language', 'en');
  form.set('temperature', '0');
  form.set('response_format', 'json');
  // a copy in a buffer of its own: the bytes may be a view into a shared pool
  form.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'line.wav');
  const fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const response = await fetcher(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).trim().slice(0, 300);
    throw new Error(`Groq answered ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const body: any = await response.json();
  if (typeof body?.text !== 'string') {
    throw new Error('Groq sent no transcript');
  }
  return body.text.trim();
}
