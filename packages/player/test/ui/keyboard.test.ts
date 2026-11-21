import { keyAction } from '../../src/ui/keyboard';

const state = { currentTime: 50, duration: 200, volume: 0.5 };

describe('keyAction', () => {
  it('maps space and k to play or pause', () => {
    expect(keyAction(' ', state)).toEqual({ type: 'toggle-play' });
    expect(keyAction('k', state)).toEqual({ type: 'toggle-play' });
    expect(keyAction('K', state)).toEqual({ type: 'toggle-play' });
  });

  it('maps j and l to 10 seconds and the arrows to 5 seconds', () => {
    expect(keyAction('j', state)).toEqual({ type: 'seek', time: 40 });
    expect(keyAction('l', state)).toEqual({ type: 'seek', time: 60 });
    expect(keyAction('ArrowLeft', state)).toEqual({ type: 'seek', time: 45 });
    expect(keyAction('ArrowRight', state)).toEqual({ type: 'seek', time: 55 });
  });

  it('clamps seeks to the film', () => {
    expect(keyAction('j', { ...state, currentTime: 4 })).toEqual({ type: 'seek', time: 0 });
    expect(keyAction('l', { ...state, currentTime: 195 })).toEqual({ type: 'seek', time: 200 });
  });

  it('maps up and down to volume in steps of 10 percent', () => {
    expect(keyAction('ArrowUp', state)).toEqual({ type: 'volume', volume: 0.6 });
    expect(keyAction('ArrowDown', state)).toEqual({ type: 'volume', volume: 0.4 });
    expect(keyAction('ArrowUp', { ...state, volume: 0.95 })).toEqual({ type: 'volume', volume: 1 });
    expect(keyAction('ArrowDown', { ...state, volume: 0.05 })).toEqual({
      type: 'volume',
      volume: 0,
    });
  });

  it('maps f, c and m', () => {
    expect(keyAction('f', state)).toEqual({ type: 'fullscreen' });
    expect(keyAction('c', state)).toEqual({ type: 'captions' });
    expect(keyAction('m', state)).toEqual({ type: 'mute' });
  });

  it('maps digits to tenths of the film, and Home and End', () => {
    expect(keyAction('0', state)).toEqual({ type: 'seek', time: 0 });
    expect(keyAction('3', state)).toEqual({ type: 'seek', time: 60 });
    expect(keyAction('9', state)).toEqual({ type: 'seek', time: 180 });
    expect(keyAction('Home', state)).toEqual({ type: 'seek', time: 0 });
    expect(keyAction('End', state)).toEqual({ type: 'seek', time: 200 });
  });

  it('ignores other keys, and seeks before the film is known', () => {
    expect(keyAction('x', state)).toBeNull();
    expect(keyAction('Tab', state)).toBeNull();
    expect(keyAction('l', { ...state, duration: NaN })).toBeNull();
    expect(keyAction('k', { ...state, duration: NaN })).toEqual({ type: 'toggle-play' });
  });
});
