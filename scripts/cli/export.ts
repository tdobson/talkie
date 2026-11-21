import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  buildExportModel,
  ExportNotFoundError,
  type ExportOptions,
  parseExportQuery,
} from '@/lib/export/model';
import { writeZip, zipFilename } from '@/lib/export/zip';
import { ID_RE } from '@/lib/storage/paths';

export const USAGE = `Usage: yarn export <videoId> [--version n|all] [--clips] [--since ISO] [--out path]

Writes the feedback on a video as a zip for an LLM to read, and prints the path of the zip.

  --version n|all   the version to export (default: the latest)
  --clips           include the reconstructed clip of each comment
  --since ISO       only comments that ended after this time
  --partial         do not wait for comments that are still being processed
  --out path        a folder to write into, or a .zip file name (default: this folder)`;

class UsageError extends Error {}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: 'string' },
      clips: { type: 'boolean' },
      partial: { type: 'boolean' },
      since: { type: 'string' },
      out: { type: 'string' },
    },
  });
}

export function parseCli(argv: string[]): {
  videoId: string;
  out: string | null;
  opts: ExportOptions;
} {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  const { values, positionals } = parsed;
  const [videoId, ...extra] = positionals;
  if (!videoId || extra.length > 0) throw new UsageError('Give exactly one video id.');
  if (!ID_RE.test(videoId)) throw new UsageError(`"${videoId}" is not a valid video id.`);

  // The same rules as the query string of the admin API.
  const query = new URLSearchParams();
  if (values.version !== undefined) query.set('version', values.version);
  if (values.since !== undefined) query.set('since', values.since);
  if (values.clips) query.set('clips', '1');
  if (values.partial) query.set('partial', '1');
  const opts = parseExportQuery(query);
  if (opts === null) {
    throw new UsageError(
      '--version must be a whole number (1 or more) or "all", and --since an ISO time such as 2026-11-20T09:00:00Z.'
    );
  }
  return { videoId, out: values.out ?? null, opts };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Runs the export and returns the process exit code. */
export async function main(
  argv: string[],
  out: (line: string) => void = console.log,
  now: Date = new Date()
): Promise<number> {
  let cli: ReturnType<typeof parseCli>;
  try {
    cli = parseCli(argv);
  } catch (err) {
    out(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }

  let model: Awaited<ReturnType<typeof buildExportModel>>;
  try {
    model = await buildExportModel(cli.videoId, cli.opts, now);
  } catch (err) {
    if (!(err instanceof ExportNotFoundError)) throw err;
    out(err.message);
    return 1;
  }
  if ('pending' in model) {
    const n = model.pending;
    out(
      `${n} ${n === 1 ? 'comment is' : 'comments are'} still being processed. ` +
        'Try again shortly, or pass --partial to export what is ready.'
    );
    return 1;
  }

  const target = resolve(cli.out ?? '.');
  const asFile = target.toLowerCase().endsWith('.zip') && !(await isDirectory(target));
  const path = asFile ? target : join(target, zipFilename(model, now));
  await mkdir(dirname(path), { recursive: true });
  // Written under a temporary name, so a half-written zip never sits at the final path.
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await writeZip(model, cli.opts, createWriteStream(tmp));
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  out(path);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exitCode = 1;
    }
  );
}
