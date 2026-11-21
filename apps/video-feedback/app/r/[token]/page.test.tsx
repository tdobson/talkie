import { createVideo, saveVideo } from '@/lib/storage/repo';
import { copy } from '@/lib/review/copy';
import type { VideoRecord } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
vi.mock('@/components/review/ReviewApp', () => ({ ReviewApp: () => null }));

const { default: ReviewPage, generateMetadata, dynamic } = await import('./page');

let cleanup: () => Promise<void>;
let video: VideoRecord;
const params = (token: string) => ({ params: Promise.resolve({ token }) });

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  const v = await createVideo('Launch film');
  video = {
    ...v,
    latestVersion: 1,
    versions: [{ version: 1, importedAt: 'now', originalFilename: 'a.mp4' }],
  };
  await saveVideo(video);
  notFound.mockClear();
});
afterEach(() => cleanup());

describe('review page /r/[token]', () => {
  it('is never cached', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('titles a valid link "Feedback: <title>" and asks robots not to index', async () => {
    const meta = await generateMetadata(params(video.token));
    expect(meta.title).toBe(copy.pageTitle('Launch film'));
    expect(meta.robots).toMatchObject({ index: false });
  });

  it('does not index an invalid link either', async () => {
    const meta = await generateMetadata(params('bogus-token'));
    expect(meta.robots).toMatchObject({ index: false });
    expect(meta.title).not.toContain('Launch film');
  });

  it('calls notFound for an invalid link and renders ReviewApp for a valid one', async () => {
    await expect(ReviewPage(params('bogus-token'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
    const el = (await ReviewPage(params(video.token))) as { props: Record<string, unknown> };
    expect(el.props).toMatchObject({ token: video.token, title: 'Launch film', latestVersion: 1 });
    expect(typeof el.props.frameDuration).toBe('number');
  });
});
