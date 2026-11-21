export interface FrameSource {
  /** PNG of the picture at video time vt (seconds), at most maxWidth wide, aspect kept. */
  frame(vt: number, maxWidth: number): Promise<Buffer>;
  /** Release processes. Safe to call twice. */
  close(): Promise<void>;
}

export type FrameSourceFactory = (videoId: string, version: number) => Promise<FrameSource>;
