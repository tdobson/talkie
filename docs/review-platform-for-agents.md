# The review platform, for agents

How an agent puts a film up for review on https://video-feedback.tdobson.net, gets the review
link, and reads the feedback back to change the film. Everything here works from a shell: no
browser, no admin login.

## What it is

A reviewer opens a review link, says hello to check the microphone, and watches. Wherever they
pause, they talk and point at the picture. The app records the voice and the pointer, transcribes
it (Groq Whisper), draws stills of the moments with the pointer on them, and offers it all as an
export: JSON for a model, Markdown and images for a person.

It takes two kinds of film:

- **MP4**, H.264 video in `yuv420p`.
- **Talkie**, packed as one `.lottie` file (`dist/film.lottie` of a film project). For a Talkie
  film every moment in the export also names the scene, the frame in that scene, the chapter and
  the caption on screen, so feedback maps straight back to `scenes/<id>.ts` and
  `script/<id>.json`.

## On and off, at a glance

- **On:** copy the file into the inbox on geriatrix, then import it with one API call (new video, or
  the next version of one already there). You get a review link. See "Put a film up".
- **Off:** download the feedback as `export.json` (for a model) or `export.zip` (with stills, and
  clips if asked), or watch it arrive comment by comment while the reviewer is still going. See
  "Read the feedback". For a Talkie film the zip also holds its
  `talkie.json` and captions, so scene ids map back to source. The film itself is not in it: you
  have it already.
- **Delete:** there is no delete in the API. Ask Tim.

## Screencasts and screen recordings: MP4, not Talkie

Talkie is for films drawn as vector scenes. It has no video or bitmap scenes, and the SVG
importer refuses bitmaps on purpose. A screencast, a screen recording, or a Playwright video of a
real app is pixels, so it goes on the review platform as an MP4:

- H.264 video in `yuv420p`, AAC audio. The platform refuses any other video codec (H.265, VP8,
  VP9, AV1). Playwright records VP8 WebM, so encode it first.
- Burn captions in if you want them: the review player shows no subtitle track, and the stills
  are frames of the video.
- Encode on asterix, xebit-dev1 or xebit-dev3, never on tragicomix.

```bash
scripts/low ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p -crf 20 -preset slow \
  -c:a aac -b:a 128k -movflags +faststart out.mp4
```

An MP4's feedback has no scene names (that is Talkie only), so keep a sidecar `<film>.steps.json`
with one entry per step: a stable `id`, `start` and `end` in seconds of the final MP4, the
`caption` on screen, and click positions as fractions of the frame (0..1, the same as the export's
pointer). Each comment's `pausedAtVideoTime` then maps to a step. Keep the step ids the same across
re-recordings, and import a new cut as the next version of the same video.

## What you need

- ssh to `geriatrix` (to copy the film into the inbox).
- The admin service token: `~/.config/video-feedback/service-token.env` on tragicomix, which sets
  `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`. It is a secret: source it, never print it,
  never copy it into a repo, a log or a message.

```bash
set -a; . ~/.config/video-feedback/service-token.env; set +a
H=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")
VF=https://video-feedback.tdobson.net
```

## Put a film up

```bash
# 1. Copy it into the inbox. Give it a name that says what and which version.
rsync -P --bwlimit=20000 dist/film.lottie geriatrix:/srv/video-feedback/data/inbox/roof-v1.lottie

# 2. Import it as a new video...
curl -sS "${H[@]}" -H 'Content-Type: application/json' \
  -d '{"filename":"roof-v1.lottie","mode":"new","title":"Roof: how a batten gauge works"}' \
  $VF/api/admin/inbox
# -> {"ok":true,"videoId":"roof-how-a-batten-gauge-works-x1y2","version":1,
#     "reviewUrl":"https://video-feedback.tdobson.net/r/...","next":[...],"docs":"..."}

# ...or as the next version of a video that is already there (same review link):
curl -sS "${H[@]}" -H 'Content-Type: application/json' \
  -d '{"filename":"roof-v2.lottie","mode":"version","videoId":"roof-how-a-batten-gauge-works-x1y2"}' \
  $VF/api/admin/inbox

# 3. The review link is in the answer, as reviewUrl. To list them all again later:
curl -sS "${H[@]}" $VF/api/admin/videos | jq -r '.[] | "\(.videoId)  \(.title)  \(.reviewUrl)"'

# 4. Start a watcher now, in the background, so the feedback comes to you (see below).
node apps/video-feedback/scripts/watch-feedback.mjs roof-how-a-batten-gauge-works-x1y2 \
  --state ~/tmp/roof-watch.json --images ~/tmp/roof-stills >> ~/tmp/roof-feedback.jsonl &
```

**Set up a watcher whenever you put something up.** You made the film, so you are the one who
will want the feedback, and it can arrive any time: minutes later, or the next day, comment by
comment while the reviewer is still watching. A watcher costs nothing while nobody is reviewing,
and needs no model: it is a plain script that writes a line for each finished comment. Check its
output when you come back to the work, or act on each line as it lands. Keep one per video; a new
version of the same video is watched by the same watcher (`--version latest`). See "Watch
feedback while the reviewer is still watching" below.

A refused import answers `{"ok":false,"reason":"..."}` and leaves the file in the inbox. The reason
says what is wrong (not H.264, not a Talkie film, a newer format version, too big).

Size: the platform stores a Talkie film's scene JSON gzipped, so a long film with heavy art is
fine. The limits are 500 MB on disk with the scenes gzipped, and 2000 MB unpacked. A film of about
an hour with soft shadows drawn as stacked copies, which unpacks to 583 MB, takes 72 MB on disk.
Do not make a film smaller to get it in.

`GET $VF/api/admin/inbox` lists what is waiting in the inbox.

**Give the review link to Tim**, not to reviewers. Sending anything to another person needs Tim's
sign-off on the exact words. Whether a new cut goes in as a new video or as the next version of an
old one is also Tim's call when it is not obvious.

## Read the feedback

```bash
curl -sS "${H[@]}" "$VF/api/admin/videos/<videoId>/export.json?version=latest" > feedback.json
curl -sS -OJ "${H[@]}" "$VF/api/admin/videos/<videoId>/export.zip?version=latest"   # with stills
```

- `202` with `Retry-After` means comments are still being processed. Wait and ask again, or add
  `&partial=1`.
- `&since=<ISO time>` gives only newer comments. Send the `ETag` back as `If-None-Match` to get
  `304` when nothing changed.
- `&clips=1` adds a short reconstructed clip of each comment to the zip. `version=all` covers every
  version.

### Watch feedback while the reviewer is still watching

Each comment is transcribed and its stills drawn as soon as the reviewer finishes it (presses play
again), not when they press Done. So you can read and act on feedback mid-session.
`apps/video-feedback/scripts/watch-feedback.mjs` does the polling for you. It is plain Node (20 or
newer, no dependencies, no model), so the same comments on the server always give the same output:

```bash
set -a; . ~/.config/video-feedback/service-token.env; set +a
node apps/video-feedback/scripts/watch-feedback.mjs <videoId> \
  --state ~/tmp/<videoId>-watch.json --images ~/tmp/<videoId>-stills
```

- It asks for `export.json?partial=1` every 20 s (`--every <seconds>`), sending the last `ETag`, so
  a quiet video costs a `304`.
- It prints one JSON line per event on stdout:
  - `{"type":"comment", ...}` once a comment is finished: `done` (transcript and stills ready),
    `empty` (no speech) or `failed`. The fields are those of a comment in `feedback.json`, below.
  - `{"type":"session-done","sessionId":...,"reviewerName":...}` once a reviewer has pressed Done
    and all their comments have been printed. That is the moment to read the whole review.
- `--images <dir>` saves each comment's stills (overview, moments, zooms) to
  `<dir>/<commentId>/` before the line is printed, and the line's `local` field maps each `media/`
  path to its file.
- `--state <file>` remembers what was printed, so a restart carries on where it stopped. A comment
  is printed at least once: one cut off between printing and saving comes again.
- `--new-only` skips what is already there on the first run. `--once` polls once and exits.
- It exits `2` if the token is refused and `3` for an unknown video. Network trouble goes to
  stderr and it keeps polling.

Run it in the background and read its output as it grows, or pipe it into your own loop. Each
`media/<commentId>/<name>` path in the export can also be fetched on its own:

```bash
curl -sS "${H[@]}" -o moment-01.jpg "$VF/api/admin/videos/<videoId>/media/<commentId>/moment-01.jpg"
```

A comment whose transcript or stills are reprocessed later is not printed again. Read
`export.json` for the latest.

What is in `feedback.json` (`ExportModel` in `apps/video-feedback/lib/export/model.ts`):

- `video`: id, title, version, size, duration.
- `sessions`: one per reviewer visit, with `reviewerName`.
- `comments`: one per pause-and-talk. The useful fields:
  - `transcript.text`, and `transcript.words`, each with `start`, `end` and the `pointer` (x, y as
    fractions of the picture) at the moment the word was said.
  - `pausedAtVideoTime` (seconds) and `videoTimeRange` (if they scrubbed while talking).
  - `moments`: the points they pointed at, each with an `image` path in the zip. For a Talkie film
    each moment has `talkie: { sceneId, sceneIndex, sceneTime, sceneFrame, chapter, caption }`.
  - `kind`: `moment` (paused on a frame) or `general` (said at the end screen).
- `previous`: comments on earlier versions, for context.
- `olderAfterImport`: only there when someone commented on an earlier version after this one
  was imported, which means they were watching the old cut. Read those comments (in
  `previous`) as feedback on the version they name. Since 2026-11-23 a reviewer who comes back
  after a new version is imported gets a new session on the latest version and is told so, so
  this should only show for comments made before that change.

To act on Talkie feedback: `sceneId` is the scene file (`scenes/<sceneId>.ts`), `sceneTime` is
seconds into that scene, and `caption` is the narration line on screen, which finds the line in
`script/<sceneId>.json`. Change the scene, rebuild, `talkie check` and `talkie qa`, then import
the new `film.lottie` as the next version.

## Make or change a Talkie film

Start at [AGENTS.md](../AGENTS.md), then [make-a-film.md](make-a-film.md) and
[authoring.md](authoring.md). The rules that bite:

- Build tools run through `scripts/low`. Never render or export a film on tragicomix; MP4 exports
  go on asterix, xebit-dev1 or xebit-dev3.
- Film projects live outside the repo (`~/dev/talkie-films/<film>/` on tragicomix), with
  `node_modules/@talkie/{author,cli}` symlinked to this repo's `packages/`.
- SVG art may use flat colours, linear and radial gradients, and clip paths. Masks, filters,
  patterns, bitmaps, live text and `<style>` sheets are refused
  ([authoring.md](authoring.md#art-rules)). A soft shadow is one radial gradient, not stacked
  copies. No em or en dashes in captions.
- Converters from the older animated-SVG films exist: MD films on asterix
  (`~/md-roofkit-films-bulk/talkie/converter/`, with the real-voice re-timing loop) and the Solfit
  film on xebit-dev1 (`~/dev/solfit-install-film/tools/talkie-port/`). Copy one, do not edit it in
  place.
- To just look at a film, drop its `.lottie` on https://talkie.tdobson.net (nothing is uploaded),
  or run `talkie dev <project>`.

## Do not

- Delete or re-import over someone else's video. Ask.
- Run the app's `yarn import`, `yarn export` or `yarn reprocess` on geriatrix: the live install is
  a standalone build with no `node_modules` for them. Use the API above.
- Deploy unless asked. When asked: `scripts/deploy/video-feedback.sh` (see [DEPLOY.md](DEPLOY.md)),
  then `node scripts/deploy/smoke-talkie.mjs <review-url> <videoId>` against a Talkie test video.
