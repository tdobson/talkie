import { TalkieError } from '@talkie/format';
import { pickAudio } from '../../src/engine/audio-select';

const tracks = [
  { src: 'u/n.webm', type: 'audio/webm; codecs=opus' },
  { src: 'u/n.m4a', type: 'audio/mp4; codecs=mp4a.40.2' },
];

describe('pickAudio', () => {
  test('returns the first track that is probably playable', () => {
    expect(pickAudio(tracks, () => 'probably')).toBe(tracks[0]);
  });

  test('accepts maybe and skips tracks the browser refuses', () => {
    expect(pickAudio(tracks, (type) => (type.startsWith('audio/mp4') ? 'maybe' : ''))).toBe(
      tracks[1]
    );
  });

  test('throws no-playable-audio when nothing can play', () => {
    let error: unknown;
    try {
      pickAudio(tracks, () => '');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TalkieError);
    expect((error as TalkieError).code).toBe('no-playable-audio');
  });
});
