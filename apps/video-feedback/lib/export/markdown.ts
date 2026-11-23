import { formatVideoTime } from '@/lib/format';
import { percent, positionLabel } from '@/lib/geometry';
import type { ExportComment, ExportModel } from './model';

type ExportMoment = ExportComment['moments'][number];
type ExportTranscript = NonNullable<ExportComment['transcript']>;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** `2026-11-21 14:05 UTC` */
function formatExportTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function marker(m: ExportMoment): string {
  const label = positionLabel(m.x, m.y);
  const parts = [label];
  if (label !== 'off-picture') parts.push(`${percent(m.x)}/${percent(m.y)}`);
  if (m.kinds.includes('click')) parts.push('clicked');
  if (m.kinds.includes('zoom')) parts.push('zoomed in');
  return `[📍 ${m.id}: ${parts.join(', ')}]`;
}

/** Index of the word spoken nearest to `ms` (milliseconds into the recording). */
function nearestWord(words: ExportTranscript['words'], ms: number): number {
  const t = ms / 1000;
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  words.forEach((w, i) => {
    const gap = t < w.start ? w.start - t : t > w.end ? t - w.end : 0;
    if (gap < bestGap) {
      best = i;
      bestGap = gap;
    }
  });
  return best;
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/**
 * Finds where each word ends in the punctuated text, so markers can go into the text as the
 * transcriber wrote it. Null when the words do not line up with the text.
 */
function wordEnds(text: string, words: ExportTranscript['words']): number[] | null {
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return null;
  const ends: number[] = [];
  let cursor = 0;
  for (const w of words) {
    const needle = w.word.trim().toLowerCase();
    if (needle === '') {
      ends.push(cursor);
      continue;
    }
    let at = lower.indexOf(needle, cursor);
    // Skip matches inside a longer word ("it" in "title") when the needle is a plain word.
    while (
      at !== -1 &&
      ((isWordChar(needle[0]) && isWordChar(lower[at - 1])) ||
        (isWordChar(needle[needle.length - 1]) && isWordChar(lower[at + needle.length])))
    ) {
      at = lower.indexOf(needle, at + 1);
    }
    if (at === -1) return null;
    cursor = at + needle.length;
    ends.push(cursor);
  }
  return ends;
}

/** The transcript with a marker after the word nearest each moment. */
function transcriptWithMarkers(transcript: ExportTranscript, moments: ExportMoment[]): string {
  const { words } = transcript;
  const after = new Map<number, string[]>();
  for (const m of moments) {
    // The pause frame is where the comment starts. It is not tied to anything said.
    if (m.kinds.every((k) => k === 'pause')) continue;
    const i = nearestWord(words, m.t);
    if (i === -1) continue;
    after.set(i, [...(after.get(i) ?? []), marker(m)]);
  }
  if (after.size === 0) return transcript.text;

  const ends = wordEnds(transcript.text, words);
  if (ends === null) {
    return words
      .map((w, i) => [w.word.trim(), ...(after.get(i) ?? [])].join(' '))
      .filter((s) => s !== '')
      .join(' ');
  }
  let out = '';
  let from = 0;
  for (const [i, markers] of [...after.entries()].sort(([a], [b]) => a - b)) {
    out += `${transcript.text.slice(from, ends[i])} ${markers.join(' ')}`;
    from = ends[i];
  }
  return out + transcript.text.slice(from);
}

/**
 * Text from a reviewer (their name), made safe to print inside the document's own structure:
 * one line, with the characters Markdown gives meaning to escaped. Whoever reads the export
 * must be able to trust that a heading, image or link in it was written by this tool.
 */
export function mdText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\`*_{}[\]()#+!|<>~]/g, '\\$&');
}

function spokenLines(c: ExportComment): string[] {
  const lines: string[] = [];
  if (c.transcript && c.transcript.text !== '') {
    lines.push(`"${transcriptWithMarkers(c.transcript, c.moments)}"`);
  } else if (c.noAudio) {
    lines.push('_No audio: the microphone was lost, so only the pointing was recorded._');
    return lines;
  } else if (c.state === 'failed') {
    lines.push(`_Transcription failed; listen to ${c.files.audio}_`);
  } else if (c.state === 'queued' || c.state === 'processing') {
    lines.push(`_Not transcribed yet; listen to ${c.files.audio}_`);
  } else {
    lines.push(`_No words were transcribed; listen to ${c.files.audio}_`);
  }
  if (c.micLost) {
    lines.push('', '_The microphone stopped working during this comment, so it may be cut short._');
  }
  return lines;
}

/** `, scene s01 frame 30, caption "Red scene."` for a moment in a Talkie film, else nothing. */
function talkiePart(m: ExportMoment): string {
  if (!m.talkie) return '';
  const { sceneId, sceneFrame, caption } = m.talkie;
  // The scene id and the caption come from the film, so they are escaped like a reviewer's name.
  const said = caption ? `, caption "${mdText(caption)}"` : '';
  return `, scene ${mdText(sceneId)} frame ${sceneFrame}${said}`;
}

function momentLine(m: ExportMoment): string {
  const why = m.reasons.length > 0 ? m.reasons.join(' + ') : m.kinds.join(' + ');
  const where = `(${percent(m.x)}, ${percent(m.y)})`;
  const zoom = m.zoomImage ? ` ![zoomed in](${m.zoomImage})` : '';
  return `- ${m.id} at ${formatVideoTime(m.vt)}, ${why}, ${where}${talkiePart(m)} ![](${m.image})${zoom}`;
}

function momentComment(c: ExportComment, fps: number, h: string): string[] {
  const paused = c.pausedAtVideoTime ?? 0;
  let header = `${h} ${mdText(c.reviewerName)}, ${formatVideoTime(paused)} (paused ${Math.round(c.durationMs / 1000)}s)`;
  if (c.videoTimeRange) {
    const [a, b] = c.videoTimeRange;
    const frame = fps > 0 ? 1 / fps : 0;
    if (b - a > frame) header += ` covering ${formatVideoTime(a)} to ${formatVideoTime(b)}`;
  }
  const lines = [header];
  if (c.files.overview) lines.push(`![overview](${c.files.overview})`);
  lines.push('', ...spokenLines(c));
  if (c.moments.length > 0) {
    lines.push('', 'Moments:', ...c.moments.map(momentLine));
  }
  lines.push('');
  return lines;
}

/** One version's worth of feedback. `nested` is true when it sits under a version heading. */
function section(comments: ExportComment[], fps: number, nested: boolean): string[] {
  const top = nested ? '###' : '##';
  const h = nested ? '####' : '###';
  const said = comments.filter((c) => c.state !== 'empty');
  const moments = said
    .filter((c) => c.kind === 'moment')
    .sort(
      (a, b) =>
        (a.pausedAtVideoTime ?? 0) - (b.pausedAtVideoTime ?? 0) ||
        a.reviewerName.localeCompare(b.reviewerName) ||
        a.startedAt.localeCompare(b.startedAt)
    );
  const general = said.filter((c) => c.kind === 'general');
  const empty = comments.filter((c) => c.state === 'empty');

  const lines: string[] = [];
  if (comments.length === 0) lines.push('No feedback has been recorded here yet.', '');
  for (const c of moments) lines.push(...momentComment(c, fps, '###'));

  if (general.length > 0) {
    lines.push(`${top} General feedback`, '');
    for (const name of unique(general.map((c) => c.reviewerName))) {
      lines.push(`${h} ${mdText(name)}`);
      for (const c of general.filter((g) => g.reviewerName === name)) {
        lines.push('', ...spokenLines(c));
      }
      lines.push('');
    }
  }

  if (empty.length > 0) {
    lines.push(`${top} Empty pauses`, '', 'Pauses where the reviewer said nothing:', '');
    for (const name of unique(empty.map((c) => c.reviewerName))) {
      lines.push(`- ${mdText(name)}: ${empty.filter((c) => c.reviewerName === name).length}`);
    }
    lines.push('');
  }
  return lines;
}

/** `feedback.md`: the readable document of the export. */
export function renderFeedbackMd(model: ExportModel): string {
  const { video, comments } = model;
  const all = video.version === 'all';
  const names = unique(
    model.sessions.length > 0
      ? model.sessions.map((s) => s.reviewerName)
      : comments.map((c) => c.reviewerName)
  );

  const lines = [
    `# ${video.title}, ${all ? 'all versions' : `version ${video.version}`}`,
    '',
    `Reviewers: ${names.length > 0 ? names.map(mdText).join(', ') : 'none'}`,
    `Exported: ${formatExportTime(model.exportedAt)}`,
    '',
  ];

  for (const o of model.olderAfterImport ?? []) {
    const who = o.reviewers.map(mdText).join(', ');
    const n = o.count === 1 ? '1 comment was' : `${o.count} comments were`;
    lines.push(
      `> **Note:** ${n} left on version ${o.version} after version ${video.version} was imported (${who}). They were watching the older cut. Those comments are in \`previous/v${o.version}/\` and under \`previous\` in \`feedback.json\`, not here.`,
      ''
    );
  }

  if (all) {
    const versions = unique(comments.map((c) => String(c.version)))
      .map(Number)
      .sort((a, b) => a - b);
    if (versions.length === 0) lines.push('No feedback has been recorded here yet.', '');
    for (const v of versions) {
      lines.push(`## Version ${v}`, '');
      lines.push(
        ...section(
          comments.filter((c) => c.version === v),
          video.fps,
          true
        )
      );
    }
  } else {
    lines.push(...section(comments, video.fps, false));
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
