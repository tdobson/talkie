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

/**
 * The practice run a new reviewer gets before the real review: the film plays from the start
 * with a coach mark on Pause (`coach`), a pause listens without recording anything
 * (`listening`), and once they have spoken it says so (`gotThat`) and the film starts again
 * from the beginning for real. Null outside the practice.
 */
export type Practice = 'coach' | 'listening' | 'gotThat' | null;

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
  /**
   * The version this browser's earlier session was on, when a newer one has been imported
   * since. The reviewer gets a new session on the latest version and is told why.
   */
  newerThan: number | null;
  practice: Practice;
}

export type ReviewAction =
  | { type: 'detectedMobile' }
  | { type: 'loadedResumable'; sessionId: string; version: number; name: string }
  /** This browser reviewed an older version: start a new session on the latest one. */
  | { type: 'loadedNewerVersion'; name: string; previousVersion: number }
  | { type: 'submitName'; name: string }
  | { type: 'micExplained' }
  | { type: 'micGranted' }
  | { type: 'micDenied' }
  | { type: 'micRetry' }
  | { type: 'micHeard' }
  /** `practice` starts the player on the practice run. */
  | { type: 'sessionStarted'; sessionId: string; version: number; practice?: boolean }
  /** Paused during the practice: listening, but nothing is recorded or saved. */
  | { type: 'practicePause' }
  /** The reviewer spoke during the practice pause. */
  | { type: 'practiceHeard' }
  | { type: 'play' }
  | { type: 'pause'; commentId: string }
  | { type: 'ended' }
  | { type: 'shareMore'; commentId: string }
  | { type: 'generalFinished' }
  /** The open comment was closed and a new one started in its place (microphone reconnected). */
  | { type: 'commentRestarted'; commentId: string }
  /**
   * The reviewer scrolled back from the end screen. Paused means listening, so the player
   * opens a moment comment on the frame they land on and passes its id.
   */
  | { type: 'scrollBack'; commentId?: string }
  /** Playback did not start (the video failed to load, or the browser refused). */
  | { type: 'playFailed' }
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
  newerThan: null,
  practice: null,
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

    // Same reviewer, new cut: keep the name, skip the practice they have already done, but
    // leave the session unset so starting makes a new one on the latest version.
    case 'loadedNewerVersion':
      if (s.screen !== 'welcome') return s;
      return {
        ...s,
        screen: 'micExplain',
        sessionId: null,
        version: null,
        name: a.name,
        resumed: true,
        newerThan: a.previousVersion,
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

    // The mic check screen moves on by itself once it has heard the reviewer.
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
        practice: a.practice ? 'coach' : null,
      };

    case 'play': {
      if (s.screen !== 'player' && s.screen !== 'end') return s;
      if (s.screen === 'player' && s.playing) return s;
      // Playing again after the practice pause is the real start.
      const practice = s.practice === 'coach' ? 'coach' : null;
      return { ...s, screen: 'player', playing: true, commentId: null, zoom: null, practice };
    }

    case 'pause':
      if (s.screen !== 'player' || !s.playing || s.practice !== null) return s;
      return { ...s, playing: false, commentId: a.commentId };

    case 'practicePause':
      if (s.screen !== 'player' || !s.playing || s.practice !== 'coach') return s;
      return { ...s, playing: false, commentId: null, practice: 'listening' };

    case 'practiceHeard':
      if (s.screen !== 'player' || s.practice !== 'listening') return s;
      return { ...s, practice: 'gotThat' };

    case 'ended':
      if (s.screen !== 'player') return s;
      return { ...s, screen: 'end', playing: false, commentId: null, zoom: null, practice: null };

    case 'scrollBack':
      if (s.screen !== 'end') return s;
      return {
        ...s,
        screen: 'player',
        playing: false,
        commentId: a.commentId ?? null,
        zoom: null,
      };

    case 'playFailed':
      if (s.screen !== 'player' || !s.playing) return s;
      return { ...s, playing: false, commentId: null, zoom: null };

    case 'shareMore':
      if (s.screen !== 'end') return s;
      return { ...s, screen: 'general', commentId: a.commentId };

    case 'generalFinished':
      if (s.screen !== 'general') return s;
      return { ...s, screen: 'end', commentId: null };

    case 'commentRestarted':
      if (s.commentId === null || (s.screen !== 'player' && s.screen !== 'general')) return s;
      return { ...s, commentId: a.commentId };

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
      return {
        ...s,
        screen: 'thanks',
        playing: false,
        commentId: null,
        zoom: null,
        practice: null,
      };

    default:
      return s;
  }
}
