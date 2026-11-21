import { PassThrough, Readable } from 'node:stream';
import { buildExportModel, type ExportModel, ExportNotFoundError, parseExportQuery } from './model';
import { exportEtag, writeZip, zipFilename } from './zip';

// The two admin export routes differ only in the body they send, so the query parsing and
// the 202, 304, 400 and 404 answers live here.

const noStore = { 'Cache-Control': 'no-store' };
// The ETag only helps if the client asks again, so it must revalidate every time.
const revalidate = { 'Cache-Control': 'private, no-cache' };

const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers: noStore });

/** True when an If-None-Match header names this ETag (weak comparison, as GET requires). */
function etagMatches(header: string | null, etag: string): boolean {
  if (header === null) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .map((part) => part.trim().replace(/^W\//, ''))
    .includes(etag);
}

function zipBody(model: ExportModel, opts: Parameters<typeof writeZip>[1]): ReadableStream {
  const pipe = new PassThrough();
  // Runs while the response streams. A failure ends the download with an error.
  writeZip(model, opts, pipe).catch((err: unknown) => {
    pipe.destroy(err instanceof Error ? err : new Error(String(err)));
  });
  return Readable.toWeb(pipe) as ReadableStream;
}

/** Answers `GET export.zip` or `GET export.json` for one video. */
export async function exportResponse(
  req: Request,
  videoId: string,
  format: 'zip' | 'json',
  now: Date = new Date()
): Promise<Response> {
  const opts = parseExportQuery(new URL(req.url).searchParams);
  if (opts === null) return fail(400, 'invalid request');

  let model: Awaited<ReturnType<typeof buildExportModel>>;
  try {
    model = await buildExportModel(videoId, opts, now);
  } catch (err) {
    if (err instanceof ExportNotFoundError) return fail(404, 'not found');
    throw err;
  }
  if ('pending' in model) {
    return Response.json(
      { pending: model.pending },
      { status: 202, headers: { ...noStore, 'Retry-After': '30' } }
    );
  }

  const etag = exportEtag(model, opts);
  if (etagMatches(req.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { ...revalidate, ETag: etag } });
  }
  if (format === 'json') {
    return Response.json(model, { headers: { ...revalidate, ETag: etag } });
  }
  return new Response(zipBody(model, opts), {
    headers: {
      ...revalidate,
      ETag: etag,
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipFilename(model, now)}"`,
    },
  });
}
