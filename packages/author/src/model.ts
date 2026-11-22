export type Vec = [number, number];
/** Lottie convention: i and o are tangents relative to v. */
export interface BezierPath {
  closed: boolean;
  v: Vec[];
  i: Vec[];
  o: Vec[];
}
/** An affine matrix [a, b, c, d, e, f], as in SVG: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = [number, number, number, number, number, number];
/** One colour stop. offset and opacity are 0 to 1, colour is #rrggbb. */
export interface GradientStop {
  offset: number;
  colour: string;
  opacity: number;
}
/** A linear gradient from one point to another, in the coordinates of the item it paints. */
export interface LinearGradient {
  type: 'linear';
  from: Vec;
  to: Vec;
  stops: GradientStop[];
}
/**
 * A radial gradient: a circle with a focal point, where offset 0 is at the focal point and offset 1
 * on the circle. The focal point must be inside 0.99 of the radius.
 */
export interface RadialGradient {
  type: 'radial';
  centre: Vec;
  radius: number;
  focal: Vec;
  stops: GradientStop[];
  /**
   * Gradient space to item space, for a circle the item stretches into an ellipse. Absent when the
   * gradient is already in item space.
   */
  matrix?: Matrix;
}
export type Gradient = LinearGradient | RadialGradient;
/** A flat colour (#rrggbb, or "none") or a gradient. */
export type Paint = string | Gradient;
export interface Style {
  fill?: Paint;
  stroke?: Paint;
  strokeWidth?: number;
  lineCap?: 'butt' | 'round' | 'square';
  lineJoin?: 'miter' | 'round' | 'bevel';
}
export interface ShapeItem {
  paths: BezierPath[];
  style: Style;
}
/** Scale and opacity are in percent, as in Lottie. Rotation is in degrees, clockwise. */
export interface Transform {
  position: Vec;
  anchor: Vec;
  scale: Vec;
  rotation: number;
  opacity: number;
}
export type AnimProp = 'position' | 'scale' | 'rotation' | 'opacity' | 'trimEnd';
export type Ease = 'linear' | 'in' | 'out' | 'inOut';
/** t is in seconds from the scene start. ease applies to the segment leaving this key. */
export interface Key {
  t: number;
  v: number | Vec;
  ease: Ease;
}
export interface Track {
  prop: AnimProp;
  keys: Key[];
}
export interface Node {
  id: string;
  name: string;
  items: ShapeItem[];
  children: Node[];
  transform: Transform;
  tracks: Track[];
  trimmed: boolean;
  /**
   * Closed contours in the node's own coordinates, before its transform. Their union clips the
   * node and its children.
   */
  clip?: BezierPath[];
}
export interface PlannedLine {
  id: string;
  text: string;
  caption?: string;
  start: number;
  voiceEnd: number;
  captionEnd: number;
}
export interface SceneModel {
  id: string;
  size: [number, number];
  duration: number;
  fps: 60;
  camera: Node;
  nodes: Node[];
  lines: PlannedLine[];
}
export const identity = (): Transform => ({
  position: [0, 0],
  anchor: [0, 0],
  scale: [100, 100],
  rotation: 0,
  opacity: 100,
});
