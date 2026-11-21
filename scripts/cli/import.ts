// yarn import <file> --title "..."      import a file as a new video
// yarn import <file> --video <videoId>  import a file as the next version of a video
//
// Copies the file into the inbox, imports it, and prints the review URL.
import { constants } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
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
  const opts: { title?: string; video?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const match = /^--(title|video)(?:=(.*))?$/s.exec(arg);
    if (match) {
      const value = match[2] ?? argv[++i];
      if (value === undefined) return null;
      opts[match[1] as 'title' | 'video'] = value;
    } else if (arg.startsWith('--')) {
      return null;
    } else {
      files.push(arg);
    }
  }
  if (files.length !== 1) return null;
  // Exactly one of --title and --video.
  if ((opts.title === undefined) === (opts.video === undefined)) return null;
  return { file: files[0], ...opts };
}

function isCode(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === code;
}

/** Runs the import and returns the process exit code. */
export async function runImport(argv: string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv);
  if (args === null) {
    io.err(USAGE);
    return 2;
  }

  const filename = basename(args.file);
  const inboxPath = join(inboxDir(), filename);
  await mkdir(inboxDir(), { recursive: true });
  try {
    // COPYFILE_EXCL: never overwrite a file somebody else dropped into the inbox.
    await copyFile(resolve(args.file), inboxPath, constants.COPYFILE_EXCL);
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
    await rm(inboxPath, { force: true });
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
