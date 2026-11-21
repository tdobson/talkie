import type { ZoomState } from '@/lib/types';

export type Screen =
  | 'mobile'
  | 'welcome'
  | 'micExplain'
  | 'micCheck'
  | 'micDenied'
  | 'player'
  | 'end'
  | 'general'
  | 'thanks';

export interface ReviewState {
  screen: Screen;
  name: string;
  sessionId: string | null;
  version: number | null;
  playing: boolean;
  /** The comment being recorded: a moment comment while paused, or the general comment. */
  commentId: string | null;
  zoom: ZoomState | null;
  micLost: boolean;
  resumed: boolean;
}

export type ReviewAction =
  | { type: 'detectedMobile' }
  | { type: 'loadedResumable'; sessionId: string; version: number; name: string }
  | { type: 'submitName'; name: string }
  | { type: 'micExplained' }
  | { type: 'micGranted' }
  | { type: 'micDenied' }
  | { type: 'micRetry' }
  | { type: 'micHeard' }
  | { type: 'sessionStarted'; sessionId: string; version: number }
  | { type: 'play' }
  | { type: 'pause'; commentId: string }
  | { type: 'ended' }
  | { type: 'shareMore'; commentId: string }
  | { type: 'generalFinished' }
  | { type: 'scrollBack' }
  | { type: 'zoomStart'; zoom: ZoomState }
  | { type: 'zoomPan'; originX: number; originY: number }
  | { type: 'zoomEnd' }
  | { type: 'micLost' }
  | { type: 'micReconnected' }
  | { type: 'done' };

export const initialState: ReviewState = {
  screen: 'welcome',
  name: '',
  sessionId: null,
  version: null,
  playing: false,
  commentId: null,
  zoom: null,
  micLost: false,
  resumed: false,
};

/**
 * Screen flow of the reviewer page. Pure: the components do the side effects (microphone,
 * recorder, uploads) and tell the machine what happened. An action that does not apply to the
 * current screen returns the same state object.
 */
export function reducer(s: ReviewState, a: ReviewAction): ReviewState {
  switch (a.type) {
    case 'detectedMobile':
      return { ...initialState, screen: 'mobile' };

    case 'loadedResumable':
      if (s.screen !== 'welcome') return s;
      return {
        ...s,
        screen: 'micExplain',
        sessionId: a.sessionId,
        version: a.version,
        name: a.name,
        resumed: true,
      };

    case 'submitName': {
      const name = a.name.trim();
      if (s.screen !== 'welcome' || name === '') return s;
      return { ...s, screen: 'micExplain', name };
    }

    // The reviewer pressed Continue: the browser prompt is up, nothing to show yet.
    case 'micExplained':
      return s;

    case 'micGranted':
      return s.screen === 'micExplain' || s.screen === 'micDenied'
        ? { ...s, screen: 'micCheck', micLost: false }
        : s;

    case 'micDenied':
      return s.screen === 'micExplain' || s.screen === 'micCheck'
        ? { ...s, screen: 'micDenied' }
        : s;

    case 'micRetry':
      return s.screen === 'micDenied' ? { ...s, screen: 'micExplain' } : s;

    // Hearing the reviewer only unlocks the Start watching button, which the screen owns.
    case 'micHeard':
      return s;

    case 'sessionStarted':
      if (s.screen !== 'micCheck') return s;
      return {
        ...s,
        screen: 'player',
        sessionId: a.sessionId,
        version: a.version,
        playing: false,
        commentId: null,
        zoom: null,
      };

    case 'play':
      if (s.screen !== 'player' && s.screen !== 'end') return s;
      if (s.screen === 'player' && s.playing) return s;
      return { ...s, screen: 'player', playing: true, commentId: null, zoom: null };

    case 'pause':
      if (s.screen !== 'player' || !s.playing) return s;
      return { ...s, playing: false, commentId: a.commentId };

    case 'ended':
      if (s.screen !== 'player') return s;
      return { ...s, screen: 'end', playing: false, commentId: null, zoom: null };

    case 'scrollBack':
      if (s.screen !== 'end') return s;
      return { ...s, screen: 'player', playing: false, commentId: null, zoom: null };

    case 'shareMore':
      if (s.screen !== 'end') return s;
      return { ...s, screen: 'general', commentId: a.commentId };

    case 'generalFinished':
      if (s.screen !== 'general') return s;
      return { ...s, screen: 'end', commentId: null };

    case 'zoomStart':
      if (s.screen !== 'player' || s.playing) return s;
      return { ...s, zoom: a.zoom };

    case 'zoomPan':
      if (s.screen !== 'player' || s.playing || s.zoom === null) return s;
      return { ...s, zoom: { ...s.zoom, originX: a.originX, originY: a.originY } };

    case 'zoomEnd':
      return s.zoom === null ? s : { ...s, zoom: null };

    case 'micLost':
      return s.micLost ? s : { ...s, micLost: true };

    case 'micReconnected':
      return s.micLost ? { ...s, micLost: false } : s;

    case 'done':
      if (s.screen !== 'player' && s.screen !== 'end') return s;
      return { ...s, screen: 'thanks', playing: false, commentId: null, zoom: null };

    default:
      return s;
  }
}
