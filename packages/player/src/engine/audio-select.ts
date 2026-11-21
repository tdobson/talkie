import { TalkieError, type TalkieAudio } from '@talkie/format';

/** First track the browser says it can play. Track order in the film is the order of preference. */
export function pickAudio(tracks: TalkieAudio[], canPlay: (type: string) => string): TalkieAudio {
  for (const track of tracks) {
    const answer = canPlay(track.type);
    if (answer === 'probably' || answer === 'maybe') {
      return track;
    }
  }
  throw new TalkieError(
    'no-playable-audio',
    `this browser cannot play any of the audio tracks (${tracks.map((t) => t.type).join(', ')})`
  );
}
