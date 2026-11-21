import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import yauzl from 'yauzl';
import type { AdminVideoSummary } from '@/lib/types';
import { apiReview, state, T } from './helpers';
import { FIXTURES } from './paths';

function zipEntries(buffer: Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const names: string[] = [];
      zip.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(names));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

test('admin imports from the inbox and downloads a zip with the feedback', async ({
  page,
  request,
}) => {
  // pendingProcessing now also waits for the comment's clip, which renders at low priority.
  test.setTimeout(240_000);
  const filename = `inbox-film-${Date.now()}.mp4`;
  const inbox = join(state().dataDir, 'inbox');
  mkdirSync(inbox, { recursive: true });
  copyFileSync(join(FIXTURES, 'h264.mp4'), join(inbox, filename));

  await page.goto('/admin/inbox');
  const row = page.getByTestId(T.adminInboxRow).filter({ hasText: filename });
  await expect(row).toBeVisible();
  await row.getByTestId(T.adminImportNew).click();
  await page.getByTestId(T.adminImportTitle).fill('Inbox film');
  await page.getByTestId(T.adminImportSubmit).click();
  await expect(page.getByTestId(T.adminInboxRow).filter({ hasText: filename })).toHaveCount(0);

  await page.goto('/admin');
  const videoRow = page.getByTestId(T.adminVideoRow).filter({ hasText: 'Inbox film' });
  await expect(videoRow).toBeVisible();
  await expect(videoRow.getByTestId(T.adminCopyLink)).toBeVisible();

  const list = await request.get('/api/admin/videos');
  expect(list.status()).toBe(200);
  const videos = (await list.json()) as AdminVideoSummary[];
  const video = videos.find((v) => v.title === 'Inbox film');
  if (!video) throw new Error('imported video missing from /api/admin/videos');
  const token = video.reviewUrl.split('/r/')[1];

  await apiReview(request, { token, videoId: video.videoId }, 'Ada Api');

  await expect
    .poll(
      async () => {
        const res = await request.get('/api/admin/videos');
        const all = (await res.json()) as AdminVideoSummary[];
        const v = all.find((x) => x.videoId === video.videoId);
        return v?.versions.reduce((n, ver) => n + ver.pendingProcessing, 0);
      },
      { timeout: 150_000, intervals: [1000] }
    )
    .toBe(0);

  const zip = await request.get(`/api/admin/videos/${video.videoId}/export.zip`);
  expect(zip.status()).toBe(200);
  const names = await zipEntries(await zip.body());
  expect(names.some((n) => n.endsWith('README.md'))).toBe(true);
  expect(names.some((n) => n.endsWith('feedback.md'))).toBe(true);
  expect(names.some((n) => n.endsWith('feedback.json'))).toBe(true);
  expect(names.some((n) => n.includes('media/'))).toBe(true);

  const etag = zip.headers().etag;
  expect(etag).toBeTruthy();
  const again = await request.get(`/api/admin/videos/${video.videoId}/export.zip`, {
    headers: { 'If-None-Match': etag },
  });
  expect(again.status()).toBe(304);
});
