import type { Rect, ZoomState } from '@/lib/types';

/** Picture rectangle inside a container for object-fit: contain, relative to the container. */
export function containRect(cw: number, ch: number, vw: number, vh: number): Rect {
  if (cw <= 0 || ch <= 0 || vw <= 0 || vh <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(cw / vw, ch / vh);
  const width = vw * scale;
  const height = vh * scale;
  return { x: (cw - width) / 2, y: (ch - height) / 2, width, height };
}

/** Container-relative pixel point to normalised on-screen picture coordinates (unzoomed). */
export function normalise(
  px: number,
  py: number,
  content: Rect
): { x: number; y: number; inside: boolean } {
  const x = content.width ? (px - content.x) / content.width : 0;
  const y = content.height ? (py - content.y) / content.height : 0;
  return { x, y, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}

/** On-screen normalised point while zoomed -> full-frame normalised point. */
export function unzoom(sx: number, sy: number, z: ZoomState | null): { x: number; y: number } {
  if (!z || z.scale === 1) return { x: sx, y: sy };
  return { x: z.originX + (sx - z.originX) / z.scale, y: z.originY + (sy - z.originY) / z.scale };
}

/** Full-frame region visible while zoomed, normalised. */
export function visibleRegion(z: ZoomState): Rect {
  const width = 1 / z.scale;
  const height = 1 / z.scale;
  return { x: z.originX - z.originX * width, y: z.originY - z.originY * height, width, height };
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const COLS = ['left', 'centre', 'right'] as const;
const ROWS = ['top', 'middle', 'bottom'] as const;
export function positionLabel(x: number, y: number): string {
  if (x < 0 || x > 1 || y < 0 || y > 1) return 'off-picture';
  const c = COLS[Math.min(2, Math.floor(x * 3))];
  const r = ROWS[Math.min(2, Math.floor(y * 3))];
  if (r === 'middle' && c === 'centre') return 'centre';
  if (r === 'middle') return `middle-${c}`;
  return `${r}-${c}`;
}

export function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}
