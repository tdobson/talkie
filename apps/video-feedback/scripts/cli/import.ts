// yarn import <file> --title "..."      import a file as a new video
// yarn import <file> --video <videoId>  import a file as the next version of a video
// yarn import --film <folder or .lottie> --title "..." | --video <videoId>
//                                       the same, for a Talkie film
//
// <file> is an MP4 or a packed Talkie film (.lottie). --film also takes a film folder, the one
// that holds talkie.json. Copies it into the inbox, imports it, and prints the review URL.
import { constants } from 'node:fs';
import { copyFile, cp, lstat, mkdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '@/lib/config';
import { inboxDir } from '@/lib/storage/paths';
import { getVideo } from '@/lib/storage/repo';
import type { ImportRequest } from '@/lib/types';
import { importFromInbox } from '@/lib/videos/import';

const USAGE = [
  'Usage: yarn import <file> --title "Title of the new video"',
  '       yarn import <file> --video <videoId>',
  '       yarn import --film <folder or .lottie> --title "Title of the new video"',
  '       yarn import --film <folder or .lottie> --video <videoId>',
].join('\n');

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

interface Args {
  file: string;
  title?: string;
  video?: string;
}

function parseArgs(argv: string[]): Args | null {
  const files: string[] = [];
  const opts: { title?: string; video?: string; film?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const match = /^--(title|video|film)(?:=(.*))?$/s.exec(arg);
    if (match) {
      const value = match[2] ?? argv[++i];
      if (value === undefined) return null;
      opts[match[1] as 'title' | 'video' | 'film'] = value;
    } else if (arg.startsWith('--')) {
      return null;
    } else {
      files.push(arg);
    }
  }
  // Exactly one thing to import: a file, or a film given with --film.
  const { film, ...rest } = opts;
  if (film !== undefined) files.push(film);
  if (files.length !== 1 || files[0] === '') return null;
  // Exactly one of --title and --video.
  if ((rest.title === undefined) === (rest.video === undefined)) return null;
  return { file: files[0], ...rest };
}

function isCode(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === code;
}

/**
 * Copies a file or a film folder into the inbox under `inboxPath`, never over something that is
 * already there. Links inside a folder are copied as links, and the import refuses them.
 */
async function copyIntoInbox(source: string, inboxPath: string): Promise<void> {
  if (!(await stat(source)).isDirectory()) {
    // COPYFILE_EXCL: never overwrite a file somebody else dropped into the inbox.
    await copyFile(source, inboxPath, constants.COPYFILE_EXCL);
    return;
  }
  try {
    await lstat(inboxPath);
    throw Object.assign(new Error('already in the inbox'), { code: 'EEXIST' });
  } catch (err) {
    if (!isCode(err, 'ENOENT')) throw err;
  }
  try {
    await cp(source, inboxPath, { recursive: true, errorOnExist: true, force: false });
  } catch (err) {
    // A folder copy can stop part way. The name was free a moment ago, so what is there is ours.
    await rm(inboxPath, { recursive: true, force: true });
    throw err;
  }
}

/** Runs the import and returns the process exit code. */
export async function runImport(argv: string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv);
  if (args === null) {
    io.err(USAGE);
    return 2;
  }

  // resolve() drops a trailing slash, so "films/launch/" is imported as "launch".
  const source = resolve(args.file);
  const filename = basename(source);
  const inboxPath = join(inboxDir(), filename);
  await mkdir(inboxDir(), { recursive: true });
  try {
    await copyIntoInbox(source, inboxPath);
  } catch (err) {
    if (isCode(err, 'ENOENT')) io.err(`File not found: ${args.file}`);
    else if (isCode(err, 'EEXIST'))
      io.err(`A file named ${filename} is already in the inbox. Import or remove that one first.`);
    else io.err(`Could not copy the file into the inbox: ${(err as Error).message}`);
    return 1;
  }

  const request: ImportRequest =
    args.video !== undefined
      ? { filename, mode: 'version', videoId: args.video }
      : { filename, mode: 'new', title: args.title ?? '' };
  const result = await importFromInbox(request);
  if (!result.ok) {
    // The copy was ours, so a refused import should not leave it lying in the inbox.
    await rm(inboxPath, { recursive: true, force: true });
    io.err(`Import failed: ${result.reason}`);
    return 1;
  }

  const video = await getVideo(result.videoId);
  io.out(`Imported ${filename} as ${result.videoId}, version ${result.version}.`);
  if (video) io.out(`Review URL: ${config().publicBaseUrl}/r/${video.token}`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runImport(process.argv.slice(2), {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exitCode = 1;
    }
  );
}
