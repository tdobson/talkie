/** Timing of a loaded scene, read from its Lottie JSON: frame rate, in point and out point. */
export interface SceneTiming {
  fr: number;
  ip: number;
  op: number;
}

/** Draws one scene to one canvas. The engine never plays a scene, it only sets frames. */
export interface SceneRenderer {
  load(animation: unknown): Promise<SceneTiming>;
  setFrame(frame: number): void;
  resize(): void;
  destroy(): void;
}

export type CreateRenderer = (canvas: HTMLCanvasElement) => SceneRenderer;
