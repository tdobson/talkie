import type { CreateRenderer, SceneRenderer } from '../../src/engine/renderer';

export interface FakeRenderer extends SceneRenderer {
  canvas: HTMLCanvasElement;
  loads: unknown[];
  frames: number[];
  resizes: number;
  destroyed: boolean;
}

/** A renderer that records calls. Scenes whose JSON has `fail: true` reject on load. */
export function fakeRenderers() {
  const made: FakeRenderer[] = [];
  const create: CreateRenderer = (canvas) => {
    const r: FakeRenderer = {
      canvas,
      loads: [],
      frames: [],
      resizes: 0,
      destroyed: false,
      async load(animation) {
        r.loads.push(animation);
        const a = animation as { fail?: boolean; fr: number; ip: number; op: number };
        if (a.fail) {
          throw new Error('bad scene');
        }
        return { fr: a.fr, ip: a.ip, op: a.op };
      },
      setFrame(frame) {
        r.frames.push(frame);
      },
      resize() {
        r.resizes++;
      },
      destroy() {
        r.destroyed = true;
      },
    };
    made.push(r);
    return r;
  };
  return { made, create };
}

/** Let pending promise callbacks run. */
export async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}
