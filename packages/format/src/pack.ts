import { zipSync, type Zippable } from 'fflate';
import type { TalkieFilm } from './types';

const STORE = /\.(webm|ogg|opus|m4a|png)$/i;

/**
 * Zip timestamps are local time with no zone, and fflate reads the date's local fields. A date
 * built from local fields gives the same bytes in every time zone.
 */
const ZIP_EPOCH = new Date(1980, 0, 1, 0, 0, 0);

/**
 * dotLottie v2 manifest. The spike (spike/REPORT.md, check 4) loaded a manifest of this shape in
 * dotlottie-web; fields beyond these three are not checked against the published v2 schema.
 */
export function dotLottieManifest(film: TalkieFilm) {
  return {
    version: '2',
    generator: 'talkie',
    animations: film.scenes.map((s) => ({ id: s.id })),
  };
}

/** Zip a film's files (path to bytes) into a .lottie. Media is stored, text is deflated. Deterministic. */
export function packFilm(files: Record<string, Uint8Array>): Uint8Array {
  const z: Zippable = {};
  for (const path of Object.keys(files).sort()) {
    z[path] = [files[path]!, { level: STORE.test(path) ? 0 : 9, mtime: ZIP_EPOCH }];
  }
  return zipSync(z);
}
