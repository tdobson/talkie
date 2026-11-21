import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '@/lib/storage/json';
import { versionDir } from '@/lib/storage/paths';
import { createVideo, saveVideo } from '@/lib/storage/repo';
import type { VideoRecord } from '@/lib/types';
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
    });
  });

  it('falls back to 25 frames a second when the probe is missing or broken', async () => {
    expect((await loadReviewPage(video.token))?.frameDuration).toBe(DEFAULT_FRAME_DURATION);
    await mkdir(versionDir(video.videoId, 2), { recursive: true });
    await writeJsonAtomic(join(versionDir(video.videoId, 2), 'probe.json'), { frameDuration: 0 });
    expect((await loadReviewPage(video.token))?.frameDuration).toBe(DEFAULT_FRAME_DURATION);
  });
});
