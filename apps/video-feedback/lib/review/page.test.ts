import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '@/lib/storage/json';
import { filmDir, versionDir } from '@/lib/storage/paths';
import { createVideo, saveVideo } from '@/lib/storage/repo';
import type { VideoRecord } from '@/lib/types';
import { TALKIE_MINI_DIR, talkieJsonWith } from '@/test/helpers/talkieFixture';
import { withTmpData } from '@/test/helpers/tmpData';
import { DEFAULT_FRAME_DURATION, loadReviewPage } from './page';

let cleanup: () => Promise<void>;
let video: VideoRecord;

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  const v = await createVideo('Launch film');
  video = {
    ...v,
    latestVersion: 2,
    versions: [1, 2].map((version) => ({ version, importedAt: 'now', originalFilename: 'a.mp4' })),
  };
  await saveVideo(video);
});
afterEach(() => cleanup());

describe('loadReviewPage', () => {
  it('returns null for an unknown token', async () => {
    expect(await loadReviewPage('nope')).toBeNull();
  });

  it('returns null for a video with nothing imported yet', async () => {
    const empty = await createVideo('Empty');
    expect(await loadReviewPage(empty.token)).toBeNull();
  });

  it('returns the title, latest version and its frame duration', async () => {
    await mkdir(versionDir(video.videoId, 2), { recursive: true });
    await writeJsonAtomic(join(versionDir(video.videoId, 2), 'probe.json'), {
      frameDuration: 1 / 30,
    });
    expect(await loadReviewPage(video.token)).toEqual({
      title: 'Launch film',
      latestVersion: 2,
      frameDuration: 1 / 30,
      frameDurations: { 1: DEFAULT_FRAME_DURATION, 2: 1 / 30 },
    });
  });

  it('gives each version its own frame duration, for sessions resumed on an older one', async () => {
    for (const [version, fps] of [
      [1, 24],
      [2, 60],
    ]) {
      await mkdir(versionDir(video.videoId, version), { recursive: true });
      await writeJsonAtomic(join(versionDir(video.videoId, version), 'probe.json'), {
        frameDuration: 1 / fps,
      });
    }
    const page = await loadReviewPage(video.token);
    expect(page?.frameDurations).toEqual({ 1: 1 / 24, 2: 1 / 60 });
    expect(page?.frameDuration).toBe(1 / 60);
  });

  it('falls back to 25 frames a second when the probe is missing or broken', async () => {
    expect((await loadReviewPage(video.token))?.frameDuration).toBe(DEFAULT_FRAME_DURATION);
    await mkdir(versionDir(video.videoId, 2), { recursive: true });
    await writeJsonAtomic(join(versionDir(video.videoId, 2), 'probe.json'), { frameDuration: 0 });
    expect((await loadReviewPage(video.token))?.frameDuration).toBe(DEFAULT_FRAME_DURATION);
  });
});

describe('loadReviewPage with Talkie versions', () => {
  beforeEach(async () => {
    // Version 1 stays an MP4, version 2 becomes a Talkie film.
    video = {
      ...video,
      versions: [
        video.versions[0],
        { version: 2, importedAt: 'now', originalFilename: 'a.lottie', mediaKind: 'talkie' },
      ],
    };
    await saveVideo(video);
    await cp(TALKIE_MINI_DIR, filmDir(video.videoId, 2), { recursive: true });
    await writeJsonAtomic(join(versionDir(video.videoId, 2), 'probe.json'), {
      frameDuration: 1 / 30,
    });
  });

  it('gives the media kind of every version and the poster URL of each film', async () => {
    expect(await loadReviewPage(video.token)).toEqual({
      title: 'Launch film',
      latestVersion: 2,
      frameDuration: 1 / 30,
      frameDurations: { 1: DEFAULT_FRAME_DURATION, 2: 1 / 30 },
      mediaKinds: { 1: 'mp4', 2: 'talkie' },
      posterUrls: { 2: `/api/r/${video.token}/film/poster.png?version=2` },
    });
  });

  it('points the poster URL at the film route, path segment by segment', async () => {
    const film = filmDir(video.videoId, 2);
    await writeFile(
      join(film, 'talkie.json'),
      await talkieJsonWith({ poster: { png: 'art/poster_one+two.png' } })
    );
    expect((await loadReviewPage(video.token))?.posterUrls).toEqual({
      2: `/api/r/${video.token}/film/art/poster_one%2Btwo.png?version=2`,
    });
  });

  it('gives no poster for a film whose talkie.json cannot be read', async () => {
    await writeFile(join(filmDir(video.videoId, 2), 'talkie.json'), '{nope');
    const page = await loadReviewPage(video.token);
    expect(page?.mediaKinds).toEqual({ 1: 'mp4', 2: 'talkie' });
    expect(page?.posterUrls).toEqual({});
  });

  it('leaves both fields off a video with only MP4 versions', async () => {
    const plain = await createVideo('Plain');
    await saveVideo({
      ...plain,
      latestVersion: 1,
      versions: [{ version: 1, importedAt: 'now', originalFilename: 'a.mp4' }],
    });
    const page = await loadReviewPage(plain.token);
    expect(page).not.toBeNull();
    expect(page).not.toHaveProperty('mediaKinds');
    expect(page).not.toHaveProperty('posterUrls');
  });
});
