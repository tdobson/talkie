import { SmoothClock, type MediaLike } from '../../src/engine/smooth-clock';

function setup() {
  let now = 1000;
  const media: MediaLike = { currentTime: 0, paused: false, seeking: false, playbackRate: 1 };
  const clock = new SmoothClock(() => now);
  return {
    media,
    clock,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

describe('SmoothClock', () => {
  test('extrapolates between coarse currentTime updates', () => {
    const { media, clock, tick } = setup();
    media.currentTime = 1;
    expect(clock.read(media)).toBe(1);
    tick(16);
    expect(clock.read(media)).toBeCloseTo(1.016, 6);
    tick(16);
    expect(clock.read(media)).toBeCloseTo(1.032, 6);
    media.currentTime = 1.04;
    tick(8);
    expect(clock.read(media)).toBeCloseTo(1.04, 6);
  });

  test('scales extrapolation by playbackRate', () => {
    const { media, clock, tick } = setup();
    media.playbackRate = 2;
    media.currentTime = 5;
    clock.read(media);
    tick(10);
    expect(clock.read(media)).toBeCloseTo(5.02, 6);
  });

  test('never runs more than 250 ms ahead of the last update', () => {
    const { media, clock, tick } = setup();
    media.currentTime = 2;
    clock.read(media);
    tick(900);
    expect(clock.read(media)).toBeCloseTo(2.25, 6);
  });

  test('holds instead of stepping back a little', () => {
    const { media, clock, tick } = setup();
    media.currentTime = 3;
    clock.read(media);
    tick(40);
    expect(clock.read(media)).toBeCloseTo(3.04, 6);
    media.currentTime = 3.02;
    tick(1);
    expect(clock.read(media)).toBeCloseTo(3.04, 6);
  });

  test('follows a real backwards seek', () => {
    const { media, clock, tick } = setup();
    media.currentTime = 10;
    clock.read(media);
    tick(16);
    media.currentTime = 4;
    expect(clock.read(media)).toBe(4);
  });

  test('reports currentTime exactly while paused or seeking', () => {
    const { media, clock, tick } = setup();
    media.currentTime = 7;
    clock.read(media);
    tick(100);
    media.paused = true;
    expect(clock.read(media)).toBe(7);
    media.paused = false;
    media.seeking = true;
    media.currentTime = 6.9;
    tick(100);
    expect(clock.read(media)).toBe(6.9);
  });

  test('does not run ahead after play until currentTime first moves', () => {
    const { media, clock, tick } = setup();
    media.paused = true;
    media.currentTime = 0;
    expect(clock.read(media)).toBe(0);
    media.paused = false;
    for (let i = 0; i < 20; i++) {
      tick(16);
      expect(clock.read(media)).toBe(0);
    }
    media.currentTime = 0.02;
    tick(16);
    expect(clock.read(media)).toBeCloseTo(0.02, 6);
    tick(16);
    expect(clock.read(media)).toBeCloseTo(0.036, 6);
  });

  test('does not run ahead after a seek until currentTime first moves', () => {
    const { media, clock, tick } = setup();
    media.currentTime = 1;
    clock.read(media);
    media.seeking = true;
    media.currentTime = 30;
    tick(16);
    expect(clock.read(media)).toBe(30);
    media.seeking = false;
    for (let i = 0; i < 20; i++) {
      tick(16);
      expect(clock.read(media)).toBe(30);
    }
    media.currentTime = 30.04;
    tick(16);
    expect(clock.read(media)).toBeCloseTo(30.04, 6);
  });
});
