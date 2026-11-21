import { createWriteStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { versionDir } from '@/lib/storage/paths';
import {
  seedExport,
  seedTalkieExport,
  TALKIE_SEED,
  TALKIE_VIDEO_ID,
  VIDEO_ID,
} from '@/test/fixtures/export-seed';
import { withTmpData } from '@/test/helpers/tmpData';
import { renderFeedbackMd } from './markdown';
import { buildExportModel, type ExportModel, type ExportOptions } from './model';
import { renderReadme } from './readme';
import { writeZip } from './zip';

const NOW = new Date('2026-11-21T14:05:00.000Z');
const LATEST: ExportOptions = { version: 'latest', clips: false, since: null, partial: false };

let dir: string;
let cleanup: () => Promise<void>;

async function build(videoId: string, opts: Partial<ExportOptions> = {}): Promise<ExportModel> {
  const built = await buildExportModel(videoId, { ...LATEST, ...opts }, NOW);
  if ('pending' in built) throw new Error(`pending: ${built.pending}`);
  return built;
}

function zipEntries(path: string): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const entries = new Map<string, string>();
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e);
          const parts: Buffer[] = [];
          stream.on('data', (d: Buffer) => parts.push(d));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(parts).toString('utf8'));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(entries));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

async function zipTo(videoId: string, opts: Partial<ExportOptions> = {}) {
  const path = join(dir, 'out.zip');
  await writeZip(await build(videoId, opts), { ...LATEST, ...opts }, createWriteStream(path));
  return zipEntries(path);
}

const RED = {
  sceneId: 's01',
  sceneIndex: 0,
  sceneSrc: 'a/s01.json',
  sceneTime: 1,
  sceneFrame: 30,
  chapter: 'Red',
  caption: 'Red scene.',
};

beforeEach(async () => {
  ({ dir, cleanup } = await withTmpData());
  await seedExport();
  await seedTalkieExport();
});

afterEach(async () => {
  await cleanup();
});

describe('the export of a talkie version', () => {
  it('adds the scene, frame, chapter and caption to every moment', async () => {
    const model = await build(TALKIE_VIDEO_ID);
    const comment = model.comments.find((c) => c.commentId === TALKIE_SEED.moment);
    expect(comment?.moments.map((m) => [m.id, m.vt, m.talkie])).toEqual([
      ['moment-01', 1, RED],
      [
        'moment-02',
        3.5,
        {
          sceneId: 's02',
          sceneIndex: 1,
          sceneSrc: 'a/s02.json',
          sceneTime: 1.5,
          sceneFrame: 45,
          chapter: 'Blue',
          caption: 'Blue scene.',
        },
      ],
      [
        'moment-03',
        2,
        {
          sceneId: 's02',
          sceneIndex: 1,
          sceneSrc: 'a/s02.json',
          sceneTime: 0,
          sceneFrame: 0,
          chapter: 'Blue',
          caption: 'Blue scene.',
        },
      ],
    ]);
    expect(comment?.pausedAtFrame).toBe(30);
  });

  it('lists the film files that go into the zip', async () => {
    const model = await build(TALKIE_VIDEO_ID);
    expect(model.films).toEqual([
      {
        version: 2,
        talkie: 'media/talkie.json',
        captions: [
          { lang: 'en', label: 'English', src: 'captions/en.vtt', path: 'media/captions/en.vtt' },
        ],
      },
      {
        version: 1,
        talkie: 'previous/v1/media/talkie.json',
        captions: [
          {
            lang: 'en',
            label: 'English',
            src: 'captions/en.vtt',
            path: 'previous/v1/media/captions/en.vtt',
          },
        ],
      },
    ]);
    expect(model.previous[0].comments[0].moments[0].talkie).toMatchObject({ sceneId: 's01' });
  });

  it('keeps each version apart when every version is exported', async () => {
    const model = await build(TALKIE_VIDEO_ID, { version: 'all' });
    expect(model.films?.map((f) => [f.version, f.talkie, f.captions[0].path])).toEqual([
      [2, 'media/talkie.json', 'media/captions/en.vtt'],
      [1, 'media/v1/talkie.json', 'media/v1/captions/en.vtt'],
    ]);
  });

  it('writes the scene, frame and caption on each moment line of feedback.md', async () => {
    const md = renderFeedbackMd(await build(TALKIE_VIDEO_ID));
    expect(md).toContain(
      '- moment-01 at 0:01.0, pause, (50%, 50%), scene s01 frame 30, caption "Red scene." ![](media/'
    );
    expect(md).toContain(
      '- moment-02 at 0:03.5, click, (25%, 75%), scene s02 frame 45, caption "Blue scene." ![](media/'
    );
    expect(md).not.toContain('—');
  });

  it('escapes Markdown in the caption and leaves it out when there is none', async () => {
    const model = await build(TALKIE_VIDEO_ID);
    const [first, second] = model.comments[0].moments;
    if (!first.talkie || !second.talkie) throw new Error('no talkie info');
    first.talkie.caption = 'Tap ![x](http://evil)\n# now';
    first.talkie.sceneId = 's*1';
    second.talkie.caption = null;
    const md = renderFeedbackMd(model);
    expect(md).toContain(
      'scene s\\*1 frame 30, caption "Tap \\!\\[x\\]\\(http://evil\\) \\# now" ![]('
    );
    expect(md).toContain(', (25%, 75%), scene s02 frame 45 ![](');
  });

  it('puts talkie.json and the captions in the zip, but not the film', async () => {
    const entries = await zipTo(TALKIE_VIDEO_ID);
    const film = join(versionDir(TALKIE_VIDEO_ID, 2), 'film');
    expect(entries.get('media/talkie.json')).toBe(
      await readFile(join(film, 'talkie.json'), 'utf8')
    );
    expect(entries.get('media/captions/en.vtt')).toContain('Red scene.');
    expect(entries.get('previous/v1/media/talkie.json')).toContain('"Talkie mini"');
    expect(entries.get('previous/v1/media/captions/en.vtt')).toContain('Blue scene.');
    const names = [...entries.keys()];
    expect(names.some((n) => /s0\d\.json|narration|poster|\.lottie/.test(n))).toBe(false);
    expect(new Set(names).size).toBe(names.length);
    const json = JSON.parse(entries.get('feedback.json') ?? '');
    expect(json.comments[0].moments[0].talkie).toEqual(RED);
  });

  it('explains the Talkie fields in the README', async () => {
    const readme = renderReadme(await build(TALKIE_VIDEO_ID));
    expect(readme).toContain('## Talkie film');
    for (const term of ['`talkie`', '`sceneId`', '`sceneFrame`', 'media/talkie.json', 'captions']) {
      expect(readme).toContain(term);
    }
    expect(readme).not.toContain('—');
  });

  it('still exports when the unpacked film is missing', async () => {
    await rm(join(versionDir(TALKIE_VIDEO_ID, 2), 'film'), { recursive: true });
    const model = await build(TALKIE_VIDEO_ID);
    expect(model.comments[0].moments).toHaveLength(3);
    expect(model.comments[0].moments.every((m) => !('talkie' in m))).toBe(true);
    expect(model.films?.map((f) => f.version)).toEqual([1]);
    const entries = await zipTo(TALKIE_VIDEO_ID);
    expect(entries.has('media/talkie.json')).toBe(false);
    expect(entries.has('feedback.md')).toBe(true);
  });
});

describe('the export of an mp4 version', () => {
  it('has no talkie fields anywhere', async () => {
    const model = await build(VIDEO_ID);
    expect('films' in model).toBe(false);
    expect(model.comments.flatMap((c) => c.moments).some((m) => 'talkie' in m)).toBe(false);
    expect(JSON.stringify(model)).not.toMatch(/talkie/i);
    expect(renderFeedbackMd(model)).not.toMatch(/scene s|caption "/);
    expect(renderReadme(model)).not.toMatch(/talkie/i);
    const entries = await zipTo(VIDEO_ID);
    expect([...entries.keys()].some((n) => /talkie|captions/.test(n))).toBe(false);
  });
});
