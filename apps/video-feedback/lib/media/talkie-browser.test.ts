import { copy } from '@/lib/review/copy';
import { talkieFrameSource } from './frame-source-talkie';
import { chromiumPath, openTalkieBrowser, renderPageDir } from './talkie-browser';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('openTalkieBrowser', () => {
  it('says Chromium is not installed when the browser file is missing', async () => {
    await expect(
      openTalkieBrowser('/no/film', { executablePath: '/no/such/chromium' })
    ).rejects.toThrow(copy.admin.chromiumMissing);
  });

  it('gives the frame source the same message through TALKIE_CHROMIUM_PATH', async () => {
    vi.stubEnv('TALKIE_CHROMIUM_PATH', '/no/such/chromium');
    expect(chromiumPath()).toBe('/no/such/chromium');
    const source = talkieFrameSource('/no/film', { width: 320, height: 180 });
    await expect(source.frame(1, 320)).rejects.toThrow(copy.admin.chromiumMissing);
    await source.close();
  });

  it('looks for the render page under the working folder unless told otherwise', () => {
    vi.stubEnv('TALKIE_RENDER_PAGE_DIR', '');
    delete process.env.TALKIE_RENDER_PAGE_DIR;
    expect(renderPageDir()).toBe(`${process.cwd()}/lib/media/talkie-render-page/dist`);
    vi.stubEnv('TALKIE_RENDER_PAGE_DIR', '/srv/render-page');
    expect(renderPageDir()).toBe('/srv/render-page');
  });
});
