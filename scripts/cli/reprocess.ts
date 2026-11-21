import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { processComment } from '@/lib/pipeline/process';
import { prepareReprocess, type ReprocessOptions } from '@/lib/pipeline/reprocess';
import { readStatus } from '@/lib/pipeline/status';
import { isStepName, STEP_ORDER } from '@/lib/pipeline/steps/types';
import { isUuid } from '@/lib/storage/ids';
import { ID_RE } from '@/lib/storage/paths';
import { getVideo } from '@/lib/storage/repo';

export const USAGE = `Usage: yarn reprocess <videoId> [--version n] [--comment id] [--from-step name]

Clears derived outputs and runs the comments through the pipeline again, here and now.
Raw captures are untouched. With no options, only failed comments are retried.

  --version n        only comments made on version n
  --comment id       only this comment
  --from-step name   first step to run again: ${STEP_ORDER.join(', ')}`;

class UsageError extends Error {}

export function parseCli(argv: string[]): { videoId: string; opts: ReprocessOptions } {
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

  const opts: ReprocessOptions = {};
  if (values.version !== undefined) {
    const version = Number(values.version);
    if (!Number.isInteger(version) || version < 1) {
      throw new UsageError('--version must be a whole number, 1 or more.');
    }
    opts.version = version;
  }
  if (values.comment !== undefined) {
    if (!isUuid(values.comment)) throw new UsageError('--comment must be a comment id.');
    opts.commentId = values.comment;
  }
  if (values['from-step'] !== undefined) {
    if (!isStepName(values['from-step'])) {
      throw new UsageError(`--from-step must be one of: ${STEP_ORDER.join(', ')}.`);
    }
    opts.fromStep = values['from-step'];
  }
  return { videoId, opts };
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: 'string' },
      comment: { type: 'string' },
      'from-step': { type: 'string' },
    },
  });
}

/** Runs the reprocess and returns the process exit code. */
export async function main(
  argv: string[],
  out: (line: string) => void = console.log
): Promise<number> {
  let videoId: string;
  let opts: ReprocessOptions;
  try {
    ({ videoId, opts } = parseCli(argv));
  } catch (err) {
    out(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if ((await getVideo(videoId)) === null) {
    out(`No video with the id "${videoId}".`);
    return 1;
  }

  const jobs = await prepareReprocess(videoId, opts);
  if (jobs.length === 0) {
    out('Nothing to reprocess.');
    return 0;
  }
  let failures = 0;
  for (const [i, { ref, fromStep }] of jobs.entries()) {
    out(`[${i + 1}/${jobs.length}] ${ref.commentId}: from ${fromStep}`);
    await processComment(ref, { fromStep, includeClip: true, log: (line) => out(`  ${line}`) });
    const status = await readStatus(ref);
    if (status?.state === 'failed') failures++;
    out(
      `[${i + 1}/${jobs.length}] ${ref.commentId}: ${status?.state ?? 'unknown'}` +
        (status?.error ? ` (${status.error})` : '')
    );
  }
  out(`Reprocessed ${jobs.length} comments, ${failures} failed.`);
  return failures > 0 ? 1 : 0;
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
