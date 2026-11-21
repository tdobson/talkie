import { mdText } from './markdown';
import type { ExportModel } from './model';

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `README.md`: explains the bundle to a model that has never seen this tool. */
export function renderReadme(model: ExportModel): string {
  const { video, comments, previous } = model;
  const all = video.version === 'all';
  const reviewers = new Set(
    model.sessions.length > 0
      ? model.sessions.map((s) => s.reviewerName)
      : comments.map((c) => c.reviewerName)
  );
  const spoken = comments.filter((c) => c.state !== 'empty');
  const moments = spoken.filter((c) => c.kind === 'moment').length;
  const general = spoken.filter((c) => c.kind === 'general').length;
  const empty = comments.length - spoken.length;
  const failed = comments.filter((c) => c.state === 'failed' && c.transcript === null);
  const unfinished = comments.filter((c) => c.state === 'queued' || c.state === 'processing');
  const when = `${model.exportedAt.slice(0, 10)} ${model.exportedAt.slice(11, 16)} UTC`;

  const lines = [
    `# Feedback on "${video.title}"`,
    '',
    'This folder holds spoken feedback that people recorded while watching a video. Each reviewer watched the video, paused where they had something to say, talked, and pointed at the picture with their mouse or finger. Their speech has been transcribed and lined up with where they were pointing.',
    '',
    '## What is in this export',
    '',
    `- Video: "${video.title}" (id \`${video.videoId}\`), ${all ? 'all versions' : `version ${video.version}`}.`,
    `- Picture: ${video.width} x ${video.height} pixels, ${video.fps} frames per second, ${video.duration} seconds long.`,
    `- ${count(reviewers.size, 'reviewer')}: ${[...reviewers].map(mdText).join(', ') || 'none'}.`,
    `- ${count(moments, 'comment')} made at a paused moment, ${count(general, 'general comment')}, and ${count(empty, 'pause')} where nothing was said.`,
    `- Exported at ${when}.`,
    '',
    '## Files',
    '',
    '- `feedback.md`: the main document. Read this first.',
    '- `feedback.json`: the same feedback as structured data, with every transcript word and every moment.',
    '- `media/<commentId>/`: `overview.jpg`, one `moment-NN.jpg` per moment, the audio recording, and `clip.mp4` when clips were asked for.',
    '- `raw/<commentId>/`: the untouched inputs (`events.json`, `transcript.json`, `moments.json`, `meta.json`).',
    '- `previous/v<n>/`: feedback on earlier versions. See the end of this file.',
    '',
    '## How to read a comment',
    '',
    '- A moment comment starts at the instant the reviewer paused the video. The time in its heading is that paused position.',
    '- Video times are in seconds from the start of the video. In `feedback.md` they are written as m:ss.s, so 1:02.5 is 62.5 seconds in.',
    '- "paused 34s" means the reviewer spoke for about 34 seconds. It says nothing about the video itself.',
    '- If the reviewer scrubbed to other frames while talking, the heading adds "covering a to b" with the earliest and latest video time shown.',
    '- In `feedback.json`, `t` is milliseconds since the comment recording began, and `vt` is the video time in seconds that was on screen at that instant.',
    '- General feedback is about the whole video and has no paused position.',
    '- Transcripts come from speech recognition. Expect the odd wrong word, especially names.',
    '',
    '## Coordinates',
    '',
    'Positions are fractions of the picture, from 0 to 1. The origin is the top-left corner: x runs left to right and y runs top to bottom, so (0.5, 0.5) is the centre. In `feedback.md` they are shown as percentages, x first. A value below 0 or above 1 means the pointer was off the picture.',
    '',
    'Position labels come from a 3 by 3 grid: top-left, top-centre, top-right, middle-left, centre, middle-right, bottom-left, bottom-centre, bottom-right, or off-picture.',
    '',
    '## Moments',
    '',
    'A moment is an instant during a comment that looked worth a picture. Each has a still image and a list of reasons:',
    '',
    '- `pause`: the frame the reviewer paused on. Every moment comment has one.',
    '- `click`: the reviewer clicked or tapped the picture at that spot.',
    '- `zoom`: the reviewer was zoomed in on that part of the picture.',
    '- `dwell`: the pointer rested on one spot for a while.',
    '- `word`: the reviewer said a pointing word such as "this", "that" or "here".',
    '- `seek`: the reviewer moved to a different frame of the video.',
    '',
    'In `feedback.md` a marker like `[📍 moment-02: top-left, 12%/8%]` sits right after the word that was being spoken at that moment. It tells you where the pointer was. "clicked" and "zoomed in" are added when they apply.',
    '',
    'In `feedback.json` every transcript word carries a `pointer` with the position at the time the word was spoken, or null when no position was recorded.',
    '',
    ...(model.films && model.films.length > 0
      ? [
          '## Talkie film',
          '',
          `This video is a Talkie film: animated vector scenes played in step with a narration track, not a rendered video file, so in \`feedback.json\` each moment carries a \`talkie\` object that names the scene on screen (\`sceneId\`, \`sceneIndex\`, \`sceneSrc\`), the seconds into that scene and its Lottie frame (\`sceneTime\`, \`sceneFrame\`), and the \`chapter\` and \`caption\` showing at that instant, each null when there was none. Use ${model.films.map((f) => `\`${f.talkie}\``).join(' and ')} and the captions beside it to map a scene id back to its source file; \`feedback.md\` gives the same scene, frame and caption on every moment line.`,
          '',
        ]
      : []),
    '## Images',
    '',
    "- The stills are video frames with the pointer drawn on by this tool. They are not a real screenshot of the reviewer's screen, so nothing else that was on their screen appears.",
    '- `overview.jpg` shows the paused frame with the path the pointer took during the whole comment.',
    '- A `moment-NN-zoom.jpg` image shows exactly what the reviewer was looking at when zoomed in.',
    '',
    '## Comments without a transcript',
    '',
  ];

  if (failed.length === 0 && unfinished.length === 0) {
    lines.push('Every comment in this export was transcribed.');
  } else {
    if (failed.length > 0) {
      lines.push(
        'Transcription failed for these comments. Their audio is still included, so the feedback is not lost:',
        '',
        ...failed.map((c) => `- \`${c.commentId}\` by ${mdText(c.reviewerName)}: ${c.files.audio}`)
      );
    }
    if (unfinished.length > 0) {
      if (failed.length > 0) lines.push('');
      lines.push(
        'These comments were still being processed when the export was made, so they may lack a transcript or images:',
        '',
        ...unfinished.map(
          (c) => `- \`${c.commentId}\` by ${mdText(c.reviewerName)}: ${c.files.audio}`
        )
      );
    }
  }

  lines.push('', '## Earlier versions', '');
  if (previous.length > 0) {
    const list = previous.map((p) => `v${p.version}`).join(', ');
    lines.push(
      `The \`previous/\` folder holds the feedback given on earlier versions of this video (${list}), each with its own \`feedback.md\` and \`media/\` folder. Use it to check whether earlier feedback was addressed in this version. Image and audio paths for those comments are relative to their own \`previous/v<n>/\` folder. They also appear under \`previous\` in \`feedback.json\`.`
    );
  } else if (all) {
    lines.push(
      'This export covers every version, so there is no `previous/` folder. `feedback.md` has one section per version, which lets you check whether earlier feedback was addressed later.'
    );
  } else {
    lines.push(
      'A `previous/` folder holds feedback on earlier versions, for checking whether it was addressed. There is none in this export because no earlier version has feedback.'
    );
  }
  return `${lines.join('\n')}\n`;
}
