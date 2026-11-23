import type { ZoomState } from '@/lib/types';
import { initialState, type ReviewState, reducer } from './machine';

const playerState: ReviewState = {
  ...initialState,
  screen: 'player',
  name: 'Sarah',
  sessionId: 'sid',
  version: 1,
};
const zoom: ZoomState = { scale: 2.5, originX: 0.5, originY: 0.5 };

describe('review machine', () => {
  it('walks welcome -> micExplain -> micCheck -> player', () => {
    let s = reducer(initialState, { type: 'submitName', name: '  Sarah ' });
    expect(s).toMatchObject({ screen: 'micExplain', name: 'Sarah' });
    s = reducer(s, { type: 'micExplained' });
    s = reducer(s, { type: 'micGranted' });
    expect(s.screen).toBe('micCheck');
    s = reducer(s, { type: 'micHeard' });
    s = reducer(s, { type: 'sessionStarted', sessionId: 'sid', version: 2 });
    expect(s).toMatchObject({ screen: 'player', sessionId: 'sid', version: 2, playing: false });
  });

  it('ignores an empty name', () =>
    expect(reducer(initialState, { type: 'submitName', name: '  ' }).screen).toBe('welcome'));

  it('resumed sessions skip the name but not the mic check', () => {
    const s = reducer(initialState, {
      type: 'loadedResumable',
      sessionId: 'sid',
      version: 1,
      name: 'Sarah',
    });
    expect(s.screen).toBe('micExplain');
    expect(s.resumed).toBe(true);
    expect(s).toMatchObject({ sessionId: 'sid', version: 1, name: 'Sarah' });
    const checked = reducer(reducer(s, { type: 'micExplained' }), { type: 'micGranted' });
    expect(checked.screen).toBe('micCheck');
  });

  it('a reviewer back after a newer version gets a new session, with their name kept', () => {
    const s = reducer(initialState, {
      type: 'loadedNewerVersion',
      name: 'Sarah',
      previousVersion: 1,
    });
    expect(s).toMatchObject({
      screen: 'micExplain',
      name: 'Sarah',
      sessionId: null,
      version: null,
      resumed: true,
      newerThan: 1,
    });
    // Ignored once past the welcome screen.
    expect(reducer(s, { type: 'loadedNewerVersion', name: 'X', previousVersion: 1 })).toBe(s);
  });

  it('a phone shows the mobile screen and stays there', () => {
    const s = reducer(initialState, { type: 'detectedMobile' });
    expect(s.screen).toBe('mobile');
    expect(reducer(s, { type: 'submitName', name: 'Sarah' }).screen).toBe('mobile');
    expect(
      reducer(s, { type: 'loadedResumable', sessionId: 'sid', version: 1, name: 'Sarah' }).screen
    ).toBe('mobile');
  });

  it('a denied microphone can be retried', () => {
    let s = reducer(
      { ...initialState, screen: 'micExplain', name: 'Sarah' },
      { type: 'micDenied' }
    );
    expect(s.screen).toBe('micDenied');
    s = reducer(s, { type: 'micRetry' });
    expect(s.screen).toBe('micExplain');
    expect(reducer(s, { type: 'micGranted' }).screen).toBe('micCheck');
  });

  it('the session cannot start before the mic check', () => {
    const s = reducer(initialState, { type: 'sessionStarted', sessionId: 'sid', version: 1 });
    expect(s.screen).toBe('welcome');
  });

  it('pause while playing opens a comment', () => {
    const s = reducer({ ...playerState, playing: true }, { type: 'pause', commentId: 'c1' });
    expect(s).toMatchObject({ playing: false, commentId: 'c1' });
  });

  it('pause while already paused changes nothing', () => {
    const paused = { ...playerState, playing: false, commentId: 'c1' };
    expect(reducer(paused, { type: 'pause', commentId: 'c2' })).toBe(paused);
  });

  it('ignores zoom while playing', () => {
    const playing = { ...playerState, playing: true };
    expect(reducer(playing, { type: 'zoomStart', zoom }).zoom).toBeNull();
  });

  it('zooms, pans and unzooms while paused', () => {
    let s = reducer({ ...playerState, commentId: 'c' }, { type: 'zoomStart', zoom });
    expect(s.zoom).toEqual(zoom);
    s = reducer(s, { type: 'zoomPan', originX: 0.2, originY: 0.3 });
    expect(s.zoom).toEqual({ scale: 2.5, originX: 0.2, originY: 0.3 });
    s = reducer(s, { type: 'zoomEnd' });
    expect(s.zoom).toBeNull();
  });

  it('ignores a pan with no zoom, and zoom away from the player', () => {
    expect(reducer(playerState, { type: 'zoomPan', originX: 0.2, originY: 0.3 }).zoom).toBeNull();
    expect(reducer({ ...playerState, screen: 'end' }, { type: 'zoomStart', zoom }).zoom).toBeNull();
  });

  it('play clears the open comment and zoom', () => {
    const s = reducer(
      {
        ...playerState,
        playing: false,
        commentId: 'c',
        zoom: { scale: 2.5, originX: 0.1, originY: 0.1 },
      },
      { type: 'play' }
    );
    expect(s).toMatchObject({ playing: true, commentId: null, zoom: null });
  });

  it('the end of the video shows the end screen and closes any comment', () => {
    const s = reducer({ ...playerState, playing: true, commentId: 'c', zoom }, { type: 'ended' });
    expect(s).toMatchObject({ screen: 'end', playing: false, commentId: null, zoom: null });
  });

  it('scrolling back from the end returns to the player, paused, with no comment', () => {
    const s = reducer({ ...playerState, screen: 'end' }, { type: 'scrollBack' });
    expect(s).toMatchObject({ screen: 'player', playing: false, commentId: null });
    expect(reducer(playerState, { type: 'scrollBack' })).toBe(playerState);
  });

  it('scrolling back from the end can open a comment on the frame it lands on', () => {
    const s = reducer({ ...playerState, screen: 'end' }, { type: 'scrollBack', commentId: 'c9' });
    expect(s).toMatchObject({ screen: 'player', playing: false, commentId: 'c9' });
  });

  it('a play that did not start goes back to paused with no comment', () => {
    const s = reducer({ ...playerState, playing: true }, { type: 'playFailed' });
    expect(s).toMatchObject({ screen: 'player', playing: false, commentId: null });
    const paused = { ...playerState, playing: false, commentId: 'c' };
    expect(reducer(paused, { type: 'playFailed' })).toBe(paused);
  });

  it('play from the end screen goes back to the player', () => {
    const s = reducer({ ...playerState, screen: 'end' }, { type: 'play' });
    expect(s).toMatchObject({ screen: 'player', playing: true });
  });

  it('general comment returns to the end screen', () => {
    let s = reducer({ ...playerState, screen: 'end' }, { type: 'shareMore', commentId: 'g1' });
    expect(s).toMatchObject({ screen: 'general', commentId: 'g1' });
    s = reducer(s, { type: 'generalFinished' });
    expect(s).toMatchObject({ screen: 'end', commentId: null });
  });

  it('play and pause do nothing during a general comment', () => {
    const general: ReviewState = { ...playerState, screen: 'general', commentId: 'g1' };
    expect(reducer(general, { type: 'play' })).toBe(general);
    expect(reducer(general, { type: 'pause', commentId: 'c' })).toBe(general);
  });

  it('a restarted comment replaces the open one, and only an open one', () => {
    const paused: ReviewState = { ...playerState, playing: false, commentId: 'c1' };
    expect(reducer(paused, { type: 'commentRestarted', commentId: 'c2' })).toMatchObject({
      screen: 'player',
      playing: false,
      commentId: 'c2',
    });
    const general: ReviewState = { ...playerState, screen: 'general', commentId: 'g1' };
    expect(reducer(general, { type: 'commentRestarted', commentId: 'g2' }).commentId).toBe('g2');
    const playing: ReviewState = { ...playerState, playing: true };
    expect(reducer(playing, { type: 'commentRestarted', commentId: 'c2' })).toBe(playing);
    const end: ReviewState = { ...playerState, screen: 'end' };
    expect(reducer(end, { type: 'commentRestarted', commentId: 'c2' })).toBe(end);
  });

  it('tracks a lost and reconnected microphone', () => {
    const lost = reducer(playerState, { type: 'micLost' });
    expect(lost.micLost).toBe(true);
    expect(reducer(lost, { type: 'micReconnected' }).micLost).toBe(false);
  });

  it('done goes to thanks from the player or the end, even with a comment open', () => {
    expect(reducer(playerState, { type: 'done' }).screen).toBe('thanks');
    expect(reducer({ ...playerState, screen: 'end' }, { type: 'done' }).screen).toBe('thanks');
    const open = reducer({ ...playerState, commentId: 'c', zoom }, { type: 'done' });
    expect(open).toMatchObject({ screen: 'thanks', commentId: null, zoom: null, playing: false });
    expect(reducer(initialState, { type: 'done' }).screen).toBe('welcome');
  });

  describe('practice', () => {
    const micCheck: ReviewState = { ...initialState, screen: 'micCheck', name: 'Sarah' };
    const coach = reducer(micCheck, {
      type: 'sessionStarted',
      sessionId: 'sid',
      version: 1,
      practice: true,
    });

    it('a new session starts on the practice card, an old one does not', () => {
      expect(coach).toMatchObject({ screen: 'player', practice: 'intro', playing: false });
      const plain = reducer(micCheck, { type: 'sessionStarted', sessionId: 'sid', version: 1 });
      expect(plain.practice).toBeNull();
    });

    it('play keeps the coach mark; a practice pause opens no comment', () => {
      let s = reducer(coach, { type: 'play' });
      expect(s).toMatchObject({ playing: true, practice: 'coach' });
      s = reducer(s, { type: 'practicePause' });
      expect(s).toMatchObject({ playing: false, practice: 'listening', commentId: null });
    });

    it('heard, then back to the start for real; the browser has now practised', () => {
      let s = reducer(reducer(coach, { type: 'play' }), { type: 'practicePause' });
      expect(s.practised).toBe(false);
      s = reducer(s, { type: 'practiceHeard' });
      expect(s.practice).toBe('gotThat');
      expect(s.practised).toBe(true);
      s = reducer(s, { type: 'play' });
      expect(s).toMatchObject({ playing: true, practice: null, commentId: null });
    });

    it('pressing play while listening also ends the practice', () => {
      const s = reducer(reducer(reducer(coach, { type: 'play' }), { type: 'practicePause' }), {
        type: 'play',
      });
      expect(s).toMatchObject({ playing: true, practice: null });
    });

    it('practice actions do nothing outside the practice', () => {
      expect(reducer(playerState, { type: 'practicePause' })).toBe(playerState);
      expect(reducer(playerState, { type: 'practiceHeard' })).toBe(playerState);
      expect(reducer(coach, { type: 'practicePause' })).toBe(coach); // not playing yet
      expect(reducer(coach, { type: 'practiceHeard' })).toBe(coach);
    });

    it('a real pause never happens during the practice', () => {
      const playing = reducer(coach, { type: 'play' });
      expect(reducer(playing, { type: 'pause', commentId: 'c' })).toBe(playing);
    });

    it('the film ending or Done drops the practice', () => {
      const playing = reducer(coach, { type: 'play' });
      expect(reducer(playing, { type: 'ended' }).practice).toBeNull();
      expect(reducer(playing, { type: 'done' }).practice).toBeNull();
    });
  });

  describe('what the browser remembers', () => {
    it('a known name and the checks it passed are loaded on the welcome screen', () => {
      const s = reducer(initialState, {
        type: 'loadedProfile',
        name: 'Tim',
        micChecked: true,
        practised: true,
      });
      expect(s).toMatchObject({
        screen: 'welcome',
        name: 'Tim',
        micChecked: true,
        practised: true,
      });
      // Too late once the review is under way.
      const player = { ...initialState, screen: 'player' as const };
      expect(
        reducer(player, { type: 'loadedProfile', name: 'X', micChecked: true, practised: true })
      ).toBe(player);
    });

    it('a session this browser started here counts as both checks done', () => {
      const resumed = reducer(initialState, {
        type: 'loadedResumable',
        sessionId: 'sid',
        version: 1,
        name: 'Sarah',
      });
      expect(resumed).toMatchObject({ micChecked: true, practised: true });
      const newer = reducer(initialState, {
        type: 'loadedNewerVersion',
        name: 'Sarah',
        previousVersion: 1,
      });
      expect(newer).toMatchObject({ micChecked: true, practised: true });
    });

    it('saying hello now does not skip the hello screen it is on', () => {
      const s = { ...initialState, screen: 'micCheck' as const };
      expect(reducer(s, { type: 'micHeard' })).toBe(s);
    });
  });
});
