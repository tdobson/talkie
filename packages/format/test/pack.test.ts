import { strToU8, unzipSync } from 'fflate';
import { mimeFor } from '../src/mime';
import { dotLottieManifest, packFilm } from '../src/pack';
import type { TalkieFilm } from '../src/types';
import valid from './fixtures/valid.json';

const film = valid as unknown as TalkieFilm;
const media = (seed: number) => Uint8Array.from({ length: 4096 }, (_, i) => (i * seed) % 7);
const files = (): Record<string, Uint8Array> => ({
  'talkie.json': strToU8(JSON.stringify(film)),
  'manifest.json': strToU8(JSON.stringify(dotLottieManifest(film))),
  'a/s01.json': strToU8(JSON.stringify({ v: '5.7.0', layers: [], pad: 'x'.repeat(4096) })),
  'u/n.webm': media(3),
  'u/n.m4a': media(5),
  'poster.png': media(11),
});

/** Compressed and uncompressed sizes for each entry, read from the zip central directory. */
function entrySizes(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const sizes: Record<string, { method: number; compressed: number; size: number; time: number }> =
    {};
  for (let i = 0; i + 46 <= zip.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) {
      continue;
    }
    const nameLength = view.getUint16(i + 28, true);
    const name = new TextDecoder().decode(zip.subarray(i + 46, i + 46 + nameLength));
    sizes[name] = {
      method: view.getUint16(i + 10, true),
      time: view.getUint32(i + 12, true),
      compressed: view.getUint32(i + 20, true),
      size: view.getUint32(i + 24, true),
    };
  }
  return sizes;
}

describe('packFilm', () => {
  it('gives identical bytes for the same files, whatever their order', () => {
    const reversed = Object.fromEntries(Object.entries(files()).reverse());
    expect(Buffer.from(packFilm(reversed)).equals(Buffer.from(packFilm(files())))).toBe(true);
  });

  it('unzips to the same files', () => {
    const out = unzipSync(packFilm(files()));
    const input = files();
    expect(Object.keys(out).sort()).toEqual(Object.keys(input).sort());
    for (const path of Object.keys(input)) {
      expect(Buffer.from(out[path]!).equals(Buffer.from(input[path]!))).toBe(true);
    }
  });

  it('stores media and deflates text', () => {
    const sizes = entrySizes(packFilm(files()));
    for (const path of ['u/n.webm', 'u/n.m4a', 'poster.png']) {
      expect(sizes[path]).toMatchObject({ method: 0, size: 4096, compressed: 4096 });
    }
    expect(sizes['a/s01.json']!.method).toBe(8);
    expect(sizes['a/s01.json']!.compressed).toBeLessThan(sizes['a/s01.json']!.size);
  });

  it('gives every entry the same fixed timestamp', () => {
    const times = Object.values(entrySizes(packFilm(files()))).map((entry) => entry.time);
    expect(new Set(times).size).toBe(1);
  });
});

describe('dotLottieManifest', () => {
  it('lists one animation per scene, in order', () =>
    expect(dotLottieManifest(film)).toEqual({
      version: '2',
      generator: 'talkie',
      animations: [{ id: 's01' }, { id: 's02' }, { id: 's03' }],
    }));
});

describe('mimeFor', () => {
  it.each([
    ['talkie.json', 'application/json'],
    ['captions/en.vtt', 'text/vtt'],
    ['poster.svg', 'image/svg+xml'],
    ['poster.PNG', 'image/png'],
    ['u/n.webm', 'audio/webm'],
    ['u/n.m4a', 'audio/mp4'],
    ['u/n.ogg', 'audio/ogg'],
    ['u/n.opus', 'audio/ogg'],
    ['notes.bin', 'application/octet-stream'],
    ['noextension', 'application/octet-stream'],
  ])('maps %s to %s', (path, type) => expect(mimeFor(path)).toBe(type));
});
