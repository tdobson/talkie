import { readFile } from 'node:fs/promises';
import { spokenText } from '../project';

/**
 * Respell the words a voice says badly from their spelling: "PV" as "P V", "mm" as "millimetres".
 * Entries match whole words whatever their case, and the longest entry wins where two overlap.
 * Only the text sent to the voice changes; captions and labels keep the written words.
 */
export const applyLexicon: (text: string, lexicon: Record<string, string>) => string = spokenText;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * A lexicon as a flat map of word to respelling. Takes the flat map itself, or the older file form
 * `{ "comment": "...", "respell": { ... } }`.
 */
export function flattenLexicon(data: unknown): Record<string, string> {
  const entries = isRecord(data) && isRecord(data.respell) ? data.respell : data;
  if (!isRecord(entries)) {
    throw new Error('a lexicon must map words to their respellings');
  }
  const flat: Record<string, string> = {};
  for (const [word, respelling] of Object.entries(entries)) {
    // a note to the reader beside a flat map is not an entry
    if (word === 'comment' && entries === data) {
      continue;
    }
    if (typeof respelling !== 'string') {
      throw new Error(`the respelling of "${word}" in the lexicon must be a string`);
    }
    flat[word] = respelling;
  }
  return flat;
}

/** Read a lexicon JSON file, in either form. */
export async function readLexicon(file: string): Promise<Record<string, string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${file} is not valid JSON`);
    }
    throw error;
  }
  return flattenLexicon(parsed);
}
