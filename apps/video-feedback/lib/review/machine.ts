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
 * The practice run a browser gets once, before its first real review. A card says how giving
 * feedback works (`intro`). Play starts the film under a coach mark on Pause (`coach`). A pause
 * listens without recording anything (`listening`), and as soon as they speak it says so
 * (`gotThat`) and the film starts again from the beginning for real. Null outside the practice.
 */
export type Practice = 'intro' | 'coach' | 'listening' | 'gotThat' | null;

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
  /**
   * This browser had passed the "say hello" check before this visit: it is not asked again.
   * Passing it now does not change this (the screen shows its own "Got you" first).
   */
  micChecked: boolean;
  /** This browser has done the practice before: it is not offered again. */
  practised: boolean;
  /**
   * Paused, but no longer recording: the comment ended on its own, after a long quiet
   * (`silence`: talking again starts a new one), at the longest a comment may be (`cap`: only
   * Say more or play carries on), or because the tab lost focus (`focus`: coming back to it
   * starts a new one). Null otherwise.
   */
  held: HeldReason | null;
}

/** Why a paused comment stopped recording on its own. */
export type HeldReason = 'silence' | 'cap' | 'focus';

export type ReviewAction =
  | { type: 'detectedMobile' }
  /** What this browser remembers from earlier reviews, of any film. */
  | { type: 'loadedProfile'; name: string; micChecked: boolean; practised: boolean }
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
   * The open moment comment ended on its own: a long quiet, the longest a comment may be, or
   * the tab losing focus.
   */
  | { type: 'commentEnded'; reason: HeldReason }
  /** Still paused after a comment ended on its own: a new comment starts here. */
  | { type: 'commentResumed'; commentId: string }
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
  micChecked: false,
  practised: false,
  held: null,
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

    case 'loadedProfile':
      if (s.screen !== 'welcome') return s;
      return { ...s, name: a.name, micChecked: a.micChecked, practised: a.practised };

    // A session this browser started on this link: it has been through the checks already.
    case 'loadedResumable':
      if (s.screen !== 'welcome') return s;
      return {
        ...s,
        micChecked: true,
        practised: true,
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
        micChecked: true,
        practised: true,
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
        practice: a.practice ? 'intro' : null,
      };

    case 'play': {
      if (s.screen !== 'player' && s.screen !== 'end') return s;
      if (s.screen === 'player' && s.playing) return s;
      // Play on the practice card starts the practice; after the practice pause, the real thing.
      const practice = s.practice === 'coach' || s.practice === 'intro' ? 'coach' : null;
      return {
        ...s,
        screen: 'player',
        playing: true,
        commentId: null,
        zoom: null,
        practice,
        held: null,
      };
    }

    case 'pause':
      if (s.screen !== 'player' || !s.playing || s.practice !== null) return s;
      return { ...s, playing: false, commentId: a.commentId };

    case 'practicePause':
      if (s.screen !== 'player' || !s.playing || s.practice !== 'coach') return s;
      return { ...s, playing: false, commentId: null, practice: 'listening' };

    case 'practiceHeard':
      if (s.screen !== 'player' || s.practice !== 'listening') return s;
      return { ...s, practice: 'gotThat', practised: true };

    case 'ended':
      if (s.screen !== 'player') return s;
      return {
        ...s,
        screen: 'end',
        playing: false,
        commentId: null,
        zoom: null,
        practice: null,
        held: null,
      };

    case 'scrollBack':
      if (s.screen !== 'end') return s;
      return {
        ...s,
        screen: 'player',
        playing: false,
        commentId: a.commentId ?? null,
        zoom: null,
        held: null,
      };

    case 'playFailed':
      if (s.screen !== 'player' || !s.playing) return s;
      return { ...s, playing: false, commentId: null, zoom: null, held: null };

    case 'shareMore':
      if (s.screen !== 'end') return s;
      return { ...s, screen: 'general', commentId: a.commentId };

    case 'generalFinished':
      if (s.screen !== 'general') return s;
      return { ...s, screen: 'end', commentId: null };

    case 'commentEnded':
      if (s.screen !== 'player' || s.playing || s.commentId === null) return s;
      return { ...s, commentId: null, zoom: null, held: a.reason };

    case 'commentResumed':
      if (s.screen !== 'player' || s.playing || s.held === null) return s;
      return { ...s, commentId: a.commentId, held: null };

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
        held: null,
      };

    default:
      return s;
  }
}
