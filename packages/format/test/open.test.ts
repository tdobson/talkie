import { strToU8 } from 'fflate';
import { TalkieError } from '../src/errors';
import { openFilm } from '../src/open';
import { packFilm } from '../src/pack';
import valid from './fixtures/valid.json';

const scene = { v: '5.7.0', fr: 60, ip: 0, op: 600, layers: [] };
const packed = (film: unknown = valid) =>
  packFilm({
    'talkie.json': strToU8(JSON.stringify(film)),
    'a/s01.json': strToU8(JSON.stringify(scene)),
    'u/n.m4a': new Uint8Array([1, 2, 3, 4]),
  });

/** A fake fetch serving a map of URL to body, and recording what was asked for. */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (!(url in routes)) {
      return new Response('missing', { status: 404 });
    }
    const body = routes[url];
    return body instanceof Uint8Array
      ? new Response(body as Uint8Array<ArrayBuffer>)
      : new Response(JSON.stringify(body));
  }) as typeof fetch;
  return { fetchFn, calls };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(TalkieError);
    return (e as TalkieError).code;
  }
  throw new Error('expected openFilm to reject');
};

describe('openFilm from a folder', () => {
  it('resolves talkie.json under a folder URL with no trailing slash', async () => {
    const { fetchFn, calls } = fakeFetch({
      'https://films.test/roof/talkie.json': valid,
      'https://films.test/roof/a/s01.json': scene,
    });
    const { film, source } = await openFilm('https://films.test/roof', { fetch: fetchFn });
    expect(calls).toEqual(['https://films.test/roof/talkie.json']);
    expect(film.title).toBe(valid.title);
    expect(source.kind).toBe('folder');
    expect(await source.url('u/n.m4a')).toBe('https://films.test/roof/u/n.m4a');
    expect(await source.json('a/s01.json')).toEqual(scene);
    source.dispose();
  });

  it('accepts a URL object and a relative path with a base URL', async () => {
    const { fetchFn } = fakeFetch({ 'https://films.test/roof/talkie.json': valid });
    const viaUrl = await openFilm(new URL('https://films.test/roof/'), { fetch: fetchFn });
    expect(viaUrl.film.duration).toBe(60);
    const viaBase = await openFilm('roof', { fetch: fetchFn, baseUrl: 'https://films.test/' });
    expect(await viaBase.source.url('poster.png')).toBe('https://films.test/roof/poster.png');
  });

  it('reports HTTP 404 as a network error', async () => {
    const { fetchFn } = fakeFetch({});
    expect(await codeOf(openFilm('https://films.test/none', { fetch: fetchFn }))).toBe('network');
  });

  it('reports a failed fetch as a network error', async () => {
    const down = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await codeOf(openFilm('https://films.test/roof', { fetch: down }))).toBe('network');
  });

  it('reports an invalid film', async () => {
    const { fetchFn } = fakeFetch({ 'https://films.test/roof/talkie.json': { talkie: 1 } });
    expect(await codeOf(openFilm('https://films.test/roof', { fetch: fetchFn }))).toBe(
      'invalid-film'
    );
  });

  it('reports a newer format version', async () => {
    const { fetchFn } = fakeFetch({
      'https://films.test/roof/talkie.json': { ...valid, talkie: 2 },
    });
    const promise = openFilm('https://films.test/roof', { fetch: fetchFn });
    await expect(promise).rejects.toMatchObject({
      code: 'unsupported-version',
      message: 'film uses format version 2; this reader supports up to 1',
    });
  });
});

describe('openFilm from a packed film', () => {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const created: Blob[] = [];
  const revoked: string[] = [];
  beforeEach(() => {
    created.length = 0;
    revoked.length = 0;
    URL.createObjectURL = (blob: Blob) => `blob:fake/${created.push(blob)}`;
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
  });
  afterEach(() => {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  });

  it('fetches and unzips a .lottie URL', async () => {
    const { fetchFn, calls } = fakeFetch({ 'https://films.test/roof.lottie': packed() });
    const { film, source } = await openFilm('https://films.test/roof.lottie', { fetch: fetchFn });
    expect(calls).toEqual(['https://films.test/roof.lottie']);
    expect(film.scenes).toHaveLength(3);
    expect(source.kind).toBe('packed');
    expect(await source.json('a/s01.json')).toEqual(scene);
  });

  it('opens Uint8Array, ArrayBuffer and Blob input', async () => {
    const bytes = packed();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    for (const input of [bytes, buffer as ArrayBuffer, new Blob([buffer as ArrayBuffer])]) {
      const { film, source } = await openFilm(input);
      expect(film.duration).toBe(60);
      expect(source.kind).toBe('packed');
    }
  });

  it('serves each file as one typed blob URL and revokes it on dispose', async () => {
    const { source } = await openFilm(packed());
    const first = await source.url('u/n.m4a');
    expect(await source.url('u/n.m4a')).toBe(first);
    expect(created).toHaveLength(1);
    expect(created[0]!.type).toBe('audio/mp4');
    expect(created[0]!.size).toBe(4);
    source.dispose();
    expect(revoked).toEqual([first]);
  });

  it('reports a file missing from the zip', async () => {
    const { source } = await openFilm(packed());
    expect(await codeOf(source.url('u/n.webm'))).toBe('invalid-film');
    expect(await codeOf(source.json('a/s02.json'))).toBe('invalid-film');
  });

  it('reports bytes that are not a zip', async () => {
    expect(await codeOf(openFilm(new Uint8Array([1, 2, 3, 4, 5])))).toBe('invalid-film');
  });

  it('reports a zip with no talkie.json', async () => {
    expect(await codeOf(openFilm(packFilm({ 'a/s01.json': strToU8('{}') })))).toBe('invalid-film');
  });

  it('reports a talkie.json that is not JSON', async () => {
    expect(await codeOf(openFilm(packFilm({ 'talkie.json': strToU8('{nope') })))).toBe(
      'invalid-film'
    );
  });

  it('reports an invalid or newer packed film', async () => {
    expect(await codeOf(openFilm(packed({ ...valid, duration: 61 })))).toBe('invalid-film');
    expect(await codeOf(openFilm(packed({ ...valid, talkie: 2 })))).toBe('unsupported-version');
  });
});
