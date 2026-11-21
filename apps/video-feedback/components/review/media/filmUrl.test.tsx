import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFilm, type TalkieFilm } from '@talkie/format';
import { filmFolderUrl } from './filmUrl';

const FIXTURE = join(process.cwd(), 'test/fixtures/talkie-mini');
const ORIGIN = 'http://review.test';
const FOLDER = '/api/r/tok/film/3/';

describe('filmFolderUrl', () => {
  it('names the version in the path, and ends in a slash', () => {
    expect(filmFolderUrl('tok', 3)).toBe(FOLDER);
    expect(filmFolderUrl('a b/c', 12)).toBe('/api/r/a%20b%2Fc/film/12/');
  });

  // The real openFilm resolves each file against the folder with `new URL(path, base)`, which
  // drops a query string on the base. Whatever names the version has to survive that.
  it('every file openFilm asks for still names the token and the version', async () => {
    const requested: string[] = [];
    const fetchFixture = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requested.push(url.href);
      if (!url.pathname.startsWith(FOLDER)) return new Response('', { status: 404 });
      return new Response(readFileSync(join(FIXTURE, url.pathname.slice(FOLDER.length))));
    }) as typeof fetch;

    const { film, source } = await openFilm(filmFolderUrl('tok', 3), {
      fetch: fetchFixture,
      baseUrl: `${ORIGIN}/r/tok`,
    });
    const listed = (film as TalkieFilm).scenes.map((scene) => scene.src);
    expect(listed.length).toBeGreaterThan(0);
    for (const src of listed) await source.json(src);
    const urls = await Promise.all(['audio/narration.mp3', ...listed].map((p) => source.url(p)));

    expect(requested).toContain(`${ORIGIN}${FOLDER}talkie.json`);
    expect(requested).toHaveLength(1 + listed.length);
    for (const url of [...requested, ...urls]) {
      expect(url.startsWith(`${ORIGIN}${FOLDER}`), url).toBe(true);
    }
  });
});
