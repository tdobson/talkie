// Two short sounds that say, without looking, whether the microphone is recording a comment.
// "Stopped" falls (660 Hz then 440 Hz), "recording again" rises (440 then 660). They are made
// with WebAudio, so there is no file to load, and they are quiet enough not to startle.

type AudioContextCtor = typeof AudioContext;

const TONE_S = 0.18;
const GAP_S = 0.04;
const PEAK = 0.18;

let ctx: AudioContext | null = null;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** The one context the cues share, made on first use. Null where there is no audio. */
function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Browsers start audio suspended until the page has been clicked or typed in. Call this from a
 * click or key handler (the player does on every press) so the cues can play later.
 */
export function unlockCues(): void {
  try {
    const c = context();
    if (c && c.state === 'suspended') void c.resume().catch(() => {});
  } catch {
    // No sound is better than a broken review page.
  }
}

function tones(frequencies: number[]): void {
  const c = context();
  if (!c) return;
  try {
    if (c.state === 'suspended') void c.resume().catch(() => {});
    let at = c.currentTime + 0.02;
    for (const hz of frequencies) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(hz, at);
      // Soft attack and release: no click at either end.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(PEAK, at + 0.02);
      gain.gain.setValueAtTime(PEAK, at + TONE_S - 0.05);
      gain.gain.linearRampToValueAtTime(0, at + TONE_S);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(at);
      osc.stop(at + TONE_S + 0.01);
      at += TONE_S + GAP_S;
    }
  } catch {
    // No sound is better than a broken review page.
  }
}

/** "Doo-dunk", falling: recording has stopped. */
export function playStopped(): void {
  tones([660, 440]);
}

/** Rising: recording again. */
export function playResumed(): void {
  tones([440, 660]);
}
