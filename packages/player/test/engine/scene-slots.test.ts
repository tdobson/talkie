import { SceneSlots } from '../../src/engine/scene-slots';
import { fakeRenderers, flush } from './helpers';

function setup(failing: number[] = []) {
  const container = document.createElement('div');
  const { made, create } = fakeRenderers();
  const requested: number[] = [];
  const shown: number[] = [];
  const failures: number[] = [];
  const slots = new SceneSlots({
    container,
    createRenderer: create,
    loadScene: async (index) => {
      requested.push(index);
      return { id: index, fr: 60, ip: 0, op: 600, fail: failing.includes(index) };
    },
    onShow: (index) => shown.push(index),
    onFail: (index) => failures.push(index),
  });
  const visibility = () => slots.slots.map((s) => s.canvas.style.visibility);
  return { container, made, slots, requested, shown, failures, visibility };
}

describe('SceneSlots', () => {
  test('starts with two hidden canvases in the container', () => {
    const { container, slots, visibility } = setup();
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    expect(visibility()).toEqual(['hidden', 'hidden']);
    expect(slots.visible).toBeNull();
  });

  test('show loads a scene out of sight and reveals it when ready', async () => {
    const { slots, shown } = setup();
    expect(slots.show(0)).toBeNull();
    expect(slots.visible).toBeNull();
    await slots.settled();
    expect(shown).toEqual([0]);
    const slot = slots.show(0);
    expect(slot).toBe(slots.visible);
    expect(slot).toMatchObject({
      sceneIndex: 0,
      state: 'ready',
      timing: { fr: 60, ip: 0, op: 600 },
    });
  });

  test('crossing a boundary swaps slots without a reload when prefetched', async () => {
    const { slots, made, requested, visibility } = setup();
    slots.show(0);
    await slots.settled();
    const first = slots.visible!;
    slots.prefetch(1);
    await slots.settled();
    expect(slots.visible).toBe(first);
    const loadsBefore = made.map((r) => r.loads.length);

    const second = slots.show(1);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second!.sceneIndex).toBe(1);
    expect(made.map((r) => r.loads.length)).toEqual(loadsBefore);
    expect(requested).toEqual([0, 1]);
    expect(visibility().sort()).toEqual(['hidden', 'visible']);
    expect(second!.canvas.style.visibility).toBe('visible');
  });

  test('seeking far loads into the hidden slot and swaps when ready', async () => {
    const { slots, shown } = setup();
    slots.show(0);
    await slots.settled();
    const first = slots.visible!;

    expect(slots.show(7)).toBeNull();
    expect(slots.visible).toBe(first);
    expect(first.sceneIndex).toBe(0);
    await slots.settled();
    expect(slots.visible).not.toBe(first);
    expect(slots.visible!.sceneIndex).toBe(7);
    expect(shown).toEqual([0, 7]);
  });

  test('a seek that overtakes a prefetch wins the hidden slot', async () => {
    const { slots } = setup();
    slots.show(0);
    await slots.settled();
    slots.prefetch(1);
    slots.show(5);
    await slots.settled();
    expect(slots.visible!.sceneIndex).toBe(5);
  });

  test('prefetch leaves a busy hidden slot alone', async () => {
    const { slots, requested } = setup();
    slots.show(0);
    await slots.settled();
    slots.show(3);
    slots.prefetch(4);
    await slots.settled();
    expect(requested).toEqual([0, 3]);
  });

  test('a failed load marks the scene failed and reports it once', async () => {
    const { slots, failures, requested } = setup([1]);
    slots.show(0);
    await slots.settled();
    const first = slots.visible!;

    expect(slots.show(1)).toBeNull();
    await slots.settled();
    expect(slots.hasFailed(1)).toBe(true);
    expect(slots.visible).toBe(first);
    expect(slots.show(1)).toBeNull();
    slots.prefetch(1);
    slots.show(2);
    await slots.settled();
    slots.show(1);
    await slots.settled();
    expect(failures).toEqual([1]);
    expect(requested.filter((i) => i === 1)).toHaveLength(1);
    expect(slots.visible!.sceneIndex).toBe(2);
  });

  test('keeps parsed scenes in a cache of 6', async () => {
    const { slots, requested } = setup();
    for (const index of [0, 1, 2, 3, 4, 5, 0, 6, 1]) {
      slots.show(index);
      await slots.settled();
    }
    // 0 was read again from the cache; 6 then pushed out 1, the least recently used.
    expect(requested).toEqual([0, 1, 2, 3, 4, 5, 6, 1]);
  });

  test('destroy removes the canvases and destroys both renderers', async () => {
    const { container, slots, made } = setup();
    slots.show(0);
    await flush();
    slots.destroy();
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
    expect(made.map((r) => r.destroyed)).toEqual([true, true]);
    expect(slots.show(1)).toBeNull();
  });
});
