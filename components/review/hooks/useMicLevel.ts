'use client';

import { useEffect, useState } from 'react';
import { rmsLevel } from '@/lib/capture/micLevel';

/**
 * Speech through a laptop microphone has an RMS of roughly 0.02 to 0.2 of full scale. The
 * level is multiplied by this so normal speech fills most of the meter and a quiet microphone
 * still registers.
 */
export const LEVEL_GAIN = 4;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Live microphone level, 0..1, sampled once per animation frame. 0 with no stream. */
export function useMicLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const Ctor = audioContextCtor();
    if (!stream || !Ctor) {
      setLevel(0);
      return;
    }
    let ctx: AudioContext;
    let source: MediaStreamAudioSourceNode;
    let analyser: AnalyserNode;
    try {
      ctx = new Ctor();
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
    } catch {
      // A stream whose track has ended cannot be analysed: the meter just stays flat.
      setLevel(0);
      return;
    }
    // Created after a click, so this normally runs already; resume() covers the browsers
    // that start a context suspended.
    void ctx.resume?.().catch(() => {});

    const samples = new Float32Array(analyser.fftSize);
    let raf = 0;
    let last = -1;
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      const next = Math.min(1, rmsLevel(samples) * LEVEL_GAIN);
      // Skip renders the meter could not show anyway.
      if (Math.abs(next - last) >= 0.01 || (next === 0 && last !== 0)) {
        last = next;
        setLevel(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close().catch(() => {});
    };
  }, [stream]);

  return level;
}
