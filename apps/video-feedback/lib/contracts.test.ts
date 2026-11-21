import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { T } from '@/lib/testids';
import * as constants from '@/lib/constants';
import type {
  CaptureEvent,
  CommentMeta,
  SceneWarningEvent,
  TalkieMomentInfo,
  VersionRecord,
} from '@/lib/types';
import type { FrameSource, FrameSourceFactory } from '@/lib/media/frame-source';
import type { MediaAdapter, MediaAdapterEvent } from '@/components/review/media/adapter';
import { copy } from '@/lib/review/copy';
import { notifyCommentComplete, setCommentCompleteHandler } from '@/lib/pipeline/enqueue';

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (typeof v === 'function') return [String((v as (s: string) => string)('X'))];
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}
const fx = (n: string) => JSON.parse(readFileSync(join(__dirname, '../test/fixtures', n), 'utf8'));

describe('contracts', () => {
  it('test ids are unique', () => {
    const vals = Object.values(T);
    expect(new Set(vals).size).toBe(vals.length);
  });
  it('reviewer copy has no em-dashes', () => {
    for (const s of strings(copy)) expect(s).not.toContain('—');
  });
  it('reviewer copy shows no timecodes', () => {
    for (const s of strings(copy)) expect(s).not.toMatch(/\d+:\d{2}/);
  });
  it('the Phase 6 additions are folded into copy and test ids', () => {
    expect(existsSync(join(__dirname, 'review/additions.ts'))).toBe(false);
    expect(copy.micCheck.heard).toBe('Got you, loud and clear.');
    expect(copy.player.videoError).toBe(
      "We couldn't load the video. Check your connection and reload."
    );
    expect(copy.player.reload).toBe('Reload');
    expect(copy.player.stoppedHelp).toBe('Press play, then pause again to carry on.');
    expect(copy.general.stoppedHelp).toBe('Press "Finished, save that" to keep what you said.');
    expect(copy.micCheck.quietHelp).toContain("Can't see the meter move?");
    expect(copy.micDenied.noDevice).toContain("couldn't find a microphone");
    expect(T.videoError).toBe('video-error');
    expect(T.videoReload).toBe('video-reload');
    expect(T.videoLoading).toBe('video-loading');
    expect(T.commentStopped).toBe('comment-stopped');
    expect(T.micStillLost).toBe('mic-still-lost');
    expect(T.micCheckHelp).toBe('mic-check-help');
    expect(T.micNoDevice).toBe('mic-no-device');
  });
  it('Talkie copy, test ids and limits are in place', () => {
    expect(T.captionPlate).toBe('caption-plate');
    expect(T.captionsToggle).toBe('captions-toggle');
    expect(copy.player.captionsOn).toBe('Captions on');
    expect(copy.player.captionsOff).toBe('Captions off');
    expect(copy.admin.filmInvalid).toBe('This film did not pass validation: {errors}');
    expect(copy.admin.filmVersion).toBe(
      'This film needs Talkie version {major}, which this tool does not read yet.'
    );
    expect(copy.admin.chromiumMissing).toBe(
      'Chromium is not installed for Talkie stills; see DEPLOY.md'
    );
    expect(constants.FILM_MAX_UNPACKED_BYTES).toBe(500 * 1024 * 1024);
    expect(constants.FILM_MAX_ENTRIES).toBe(2000);
    expect(constants.TALKIE_FRAME_TIMEOUT_MS).toBe(30_000);
    expect(constants.TALKIE_BROWSER_IDLE_MS).toBe(120_000);
  });
  it('the Talkie types hold the planned shapes', () => {
    const v: VersionRecord = {
      version: 2,
      importedAt: '2026-11-21T00:00:00.000Z',
      originalFilename: 'promo.lottie',
      mediaKind: 'talkie',
    };
    const flags: Pick<CommentMeta, 'mediaKind' | 'cutShort'> = {
      mediaKind: 'talkie',
      cutShort: true,
    };
    const warn: SceneWarningEvent = { t: 10, type: 'sceneWarning', sceneId: 's03' };
    const ev: CaptureEvent = warn;
    const info: TalkieMomentInfo = {
      sceneId: 's03',
      sceneIndex: 2,
      sceneSrc: 'a/s03.json',
      sceneTime: 1.84,
      sceneFrame: 55,
      chapter: null,
      caption: null,
    };
    const src: FrameSource = { frame: async () => Buffer.alloc(0), close: async () => {} };
    const factory: FrameSourceFactory = async () => src;
    const names: MediaAdapterEvent[] = [
      'play',
      'pause',
      'seeking',
      'seeked',
      'timeupdate',
      'waiting',
      'playing',
      'ended',
      'loadedmetadata',
      'error',
    ];
    const kind: MediaAdapter['kind'] = 'talkie';
    expect([v.mediaKind, flags.cutShort, ev.type, info.sceneFrame, kind]).toEqual([
      'talkie',
      true,
      'sceneWarning',
      55,
      'talkie',
    ]);
    expect(typeof factory).toBe('function');
    expect(new Set(names).size).toBe(10);
  });
  it('copy functions interpolate', () => {
    expect(copy.pageTitle('Promo')).toBe('Feedback: Promo');
    expect(copy.thanks.title('Sarah')).toBe('Thanks, Sarah.');
  });
  it('enqueue forwards to the handler and is a no-op without one', () => {
    const ref = { videoId: 'v', sessionId: 's', commentId: 'c' };
    setCommentCompleteHandler(null);
    expect(() => notifyCommentComplete(ref)).not.toThrow();
    const h = vi.fn();
    setCommentCompleteHandler(h);
    notifyCommentComplete(ref);
    expect(h).toHaveBeenCalledWith(ref);
    setCommentCompleteHandler(null);
  });
  it('events fixture matches the plan', () => {
    const ev = fx('events-basic.json') as Array<Record<string, unknown>>;
    const ts = ev.map((e) => e.t as number);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    const rest = ev.filter(
      (e) => e.type === 'pointer' && (e.t as number) >= 2800 && (e.t as number) <= 3900
    );
    expect(rest.length).toBeGreaterThan(0);
    for (const p of rest) {
      expect(p.x).toBeCloseTo(0.12, 2);
      expect(p.y).toBeCloseTo(0.08, 2);
    }
    expect(ev.some((e) => e.type === 'click' && e.t === 7800)).toBe(true);
    expect(ev.some((e) => e.type === 'seek' && e.t === 5000)).toBe(true);
    expect(ev.filter((e) => String(e.type).startsWith('zoom')).length).toBeGreaterThanOrEqual(2);
  });
  it('transcript fixture has deictic words at the planned times', () => {
    const tr = fx('transcript-basic.json') as { words: { word: string; start: number }[] };
    expect(tr.words.find((w) => w.word === 'this')?.start).toBe(3.2);
    expect(tr.words.find((w) => w.word === 'here')?.start).toBe(7.8);
  });
});
