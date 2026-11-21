export type Vec = [number, number];
/** Lottie convention: i and o are tangents relative to v. */
export interface BezierPath {
  closed: boolean;
  v: Vec[];
  i: Vec[];
  o: Vec[];
}
export interface Style {
  fill?: string;
  stroke?: string;
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
