import { execFile } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fx } from '@/lib/media/testutil';
import { readStatus, updateStatus } from '@/lib/pipeline/status';
import { seedComment, seedVideo } from '@/lib/pipeline/testutil';
import { inboxDir } from '@/lib/storage/paths';
import { getVideo } from '@/lib/storage/repo';
import { withTmpData } from '@/test/helpers/tmpData';
import { handleRequest, type McpServer } from '../server';
import type { ToolContext, ToolResult } from '../types';
import {
  getUpload,
  handleFinish,
  handlePart,
  setUploadDiskProbeForTests,
  type UploadRecord,
  uploadLimits,
  uploadsDir,
} from '../uploads';
import { publishTools, serverFilename, shellQuote, uploadCommand } from './publish';

const run = promisify(execFile);
const server: McpServer = { tools: publishTools, prompts: [], instructions: '' };
const saved = { ...uploadLimits };
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  setUploadDiskProbeForTests(async () => Number.MAX_SAFE_INTEGER);
});
afterEach(async () => {
  Object.assign(uploadLimits, saved);
  setUploadDiskProbeForTests(null);
  await cleanup();
});

const ctx = (identity: ToolContext['identity'] = null): ToolContext => ({
  identity,
  baseUrl: 'https://fb.example.com',
  signal: new AbortController().signal,
  progress: () => {},
});

/** Calls a tool the way a client does, schema check included. */
async function call(
  name: string,
  args: Record<string, unknown>,
  context = ctx()
): Promise<ToolResult> {
  const res = await handleRequest(
    server,
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    context
  );
  if (!('result' in res)) throw new Error(JSON.stringify(res));
  return res.result as ToolResult;
}

const textOf = (r: ToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
const jsonOf = (r: ToolResult) => JSON.parse(textOf(r));

async function expectRefused(name: string, args: Record<string, unknown>, message: RegExp) {
  const r = await call(name, args);
  expect(r.isError).toBe(true);
  expect(textOf(r)).toMatch(message);
}

describe('the command', () => {
  const awkward = [
    "/home/tim/it's here.mp4",
    '/home/tim/$(rm -rf ~)/`x` "y" \\z.mp4',
    "/mnt/c/Users/Ed/''/a'b'c.mov",
    '/tmp/plain.mp4',
  ];

  it.each(awkward)('quotes %s so sh reads it back exactly', async (path) => {
    const { stdout } = await run('sh', ['-c', `printf %s ${shellQuote(path)}`]);
    expect(stdout).toBe(path);
  });

  it.each(awkward)('is valid sh and bash with %s in it', async (path) => {
    const command = uploadCommand(path, 'https://fb.example.com/api/upload/abc.def');
    expect(command).toContain(shellQuote(path));
    for (const shell of ['sh', 'bash']) await run(shell, ['-n', '-c', command]);
  });

  it('sends 64 MiB parts by default and holds no credential but the link', () => {
    const command = uploadCommand('/f.mp4', 'https://fb.example.com/api/upload/abc.def');
    expect(command).toContain('bs=1048576 skip=$((i*64)) count=64');
    expect(command).not.toMatch(/CF-Access|Authorization/i);
    expect(command).toContain('"$u/finish?bytes=$(($(wc -c < "$f")))"');
  });

  it('asks what each part holds before sending it, and shows the reason a part is refused', () => {
    const command = uploadCommand('/f.mp4', 'https://fb.example.com/api/upload/abc.def');
    expect(command).toContain('[ "$(curl -sS -m 60 "$u/part/$i" 2>/dev/null)" = "$n" ]');
    expect(command).toContain('ff=--fail-with-body; curl $ff --version');
    expect(command).toContain('r=$(curl -sS $ff --retry 3 -T "$t" "$u/part/$i" 2>&1)');
    expect(command).toContain('echo "$r" >&2');
    // A refused part stops it before the finish, which would only say a part is missing.
    expect(command).toContain('[ "$ok" = 1 ] || exit 1; curl -sS -X POST');
  });
});

describe('upload_film', () => {
  it('makes an upload and hands back the command, the uploadId and the expiry', async () => {
    const path = "/home/tim/films/roof's cut.mp4";
    const r = await call(
      'upload_film',
      { path, mode: 'new', title: '  Roof  ' },
      ctx({ email: 'tim@example.com', serviceToken: false, sub: 'x' })
    );
    expect(r.isError).toBeUndefined();
    const text = textOf(r);
    const block = /```sh\n(.+)\n```/.exec(text);
    expect(block).not.toBeNull();
    expect(block?.[1]).toContain(`f=${shellQuote(path)}`);
    expect(block?.[1]).toMatch(
      /u='https:\/\/fb\.example\.com\/api\/upload\/[a-z0-9]{16}\.[\w-]{43}'/
    );
    const uploadId = /uploadId: ([a-z0-9]{16})/.exec(text)?.[1] ?? '';
    expect(text).toMatch(/Expires: \d{4}-\d\d-\d\dT\S+ unless a part arrives first/);
    expect(text).toContain('another 2 hours from then, up to 24 hours from when it was made');
    expect(text).toMatch(/over about 200 MB, run the command in the background/);
    expect(text).toMatch(/run_in_background/);
    expect(text).toMatch(/10 minutes/);
    expect(text).toMatch(/run the same command again: it skips the parts already sent/);
    expect(text).toContain(
      'Limits: at most 4 GiB; .mp4, .m4v or .mov (H.264, yuv420p) or .lottie.'
    );
    expect(await getUpload(uploadId)).toMatchObject({
      filename: 'roof-s cut.mp4',
      mode: 'new',
      title: 'Roof',
      createdBy: 'tim@example.com',
      state: 'waiting',
    });
    await run('sh', ['-n', '-c', block?.[1] ?? '']);
  });

  it('records a service token as the maker, and takes a filename for the server', async () => {
    const video = await seedVideo();
    const r = await call(
      'upload_film',
      { path: '/x/a.lottie', mode: 'version', videoId: video.videoId, filename: 'roof v2.lottie' },
      ctx({ email: null, serviceToken: true, sub: 'client' })
    );
    const uploadId = /uploadId: ([a-z0-9]{16})/.exec(textOf(r))?.[1] ?? '';
    expect(await getUpload(uploadId)).toMatchObject({
      filename: 'roof v2.lottie',
      mode: 'version',
      videoId: video.videoId,
      createdBy: 'service token',
    });
  });

  it('checks mode, title, videoId, path and the kind of file', async () => {
    const video = await seedVideo();
    await expectRefused('upload_film', { path: '/a.mp4', mode: 'later' }, /"mode" must be one of/);
    await expectRefused('upload_film', { path: '/a.mp4', mode: 'new' }, /needs a title/);
    await expectRefused(
      'upload_film',
      { path: '/a.mp4', mode: 'new', title: ' ' },
      /needs a title/
    );
    await expectRefused(
      'upload_film',
      { path: '/a.mp4', mode: 'new', title: 'x'.repeat(201) },
      /at most 200/
    );
    await expectRefused(
      'upload_film',
      { path: '/a.mp4', mode: 'new', title: 'x', videoId: video.videoId },
      /only for mode "version"/
    );
    await expectRefused('upload_film', { path: '/a.mp4', mode: 'version' }, /needs the videoId/);
    await expectRefused(
      'upload_film',
      { path: '/a.mp4', mode: 'version', videoId: 'no-such-video' },
      /There is no video "no-such-video"/
    );
    await expectRefused(
      'upload_film',
      { path: '/a.mp4', mode: 'version', videoId: video.videoId, title: 'x' },
      /only for mode "new"/
    );
    await expectRefused(
      'upload_film',
      { path: 'films/a.mp4', mode: 'new', title: 'x' },
      /absolute/
    );
    await expectRefused(
      'upload_film',
      { path: '/a\nb.mp4', mode: 'new', title: 'x' },
      /line break/
    );
    await expectRefused(
      'upload_film',
      { path: '/films/a.webm', mode: 'new', title: 'x' },
      /H\.264 MP4 .*\.lottie/
    );
    await expectRefused(
      'upload_film',
      { path: '/films/a.mp4', mode: 'new', title: 'x', filename: 'a.avi' },
      /not a film/
    );
    await expectRefused(
      'upload_film',
      { path: '/a.mp4', mode: 'new', title: 'x', extra: 1 },
      /Unknown argument "extra"/
    );
  });

  it('gives the server a plain, visible name', () => {
    expect(serverFilename('../.hidden.mp4')).toBe('hidden.mp4');
    expect(serverFilename('roof (v2) final+.mp4')).toBe('roof (v2) final+.mp4');
    expect(serverFilename('a/b\\c:d.mp4')).toBe('a-b-c-d.mp4');
  });
});

describe('get_upload', () => {
  async function newUpload(): Promise<{ uploadId: string; token: string }> {
    const r = await call('upload_film', { path: '/f/film.mp4', mode: 'new', title: 'Roof' });
    const token = /api\/upload\/([a-z0-9]{16}\.[\w-]{43})/.exec(textOf(r))?.[1] ?? '';
    return { uploadId: token.split('.')[0], token };
  }
  const state = async (uploadId: string) => jsonOf(await call('get_upload', { uploadId }));

  it('follows an upload from waiting to done', async () => {
    const { uploadId, token } = await newUpload();
    expect(await state(uploadId)).toMatchObject({ state: 'waiting', receivedBytes: 0 });

    const { readFile } = await import('node:fs/promises');
    const film = await readFile(fx('h264.mp4'));
    await handlePart(token, '0', new Request('http://x/', { method: 'PUT', body: film }));
    expect(await state(uploadId)).toMatchObject({
      state: 'receiving',
      receivedBytes: film.length,
    });

    expect((await handleFinish(token, String(film.length))).status).toBe(200);
    const done = await state(uploadId);
    expect(done).toMatchObject({
      state: 'done',
      result: { version: 1, reviewUrl: expect.stringMatching(/\/r\/[\w-]{43}$/) },
    });
    expect(done.next).toContain(
      `Call wait_for_feedback with videoId "${done.result.videoId}" and no cursor: it answers at once with a cursor; call it again with that cursor to wait for comments.`
    );
    expect(done.next).toMatch(/^Give the review link to Tim, not to reviewers\./);
  });

  it('reports a refused import with what to do, and an expired link', async () => {
    const { uploadId, token } = await newUpload();
    const { readFile } = await import('node:fs/promises');
    const film = await readFile(fx('mpeg4.mp4'));
    await handlePart(token, '0', new Request('http://x/', { method: 'PUT', body: film }));
    await handleFinish(token, String(film.length));
    const failed = await state(uploadId);
    expect(failed).toMatchObject({ state: 'failed', inboxFile: 'film.mp4' });
    expect(failed.error).toMatch(/H\.264/);
    expect(failed.next).toMatch(/import_from_inbox/);

    uploadLimits.ttlMs = -1;
    const late = await newUpload();
    expect(await state(late.uploadId)).toMatchObject({
      state: 'expired',
      next: expect.stringMatching(/upload_film again/),
    });
  });

  it('names the inbox file to import when a restart cut the import off', async () => {
    const { uploadId } = await newUpload();
    const record = (await getUpload(uploadId)) as UploadRecord;
    const stuck: UploadRecord = {
      ...record,
      state: 'importing',
      importStartedAt: new Date(Date.now() - 16 * 60_000).toISOString(),
      inboxFile: 'film-2.mp4',
    };
    await writeFile(join(uploadsDir(), uploadId, 'upload.json'), JSON.stringify(stuck));
    const view = await state(uploadId);
    expect(view).toMatchObject({ state: 'failed', inboxFile: 'film-2.mp4' });
    for (const said of [view.error, view.next]) {
      expect(said).toContain(
        'call import_from_inbox with filename "film-2.mp4", mode "new" and title "Roof"'
      );
    }
  });

  it('says when there is no such upload', async () => {
    await expectRefused('get_upload', { uploadId: 'aaaaaaaaaaaaaaaa' }, /no upload/);
    await expectRefused('get_upload', { uploadId: '../x' }, /no upload/);
  });
});

describe('list_inbox and import_from_inbox', () => {
  it('lists the inbox and imports from it, with the review link and what to do next', async () => {
    expect(textOf(await call('list_inbox', {}))).toBe('The inbox is empty.');
    await mkdir(inboxDir(), { recursive: true });
    await copyFile(fx('h264.mp4'), join(inboxDir(), 'film.mp4'));
    expect(jsonOf(await call('list_inbox', {}))).toMatchObject([{ filename: 'film.mp4' }]);

    const r = await call('import_from_inbox', { filename: 'film.mp4', mode: 'new', title: 'Roof' });
    expect(r.isError).toBeUndefined();
    const out = jsonOf(r);
    expect(out).toMatchObject({
      version: 1,
      reviewUrl: expect.stringMatching(/^https:\/\/fb\.example\.com\/r\/[\w-]{43}$/),
    });
    expect(out.next).toBe(
      `Give the review link to Tim, not to reviewers. Call wait_for_feedback with videoId "${out.videoId}" and no cursor: it answers at once with a cursor; call it again with that cursor to wait for comments.`
    );

    await copyFile(fx('h264.mp4'), join(inboxDir(), 'v2.mp4'));
    const v2 = await call('import_from_inbox', {
      filename: 'v2.mp4',
      mode: 'version',
      videoId: out.videoId,
    });
    expect(jsonOf(v2)).toMatchObject({ videoId: out.videoId, version: 2 });
  });

  it('passes on the reason when the import is refused', async () => {
    await mkdir(inboxDir(), { recursive: true });
    await copyFile(fx('mpeg4.mp4'), join(inboxDir(), 'bad.mp4'));
    await expectRefused(
      'import_from_inbox',
      { filename: 'bad.mp4', mode: 'new', title: 'x' },
      /refused: .*H\.264.*stays in the inbox/
    );
    await expectRefused(
      'import_from_inbox',
      { filename: 'none.mp4', mode: 'new', title: 'x' },
      /not in the inbox/
    );
    await expectRefused('import_from_inbox', { filename: 'bad.mp4', mode: 'new' }, /needs a title/);
  });
});

describe('rename_video', () => {
  it('changes the title and keeps the id and link', async () => {
    const video = await seedVideo('Old name');
    const r = await call('rename_video', { videoId: video.videoId, title: ' New name ' });
    expect(jsonOf(r)).toEqual({
      videoId: video.videoId,
      title: 'New name',
      previousTitle: 'Old name',
    });
    expect(await getVideo(video.videoId)).toMatchObject({ title: 'New name', token: video.token });
  });

  it('refuses an unknown video and an empty title', async () => {
    const video = await seedVideo();
    await expectRefused('rename_video', { videoId: 'nope-nope', title: 'x' }, /no video/);
    await expectRefused('rename_video', { videoId: video.videoId, title: '  ' }, /empty/);
  });
});

describe('reprocess_comments', () => {
  it('retries what failed, and says when there was nothing to do', async () => {
    const { ref, video } = await seedComment();
    await updateStatus(ref, {
      state: 'failed',
      error: 'Groq transcription failed (503)',
      steps: { audio: 'done', silence: 'done', transcribe: 'failed' },
    });
    const r = jsonOf(await call('reprocess_comments', { videoId: video.videoId }));
    expect(r).toMatchObject({ queued: 1, commentIds: [ref.commentId] });
    expect(r.next).toMatch(/wait_for_feedback/);
    expect(await readStatus(ref)).toMatchObject({ state: 'queued' });

    await updateStatus(ref, { state: 'done' });
    const none = jsonOf(await call('reprocess_comments', { videoId: video.videoId }));
    expect(none).toMatchObject({ queued: 0, note: expect.stringMatching(/nothing to retry/) });

    const one = jsonOf(
      await call('reprocess_comments', {
        videoId: video.videoId,
        commentId: ref.commentId,
        fromStep: 'stills',
      })
    );
    expect(one).toMatchObject({ queued: 1 });
  });

  it('checks the version and the step', async () => {
    const video = await seedVideo();
    await expectRefused(
      'reprocess_comments',
      { videoId: video.videoId, version: 3 },
      /has no version 3. Its versions are 1/
    );
    await expectRefused(
      'reprocess_comments',
      { videoId: video.videoId, fromStep: 'everything' },
      /"fromStep" must be one of/
    );
    await expectRefused('reprocess_comments', { videoId: 'nope-nope' }, /no video/);
  });
});

it('every tool says what it takes, and refuses anything else', () => {
  expect(publishTools.map((t) => t.name)).toEqual([
    'upload_film',
    'get_upload',
    'list_inbox',
    'import_from_inbox',
    'rename_video',
    'reprocess_comments',
  ]);
  for (const tool of publishTools) {
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.description).not.toMatch(/[\u2013\u2014]/);
  }
});
