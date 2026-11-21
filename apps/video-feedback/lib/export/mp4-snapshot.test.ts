import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { seedExport, VIDEO_ID } from '@/test/fixtures/export-seed';
import { withTmpData } from '@/test/helpers/tmpData';
import { renderFeedbackMd } from './markdown';
import { buildExportModel, type ExportOptions } from './model';
import { renderReadme } from './readme';
import { writeZip } from './zip';

// The MP4 export must not change when Talkie support is added: these snapshots were taken
// before any Talkie export code existed. Do not update them for a Talkie change.

const NOW = new Date('2026-11-21T14:05:00.000Z');

function zipNames(path: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const names: string[] = [];
      zip.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(names.sort()));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

describe('the mp4 export', () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await withTmpData());
    await seedExport();
  });

  afterEach(async () => {
    await cleanup();
  });

  for (const version of ['latest', 'all'] as const) {
    it(`is unchanged for version ${version}`, async () => {
      const opts: ExportOptions = { version, clips: false, since: null, partial: false };
      const model = await buildExportModel(VIDEO_ID, opts, NOW);
      if ('pending' in model) throw new Error('pending');
      expect(`${JSON.stringify(model, null, 2)}\n`).toMatchSnapshot('feedback.json');
      expect(renderFeedbackMd(model)).toMatchSnapshot('feedback.md');
      expect(renderReadme(model)).toMatchSnapshot('README.md');
      const path = join(dir, 'out.zip');
      await writeZip(model, opts, createWriteStream(path));
      expect(await zipNames(path)).toMatchSnapshot('zip entries');
    });
  }
});
