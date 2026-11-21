import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/lib/config';
import { TRANSCRIBE_BACKOFF_MS } from '@/lib/constants';
import { audioDuration } from '@/lib/media/ops';
import { writeJsonAtomic } from '@/lib/storage/json';
import type { Transcript, TranscriptSegment, TranscriptWord } from '@/lib/types';
import { FILES, type StepFn } from './types';

export interface Transcriber {
  transcribe(wavPath: string, language: string): Promise<Transcript>;
}

const GROQ_MODEL = 'whisper-large-v3';
const REQUEST_TIMEOUT_MS = 5 * 60_000;

class GroqError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'GroqError';
  }
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Maps a Groq `verbose_json` body to a Transcript, dropping anything malformed. */
export function toTranscript(body: unknown): Transcript {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.text !== 'string') throw new Error('The response has no text.');
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const words: TranscriptWord[] = list(b.words)
    .filter((w) => w && typeof w.word === 'string' && num(w.start) && num(w.end))
    .map((w) => ({
      word: (w.word as string).trim(),
      start: w.start as number,
      end: w.end as number,
    }))
    .filter((w) => w.word !== '');
  const segments: TranscriptSegment[] = list(b.segments)
    .filter((s) => s && typeof s.text === 'string' && num(s.start) && num(s.end))
    .map((s) => ({
      start: s.start as number,
      end: s.end as number,
      text: (s.text as string).trim(),
    }));
  return {
    text: b.text.trim(),
    language: typeof b.language === 'string' ? b.language : null,
    duration: num(b.duration) ? b.duration : null,
    words,
    segments,
  };
}

/** The message from Groq's `{ "error": { "message" } }` body, or the start of the raw text. */
async function errorDetail(res: Response): Promise<string> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return '';
  }
  try {
    const message = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message;
    if (typeof message === 'string') return message;
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return text.trim().slice(0, 300);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Groq Whisper with word and segment timestamps. Rate limits (429), server errors (5xx),
 * capacity errors (498) and network failures are retried after each `TRANSCRIBE_BACKOFF_MS`
 * delay; any other 4xx fails at once, since repeating the same request cannot help.
 */
export function groqTranscriber(
  apiKey: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Transcriber {
  const url = `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;

  async function attempt(wav: Buffer, language: string): Promise<Transcript> {
    const form = new FormData();
    form.append('file', new File([new Uint8Array(wav)], 'audio.wav', { type: 'audio/wav' }));
    form.append('model', GROQ_MODEL);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    form.append('language', language);
    form.append('temperature', '0');

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new GroqError(`Groq transcription failed: ${(err as Error).message}`, true);
    }
    if (!res.ok) {
      const detail = await errorDetail(res);
      throw new GroqError(
        `Groq transcription failed (${res.status})${detail ? `: ${detail}` : ''}`,
        res.status === 429 || res.status === 498 || res.status >= 500
      );
    }
    try {
      return toTranscript(await res.json());
    } catch (err) {
      throw new GroqError(
        `Groq transcription gave an unexpected response: ${(err as Error).message}`,
        false
      );
    }
  }

  return {
    async transcribe(wavPath, language) {
      const wav = await readFile(wavPath);
      for (let tries = 0; ; tries++) {
        try {
          return await attempt(wav, language);
        } catch (err) {
          const delay = TRANSCRIBE_BACKOFF_MS[tries];
          if (!(err instanceof GroqError && err.retryable) || delay === undefined) throw err;
          await sleep(delay);
        }
      }
    },
  };
}

const FAKE_WORDS = 'so this logo is the old one and the text here runs on too long'.split(' ');

/** For tests and E2E runs: a fixed sentence spread evenly across the length of the audio. */
export const fakeTranscriber: Transcriber = {
  async transcribe(wavPath, language) {
    const duration = await audioDuration(wavPath);
    const round = (n: number) => Math.round(n * 1000) / 1000;
    // Leave a little quiet at each end, as real speech does.
    const lead = duration * 0.05;
    const slot = (duration - 2 * lead) / FAKE_WORDS.length;
    const words = FAKE_WORDS.map((word, i) => ({
      word,
      start: round(lead + i * slot),
      end: round(lead + i * slot + slot * 0.8),
    }));
    const text = FAKE_WORDS.join(' ');
    return {
      text,
      language,
      duration: round(duration),
      words,
      segments: [{ start: words[0].start, end: words[words.length - 1].end, text }],
    };
  },
};

let override: Transcriber | null = null;

/** Replaces the transcriber the step uses. Pass null to go back to the configured one. */
export function setTranscriberForTests(t: Transcriber | null): void {
  override = t;
}

function configuredTranscriber(): Transcriber {
  if (override) return override;
  const cfg = config();
  if (cfg.transcriber === 'fake') return fakeTranscriber;
  if (!cfg.groqApiKey) throw new Error('GROQ_API_KEY is not set, so audio cannot be transcribed.');
  return groqTranscriber(cfg.groqApiKey, cfg.groqBaseUrl);
}

/** The `transcribe` step: writes `transcript.json` (a Transcript). */
export const transcribeStep: StepFn = async ({ dir, log }) => {
  const transcript = await configuredTranscriber().transcribe(
    join(dir, FILES.wav),
    config().whisperLanguage
  );
  await writeJsonAtomic(join(dir, FILES.transcript), transcript);
  log(`transcribed ${transcript.words.length} words`);
};
