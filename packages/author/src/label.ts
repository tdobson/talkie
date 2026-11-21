import opentype, { type Font } from 'opentype.js';
import type { BezierPath, Vec } from './model';

export type LabelFont = Font;
export type LabelAnchor = 'start' | 'middle' | 'end';
export interface LabelOptions {
  /** Where the anchor point of the text sits. y is the baseline. */
  at: Vec;
  /** Font size in pixels. */
  size?: number;
  color?: string;
  /** Which part of the text is at `at`: its start, its middle or its end. */
  anchor?: LabelAnchor;
}

export const LABEL_SIZE = 34;
export const LABEL_COLOUR = '#1d3b47';

const EPS = 1e-9;
const same = (a: Vec, b: Vec) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

/** Reads a TTF or OTF font. */
export function parseFont(buffer: ArrayBuffer): LabelFont {
  return opentype.parse(buffer);
}

/** The width the text takes up on its line, in pixels. */
export function labelWidth(font: LabelFont, text: string, size: number = LABEL_SIZE): number {
  return font.getAdvanceWidth(text, size);
}

/**
 * Outlines text as Bezier paths, so the film needs no font at play time. Each contour of each
 * glyph becomes one closed path.
 */
export function labelPaths(
  font: LabelFont,
  text: string,
  o: Pick<LabelOptions, 'at' | 'size' | 'anchor'>
): BezierPath[] {
  const { at, size = LABEL_SIZE, anchor = 'start' } = o;
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`label "${text}": size must be a positive number, got ${size}`);
  }
  for (const ch of text) {
    if (ch.trim() !== '' && font.charToGlyphIndex(ch) === 0) {
      throw new Error(`label "${text}": the font has no glyph for "${ch}"`);
    }
  }
  const width = labelWidth(font, text, size);
  const shift = anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0;

  const out: BezierPath[] = [];
  let cur: BezierPath | null = null;
  let pen: Vec = [0, 0];
  /** Adds a cubic segment from the pen. c1 and c2 are absolute control points. */
  const cubic = (path: BezierPath, c1: Vec, c2: Vec, p: Vec) => {
    path.o[path.o.length - 1] = [c1[0] - pen[0], c1[1] - pen[1]];
    path.v.push(p);
    path.i.push([c2[0] - p[0], c2[1] - p[1]]);
    path.o.push([0, 0]);
    pen = p;
  };
  for (const cmd of font.getPath(text, at[0] - shift, at[1], size).commands) {
    if (cmd.type === 'Z') {
      cur = null;
      continue;
    }
    const p: Vec = [cmd.x, cmd.y];
    if (cmd.type === 'M' || !cur) {
      // Glyph contours are closed shapes, whether or not the font data says so.
      cur = { closed: true, v: [p], i: [[0, 0]], o: [[0, 0]] };
      out.push(cur);
      pen = p;
    } else if (cmd.type === 'L') {
      cubic(cur, pen, p, p);
    } else if (cmd.type === 'C') {
      cubic(cur, [cmd.x1, cmd.y1], [cmd.x2, cmd.y2], p);
    } else {
      // A quadratic curve as the cubic that draws the same line.
      const q: Vec = [cmd.x1, cmd.y1];
      cubic(
        cur,
        [pen[0] + (2 / 3) * (q[0] - pen[0]), pen[1] + (2 / 3) * (q[1] - pen[1])],
        [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])],
        p
      );
    }
  }

  const paths = out.map(tidy).filter((p) => p.v.length > 1);
  if (paths.length === 0) {
    throw new Error(`label "${text}": there is nothing to draw`);
  }
  return paths;
}

/** Drops points that repeat the one before, and the last point when it is the first again. */
function tidy(path: BezierPath): BezierPath {
  const v: Vec[] = [];
  const i: Vec[] = [];
  const o: Vec[] = [];
  path.v.forEach((p, n) => {
    const last = v.length - 1;
    const straight = same(path.i[n], [0, 0]) && last >= 0 && same(o[last], [0, 0]);
    if (straight && same(v[last], p)) {
      o[last] = path.o[n];
      return;
    }
    v.push(p);
    i.push(path.i[n]);
    o.push(path.o[n]);
  });
  const last = v.length - 1;
  if (last > 0 && same(v[last], v[0])) {
    i[0] = i[last];
    v.pop();
    i.pop();
    o.pop();
  }
  return { closed: true, v, i, o };
}
