import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { saveVideo } from '@/lib/storage/repo';
import { sourcePath, versionDir } from '@/lib/storage/paths';
import type { VideoRecord } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import type { FrameSource } from './frame-source';
import { frameSourceFactory, frameSourceFor } from './frame-sources';
import { fx } from './testutil';

const FIXTURE_FILM = fileURLToPath(new URL('../../test/fixtures/talkie-mini', import.meta.url));

const video: VideoRecord = {
  videoId: 'mixed-video',
  title: 'Mixed',
  token: 'tok',
  createdAt: '2026-11-21T10:00:00.000Z',
  latestVersion: 4,
  versions: [
    { version: 1, importedAt: '2026-11-21T10:00:00.000Z', originalFilename: 'a.mp4' },
    {
      version: 2,
      importedAt: '2026-11-21T10:00:00.000Z',
      originalFilename: 'b.mp4',
      mediaKind: 'mp4',
    },
    {
      version: 3,
      importedAt: '2026-11-21T10:00:00.000Z',
      originalFilename: 'c.lottie',
      mediaKind: 'talkie',
    },
    {
      version: 4,
      importedAt: '2026-11-21T10:00:00.000Z',
      originalFilename: 'd.lottie',
      mediaKind: 'talkie',
    },
  ],
};

let cleanup: () => Promise<void>;
const fake: FrameSource = { frame: async () => Buffer.from('talkie'), close: async () => {} };
const talkie = vi.fn(() => fake);

async function putMp4(videoId: string, version: number): Promise<void> {
  const src = sourcePath(videoId, version);
  await mkdir(dirname(src), { recursive: true });
  await copyFile(fx('h264.mp4'), src);
}

beforeAll(async () => {
  ({ cleanup } = await withTmpData());
  await saveVideo(video);
  await putMp4(video.videoId, 1);
  await putMp4(video.videoId, 2);
  await putMp4('no-record', 1);
  const film = join(versionDir(video.videoId, 3), 'film');
  await mkdir(film, { recursive: true });
  await copyFile(join(FIXTURE_FILM, 'talkie.json'), join(film, 'talkie.json'));
});
afterAll(async () => {
  await cleanup();
});
beforeEach(() => {
  talkie.mockClear();
});

async function width(source: FrameSource): Promise<number> {
  return (await sharp(await source.frame(1, 4000)).metadata()).width;
}

describe('frameSourceFor', () => {
  const pick = frameSourceFactory({ talkie });

  it('reads the video with ffmpeg when the version has no media kind', async () => {
    expect(await width(await pick(video.videoId, 1))).toBe(640);
    expect(talkie).not.toHaveBeenCalled();
  });

  it('reads the video with ffmpeg for an mp4 version', async () => {
    expect(await width(await pick(video.videoId, 2))).toBe(640);
    expect(talkie).not.toHaveBeenCalled();
  });

  it('reads the video with ffmpeg when there is no video record at all', async () => {
    expect(await width(await frameSourceFor('no-record', 1))).toBe(640);
  });

  it('draws a talkie version from its film folder, at the size in talkie.json', async () => {
    const source = await pick(video.videoId, 3);
    expect(source).toBe(fake);
    expect(talkie).toHaveBeenCalledTimes(1);
    expect(talkie).toHaveBeenCalledWith(join(versionDir(video.videoId, 3), 'film'), {
      width: 320,
      height: 180,
    });
  });

  it('fails clearly when a talkie version has no readable film', async () => {
    await expect(pick(video.videoId, 4)).rejects.toThrow(/film.*version 4/i);
    expect(talkie).not.toHaveBeenCalled();
  });

  it('refuses unsafe ids before touching the disk', async () => {
    await expect(pick('../etc', 1)).rejects.toThrow(/Invalid video id/);
  });
});
