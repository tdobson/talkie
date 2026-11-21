/**
 * Lay voiced lines onto one silent scene track. Each line starts at `round(start * rate)`; lines that
 * overlap are summed and clipped to 16 bits; samples past the end of the scene are dropped.
 */
export function mixScene(
  lines: { start: number; samples: Int16Array }[],
  duration: number,
  rate = 48000
): Int16Array {
  const out = new Int16Array(Math.round(duration * rate));
  for (const line of lines) {
    const offset = Math.round(line.start * rate);
    const from = Math.max(0, -offset);
    const to = Math.min(line.samples.length, out.length - offset);
    for (let i = from; i < to; i++) {
      const sum = out[offset + i] + line.samples[i];
      out[offset + i] = Math.max(-32768, Math.min(32767, sum));
    }
  }
  return out;
}
