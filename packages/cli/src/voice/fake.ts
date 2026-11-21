import { LINE_RATE, writeWav } from '../audio/wav';
import type { VoiceProvider } from './provider';

const TONE_HZ = 220;
/** About -30 dBFS: audible, never loud. */
const AMPLITUDE = 1000;
/** Fade at each end, so the tone does not click. */
const FADE_SECONDS = 0.02;

/** How long the fake voice takes over a text: 0.4 s plus one second for every 2.45 words. */
export function fakeSeconds(spokenText: string): number {
  const words = spokenText.split(/\s+/).filter(Boolean).length;
  return 0.4 + words / 2.45;
}

/** A quiet tone as long as a real voice would take. The same text always gives the same bytes. */
export const fakeProvider: VoiceProvider = {
  id: 'fake',
  synthesize(spokenText) {
    const length = Math.round(fakeSeconds(spokenText) * LINE_RATE);
    const fade = Math.round(FADE_SECONDS * LINE_RATE);
    const samples = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      const envelope = Math.min(1, i / fade, (length - 1 - i) / fade);
      samples[i] = Math.round(
        AMPLITUDE * envelope * Math.sin((2 * Math.PI * TONE_HZ * i) / LINE_RATE)
      );
    }
    return Promise.resolve(writeWav(samples, LINE_RATE));
  },
};
