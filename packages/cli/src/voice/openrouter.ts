import { runLow } from '../audio/lowproc';
import { readWav, writeWav } from '../audio/wav';
import type { VoiceProvider } from './provider';

const URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-audio';
/** The model streams PCM16 mono at this rate. */
const PCM_RATE = 24000;
/** Half a second of audio. Less than this is a failed take, not a short line. */
const MIN_PCM_BYTES = 24000;
const RETRIES = 3;
const BACKOFF_MS = 1000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpenRouterOptions {
  /** Default: the `OPENROUTER_API_KEY` environment variable. */
  key?: string;
  fetch?: Fetch;
  /** Waits between retries. */
  sleep?: (ms: number) => Promise<void>;
  /** Trims the silence either end of the take. Default `trimSilence`. */
  trim?: (wav: Uint8Array) => Promise<Uint8Array>;
}

/**
 * Trim the silence either end of a WAV with ffmpeg, leaving a little air (about 0.1 s before and
 * 0.18 s after).
 */
export async function trimSilence(wav: Uint8Array): Promise<Uint8Array> {
  const edge = (keep: string) =>
    `silenceremove=start_periods=1:start_threshold=-48dB:start_silence=${keep}`;
  const { stdout } = await runLow(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-f',
      'wav',
      '-i',
      'pipe:0',
      '-af',
      `${edge('0.10')},areverse,${edge('0.18')},areverse`,
      '-map_metadata',
      '-1',
      '-fflags',
      '+bitexact',
      '-flags:a',
      '+bitexact',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      'pipe:1',
    ],
    { input: wav }
  );
  // ffmpeg cannot seek back in a pipe to fill in the sizes, so write the header again
  const { samples, sampleRate } = readWav(stdout);
  return writeWav(samples, sampleRate);
}

const retriable = (status: number) => status === 429 || status >= 500;

/** POST, trying again up to three times on 429 and 5xx, waiting 1 s, 2 s and 4 s. */
async function post(
  fetcher: Fetch,
  sleep: (ms: number) => Promise<void>,
  init: RequestInit
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(URL, init);
    if (response.ok) {
      return response;
    }
    const detail = (await response.text().catch(() => '')).trim().slice(0, 300);
    if (!retriable(response.status) || attempt >= RETRIES) {
      const tried = attempt > 0 ? ` after ${attempt + 1} tries` : '';
      throw new Error(
        `OpenRouter answered ${response.status}${tried}${detail ? `: ${detail}` : ''}`
      );
    }
    await sleep(BACKOFF_MS * 2 ** attempt);
  }
}

/** Collect the PCM16 audio from a streamed chat completion (server-sent events). */
async function readAudio(response: Response): Promise<Uint8Array> {
  if (!response.body) {
    throw new Error('OpenRouter sent no body');
  }
  const chunks: Buffer[] = [];
  const take = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') {
      return;
    }
    let event: any;
    try {
      event = JSON.parse(trimmed.slice(6));
    } catch {
      return;
    }
    if (event?.error?.message) {
      throw new Error(`OpenRouter failed mid-stream: ${event.error.message}`);
    }
    for (const choice of Array.isArray(event?.choices) ? event.choices : []) {
      const data = choice?.delta?.audio?.data;
      if (typeof data === 'string' && data) {
        chunks.push(Buffer.from(data, 'base64'));
      }
    }
  };
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    lines.forEach(take);
    if (done) {
      break;
    }
  }
  take(pending);
  return Buffer.concat(chunks);
}

/** The OpenRouter voice: `openai/gpt-audio`, streamed as PCM16 at 24 kHz, silence trimmed. */
export function openRouterProvider(options: OpenRouterOptions = {}): VoiceProvider {
  return {
    id: 'openrouter',
    async synthesize(spokenText, { voice, prompt }) {
      const key = options.key ?? process.env.OPENROUTER_API_KEY ?? '';
      if (!key) {
        throw new Error(
          'OPENROUTER_API_KEY is not set. Set it to voice lines with OpenRouter, or pass --provider fake.'
        );
      }
      const fetcher: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
      const sleep =
        options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
      const response = await post(fetcher, sleep, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          modalities: ['text', 'audio'],
          audio: { voice, format: 'pcm16' },
          stream: true,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: `Read this aloud:\n\n${spokenText}` },
          ],
        }),
      });
      const pcm = await readAudio(response);
      if (pcm.length < MIN_PCM_BYTES) {
        throw new Error(`almost no audio came back for "${spokenText}"`);
      }
      const even = pcm.length & ~1;
      const samples = new Int16Array(even / 2);
      const view = new DataView(pcm.buffer, pcm.byteOffset, even);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = view.getInt16(i * 2, true);
      }
      return (options.trim ?? trimSilence)(writeWav(samples, PCM_RATE));
    },
  };
}
