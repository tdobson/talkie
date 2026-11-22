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
# -> {"ok":true,"videoId":"roof-how-a-batten-gauge-works-x1y2","version":1}

# ...or as the next version of a video that is already there (same review link):
curl -sS "${H[@]}" -H 'Content-Type: application/json' \
  -d '{"filename":"roof-v2.lottie","mode":"version","videoId":"roof-how-a-batten-gauge-works-x1y2"}' \
  $VF/api/admin/inbox

# 3. Get the review link.
curl -sS "${H[@]}" $VF/api/admin/videos | jq -r '.[] | "\(.videoId)  \(.title)  \(.reviewUrl)"'
```

A refused import answers `{"ok":false,"reason":"..."}` and leaves the file in the inbox. The reason
says what is wrong (not H.264, not a Talkie film, a newer format version, too big).

Size: the platform stores a Talkie film's scene JSON gzipped, so a long film with heavy art is
fine. The limits are 500 MB on disk with the scenes gzipped, and 2000 MB unpacked. A film of about
an hour with soft shadows, which unpacks to 583 MB, takes 72 MB on disk. Do not make a film
smaller to get it in.

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
- No SVG gradients, clip paths or masks yet: flat fills. No em or en dashes in captions.
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
