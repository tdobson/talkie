function whole(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

/** Clock text for the control bar: 0:59, 1:01, 1:00:00. Seconds round down. */
export function formatTime(seconds: number): string {
  const total = whole(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function unit(n: number, name: string): string {
  return `${n} ${name}${n === 1 ? '' : 's'}`;
}

/** Time as a screen reader should say it: "1 minute 5 seconds". */
export function spokenTime(seconds: number): string {
  const total = whole(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h > 0) {
    parts.push(unit(h, 'hour'));
  }
  if (m > 0) {
    parts.push(unit(m, 'minute'));
  }
  if (s > 0 || parts.length === 0) {
    parts.push(unit(s, 'second'));
  }
  return parts.join(' ');
}

/** aria-valuetext for the scrubber: "1 minute 5 seconds of 3 minutes 34 seconds". */
export function sliderValueText(time: number, duration: number): string {
  return `${spokenTime(time)} of ${spokenTime(duration)}`;
}
