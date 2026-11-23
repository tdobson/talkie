import { resetConfigForTests } from '@/lib/config';
import { SEED, seedExport, VIDEO_ID } from '@/test/fixtures/export-seed';
import { withTmpData } from '@/test/helpers/tmpData';
import { GET as GET_JSON } from '../../../export.json/route';
import { GET } from './route';

let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  process.env.ADMIN_AUTH = 'off';
  resetConfigForTests();
  await seedExport();
});

afterEach(async () => {
  delete process.env.ADMIN_AUTH;
  resetConfigForTests();
  await cleanup();
});

const media = (commentId: string, name: string, videoId = VIDEO_ID) =>
  GET(new Request(`http://localhost/api/admin/videos/${videoId}/media/${commentId}/${name}`), {
    params: Promise.resolve({ videoId, commentId, name }),
  });

describe('comment media', () => {
  it('needs admin', async () => {
    process.env.ADMIN_AUTH = 'cloudflare';
    resetConfigForTests();
    expect((await media(SEED.devMoment, 'moment-01.jpg')).status).toBe(401);
  });

  it('serves every media path export.json names, as it names them', async () => {
    const res = await GET_JSON(
      new Request(`http://localhost/api/admin/videos/${VIDEO_ID}/export.json?partial=1`),
      { params: Promise.resolve({ videoId: VIDEO_ID }) }
    );
    const model = (await res.json()) as {
      comments: {
        commentId: string;
        moments: { image: string; zoomImage: string | null }[];
        files: { overview: string | null; audio: string };
      }[];
    };
    const paths = model.comments.flatMap((c) => [
      c.files.audio,
      ...(c.files.overview ? [c.files.overview] : []),
      ...c.moments.flatMap((m) => [m.image, ...(m.zoomImage ? [m.zoomImage] : [])]),
    ]);
    expect(paths).toContain(`media/${SEED.devMoment}/moment-03-zoom.jpg`);
    for (const path of paths) {
      const [, commentId, name] = path.split('/');
      const got = await media(commentId, name);
      expect(got.status, path).toBe(200);
      expect(got.headers.get('Cache-Control')).toBe('private, no-cache');
    }
    const still = await media(SEED.devMoment, 'moment-01.jpg');
    expect(still.headers.get('Content-Type')).toBe('image/jpeg');
    expect(await still.text()).toBe('jpg');
    expect((await media(SEED.devMoment, 'audio.webm')).headers.get('Content-Type')).toBe(
      'audio/webm'
    );
  });

  it('serves nothing else', async () => {
    for (const name of [
      'meta.json',
      'events.json',
      'status.json',
      '..%2Fmeta.json',
      'moment-1.jpg',
      'moment-09.png',
    ]) {
      expect((await media(SEED.devMoment, name)).status, name).toBe(404);
    }
    // A still that was never drawn, a comment that is not there, and a bad video id.
    expect((await media(SEED.devMoment, 'moment-09.jpg')).status).toBe(404);
    expect((await media('40000000-0000-4000-8000-000000000001', 'overview.jpg')).status).toBe(404);
    expect((await media('not-a-uuid', 'overview.jpg')).status).toBe(404);
    expect((await media(SEED.devMoment, 'overview.jpg', 'Bad/Id')).status).toBe(404);
  });
});
