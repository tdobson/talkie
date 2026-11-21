import { EventLog, pointerToFrame } from './eventLog';

describe('EventLog', () => {
  it('EventLog stamps t relative to begin()', () => {
    let now = 1000;
    const log = new EventLog(() => now);
    log.begin();
    now = 1250;
    log.push({ type: 'visibility', state: 'blur' });
    expect(log.drain()).toEqual([{ t: 250, type: 'visibility', state: 'blur' }]);
    expect(log.drain()).toEqual([]);
  });

  it('rounds t to whole milliseconds and keeps push order', () => {
    let now = 10.2;
    const log = new EventLog(() => now);
    log.begin();
    now = 20.9;
    log.push({ type: 'seek', from: 1, to: 2, via: 'key' });
    now = 31.3;
    log.push({ type: 'zoomPan', originX: 0.1, originY: 0.2 });
    expect(log.drain().map((e) => [e.type, e.t])).toEqual([
      ['seek', 11],
      ['zoomPan', 21],
    ]);
  });

  it('begin() restarts the time base and discards events from before it', () => {
    let now = 0;
    const log = new EventLog(() => now);
    log.begin();
    now = 500;
    log.push({ type: 'visibility', state: 'hidden' });
    log.begin();
    now = 600;
    log.push({ type: 'visibility', state: 'visible' });
    expect(log.drain()).toEqual([{ t: 100, type: 'visibility', state: 'visible' }]);
  });

  it('defaults to performance.now', () => {
    const log = new EventLog();
    log.begin();
    log.push({ type: 'visibility', state: 'focus' });
    const [e] = log.drain();
    expect(e.t).toBeGreaterThanOrEqual(0);
    expect(e.t).toBeLessThan(1000);
  });
});

describe('pointerToFrame', () => {
  const video = { videoWidth: 1920, videoHeight: 1080 };

  it('pointerToFrame handles letterbox and zoom', () => {
    const stage = { left: 0, top: 0, width: 800, height: 600 } as DOMRect;
    expect(pointerToFrame(400, 300, stage, video, null)).toEqual({ x: 0.5, y: 0.5, inside: true });
    const z = pointerToFrame(0, 75, stage, video, { scale: 2, originX: 0.5, originY: 0.5 });
    expect(z.x).toBeCloseTo(0.25);
    expect(z.y).toBeCloseTo(0.25);
  });

  it('subtracts the stage offset', () => {
    const stage = { left: 100, top: 50, width: 800, height: 450 } as DOMRect;
    const p = pointerToFrame(300, 162.5, stage, video, null);
    expect(p.x).toBeCloseTo(0.25);
    expect(p.y).toBeCloseTo(0.25);
    expect(p.inside).toBe(true);
  });

  it('flags the letterbox bars as outside the picture', () => {
    const stage = { left: 0, top: 0, width: 800, height: 600 } as DOMRect;
    const p = pointerToFrame(400, 10, stage, video, null);
    expect(p.inside).toBe(false);
    expect(p.y).toBeLessThan(0);
  });

  it('keeps a point in the bars outside even when zoom maps it into the frame', () => {
    const stage = { left: 0, top: 0, width: 800, height: 600 } as DOMRect;
    const p = pointerToFrame(400, 40, stage, video, { scale: 2, originX: 0.5, originY: 0.5 });
    expect(p.inside).toBe(false);
  });
});
