# Video feedback tool: design

Date: 2026-11-21
Status: approved in brainstorming, awaiting spec review

## 1. Purpose

Reviewers (mostly external clients) watch an H.264 MP4 we made. Whenever they pause, they talk and point with the mouse, as if we were sat next to them. We capture their voice, where they pointed, and exactly which frame they were looking at, without ever showing them a timecode. The feedback comes back as a zip bundle designed to be handed to an LLM, which decides what to do with it.

Success means:
- A reviewer who has never seen the tool can give useful feedback with no instructions beyond the welcome screen.
- Every comment in the export can be tied to an exact video time, the reviewer's words (word-timed), and where the pointer was when they said "this".
- An LLM given the unzipped bundle can understand each piece of feedback without any other context.

## 2. Scope

In scope (v1):
- One secret review link per video. Several reviewers can share it; each gives their name.
- Versions of a video under the same link (v1, v2, ...). Reviewers always get the latest version; the export for v2+ includes the earlier versions' feedback.
- Desktop browsers: Chrome, Edge, Firefox, Safari.
- Moment comments (pause to talk) and general comments (end of video).
- Server-side transcription, key-frame stills, overview images, optional reconstructed clips.
- Admin UI and admin API to import videos and download export zips.

Out of scope (v1):
- H.265 (dropped: we only share H.264).
- Phones and tablets (shown a "please use a computer" page).
- Per-reviewer accounts, access control beyond the secret link, multiple workspaces.
- Linking v2 comments to v1 comments, side-by-side comparison, "resolved" status.
- Real screen capture (`getDisplayMedia`).
- Showing comments back to reviewers.

## 3. Architecture

- One Next.js app (App Router, Mantine 9), scaffolded from `~/dev/next-app-template` (Next 16, React 19, yarn 4). The template's oxlint/oxfmt/stylelint/Jest/Storybook setup is replaced by the toolchain below.
- Runs on geriatrix (2 cores, 9GB RAM) as a Node process under systemd, built with `output: "standalone"`, listening on `127.0.0.1` only.
- Exposed through a Cloudflare Tunnel hostname (e.g. `video-feedback.tdobson.net`).
- ffmpeg and ffprobe installed on the host. Image drawing with `sharp`.

### Toolchain
| Job | Tool |
|---|---|
| Lint (TS, TSX, CSS, JSON) | Biome 2 (formatter disabled) |
| Format | Prettier 3 |
| Type check | TypeScript 7 (`tsc`, the native Go compiler previously previewed as `tsgo`) |
| Unit and integration tests | Vitest (jsdom for components, node for server code) |
| End-to-end tests | Playwright (Chromium with fake mic; Firefox and WebKit smoke project) |
| Zip writing | `yazl` (streaming) |
| JWT | `jose` |

**Low CPU and IO priority everywhere.** Every build, test, lint and typecheck script runs through `scripts/lowprio.sh` (`exec ionice -c2 -n7 nice -n19 "$@"`). On the server, every spawned ffmpeg/ffprobe process and the processing queue's CPU-heavy work (sharp, clip frame generation) run at the same priority (`ionice -c2 -n7 nice -n19 ffmpeg ...`; sharp concurrency set to 1). The web server itself runs at normal priority so playback and uploads stay responsive.
- No database. All state is plain files under `DATA_DIR`.
- Background work runs in an in-process queue (concurrency 1), driven by per-comment `status.json` files so it survives restarts.

Main units (each independently testable):

| Unit | Responsibility |
|---|---|
| `lib/storage` | Paths, atomic JSON read/write, chunk append, ID/token generation |
| `lib/videos` | Import from inbox, ffprobe validation, faststart remux, version management |
| `lib/capture` (client) | Mic handling, MediaRecorder, event log, coordinate normalisation, chunked upload with IndexedDB retry |
| `lib/pipeline` | Queue, audio assembly, silence check, transcription, key-moment selection, still/clip rendering |
| `lib/export` | Build `feedback.md`, `feedback.json`, README, zip |
| `lib/auth` | Cloudflare Access JWT verification for admin routes |
| `app/r/[token]` | Reviewer UI |
| `app/admin` | Admin UI |
| `app/api/r/...`, `app/api/admin/...` | Route handlers |
| `scripts/` | `yarn export`, `yarn reprocess`, `yarn import` CLIs |

### Configuration (env)

| Var | Meaning |
|---|---|
| `DATA_DIR` | Root data directory (default `./data`) |
| `GROQ_API_KEY` | Groq key for Whisper |
| `WHISPER_LANGUAGE` | Default `en` |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | For admin JWT verification |
| `ADMIN_AUTH` | `cloudflare` (default) or `off` (local development only; refuses to start with `off` when `NODE_ENV=production`) |
| `HOSTNAME`, `PORT` | `127.0.0.1`, `3000` |

## 4. Storage layout

```
data/
  inbox/                                   # admin drops MP4s here (scp/rsync)
  videos/<videoId>/                        # videoId = slug of title + short random suffix
    video.json
    versions/<n>/
      source.mp4                           # validated, faststart-remuxed
      probe.json                           # ffprobe output (fps, size, duration)
    sessions/<sessionId>/
      session.json
      comments/<commentId>/
        meta.json
        status.json
        chunks/<seq>.bin                   # raw upload chunks (kept until audio assembled)
        events/<seq>.json                  # event batches per chunk
        audio.webm | audio.mp4             # assembled, untouched
        audio16k.wav                       # transcription copy
        events.json                        # merged event log
        transcript.json                    # Groq verbose_json
        moments.json                       # chosen key moments with reasons
        render/overview.jpg
        render/moment-01.jpg ...
        render/clip.mp4                    # optional, rendered last
```

Raw captures (`chunks`, `events`, assembled audio, `events.json`) are never modified after completion. Everything in `render/`, `transcript.json` and `moments.json` is derived and can be rebuilt.

### `video.json`
```json
{
  "videoId": "mavala-launch-k3f9",
  "title": "Mavala launch film",
  "token": "<32 random bytes, base64url>",
  "createdAt": "2026-11-21T11:00:00Z",
  "latestVersion": 2,
  "versions": [
    { "version": 1, "importedAt": "...", "originalFilename": "mavala_v1.mp4" },
    { "version": 2, "importedAt": "...", "originalFilename": "mavala_v2_final.mp4" }
  ]
}
```

### `session.json`
```json
{
  "sessionId": "uuid",
  "videoId": "mavala-launch-k3f9",
  "version": 2,
  "reviewerName": "Sarah",
  "userAgent": "...",
  "startedAt": "...",
  "doneAt": null
}
```

### `meta.json` (per comment)
```json
{
  "commentId": "uuid (client-generated)",
  "sessionId": "uuid",
  "version": 2,
  "kind": "moment | general",
  "pausedAtVideoTime": 12.4,
  "startedAt": "wall clock ISO",
  "endedAt": "wall clock ISO",
  "durationMs": 34120,
  "audioMime": "audio/webm;codecs=opus",
  "totalChunks": 18,
  "player": {
    "containerWidth": 1440, "containerHeight": 810,
    "videoWidth": 1920, "videoHeight": 1080,
    "contentRect": { "x": 0, "y": 0, "width": 1440, "height": 810 },
    "fullscreen": false, "devicePixelRatio": 2
  }
}
```
`pausedAtVideoTime` is `null` for general comments.

### `status.json`
```json
{ "state": "receiving | queued | processing | done | failed | empty",
  "steps": { "audio": "done", "transcribe": "done", "moments": "done", "stills": "done", "clip": "pending" },
  "error": null, "attempts": 1, "updatedAt": "..." }
```

## 5. Reviewer experience

Route: `/r/<token>`. Unknown token: a plain "This link isn't valid" page (HTTP 404), no detail.

### Screens

**0. Phone or tablet.** Detected with `(pointer: coarse)` and no fine pointer available. Shows the "best on a computer" page with a Copy link button. The player is not shown.

**1. Welcome.** Video title, the instructions, name field, Start.

```
Feedback: <title>

Thanks for taking a look.

Any time you see something that's not right, just pause it and explain it
to me as if I'm sat right next to you.

Point at things with your mouse. I can't see your finger, but I can see the
pointer. The more specific you are about which bit you'd change, the better.

Your name [__________]

[ Start ]
```

**2a. Mic explanation.** Shown before the browser permission prompt.
"Your browser is about to ask if this page can use your microphone. Please click Allow: it only records while the video is paused." [Continue]

**2b. Mic check.** Live level meter. "Say hello so we know we can hear you." "Start watching" is disabled until the level crosses a speech threshold for at least 300ms, then shows "Got you, loud and clear."
If permission is denied: browser-specific steps to allow it, and a Try again button. The reviewer cannot proceed without a mic.

**3. Playing.** Video as large as the viewport allows. Controls: play/pause, scroll bar (no timecode anywhere, including tooltips), volume, fullscreen (applied to the whole player container, not the `<video>` element, so pointer tracking continues). Hint line: "Spotted something? Pause and tell me." "I'm done" button always visible.

**4. Paused = listening.** Pausing immediately starts a moment comment. Overlay at top of the picture: "Listening" with a red dot and live mic level, and "Point and explain. Press play when you're done." A second, smaller hint line underneath: "Hold the mouse down to zoom in. Use ← → to step through frames." The overlay must not cover the centre of the frame and is ignored by pointer tracking.
- The reviewer can move the pointer, click on the picture, and drag the scroll bar. All of this is recorded.
- Clicking the picture while paused does NOT resume playback. A press shorter than 250ms is a click, recorded as emphasis.
- **Freeze frames.** While paused, scrolling shows silent still frames. The video's own audio never plays during a comment (it is paused), so it cannot bleed into the mic. ← / → step one frame back or forward (frame duration from `probe.json`); Shift+← / Shift+→ step 1 second. Each step is logged as a `seek`.
- **Hold to zoom.** While paused, pressing and holding on the picture for 250ms or more zooms the picture 2.5x around the pointer (CSS transform on the video layer, animated over 150ms). While held, moving the pointer pans: the zoom origin follows the pointer, so the area under the pointer stays under the pointer. Releasing zooms back out over 150ms. No zoom during playback. The cursor shows a magnifier while zoomed.
- Play (button or space) ends the comment.

**4b. Saved.** After play, a small "Saved" toast in the corner, shown only after the server confirms the final chunk. Fades after about 1.5s. While waiting: "Saving...".

**5. End of video.**
```
That's the end of the video.

Got any other things to mention that you haven't mentioned anywhere else?
[ Click here to share them now ]

Want to look at something again? Scroll back and pause on it.

[ I'm done ]
```

**5b. General comment.** Clicking the button starts a general comment.
"Listening" with level meter, then: "Was there anything missing? Anything else you'd change, keep, or want to see?" and a [Finished, save that] button. Space does nothing on this screen. Finished saves and returns to screen 5, so they can add more.

**6. Thank you.** "Thanks, <name>. That's all come through. If you think of anything else, open the same link again and carry on."

### Behaviour rules
- Only a pause creates a moment comment. Rewatching, scrolling and replaying the same section any number of times is fine. Every pause is a separate comment; comments are never merged or deduplicated, and nothing marks a section as "covered".
- No comment counter, no markers on the scroll bar.
- Arrow keys and hold-to-zoom only work while paused; during playback ← / → do nothing (no hidden skipping).
- Space toggles play/pause at page level, except when focus is in a text input or on screen 5b. It calls `preventDefault` so the page never scrolls.
- The session ID is stored in `localStorage` keyed by token. Reopening the link in the same browser resumes the session (skipping the name screen but still doing the mic check). "I'm done" marks the session done; reopening after that starts the player again on the same session, so they can add more.
- A session is pinned to the version it started on. New sessions get the latest version.
- Recording happens only while paused (or during a general comment). Nothing is recorded during playback.

## 6. Capture (client)

### Microphone
- `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })` once, at the mic check. The stream stays open for the session.
- On each comment, a new `MediaRecorder` on that stream with `timeslice = 2000`. MIME preference: `audio/webm;codecs=opus`, then `audio/mp4`, then browser default. The chosen MIME goes in `meta.json`.
- If the track ends (`ended` event), the next pause shows "We've lost your microphone" with a Reconnect button. Events for that comment are still uploaded; it is marked with `micLost: true`.

### Time base
`t` = milliseconds since the MediaRecorder `start` event for that comment (`performance.now()` difference). Audio sample 0 corresponds to `t = 0` within recorder start latency, which is accepted.

### Coordinates
Pointer positions are always stored in full-frame coordinates, whatever the zoom. Without zoom, they are normalised to the displayed picture rectangle (the `<video>` content box after letterboxing for `object-fit: contain`):
`x = (clientX - contentRect.left) / contentRect.width`, same for `y`. Values outside 0..1 are kept and flagged `inside: false`. The content rect is recomputed on resize and fullscreen change, and each change is logged as a `layout` event. While zoomed at scale `s` with origin `(ox, oy)`, the on-screen normalised position `(sx, sy)` maps back to frame coordinates as `x = ox + (sx - ox) / s`, `y = oy + (sy - oy) / s`. Events carry a `zoomed: true` flag while a zoom is active.

### Event log
Each event is `{ "t": <ms>, "type": ..., ... }`:

| type | fields | when |
|---|---|---|
| `pointer` | `x, y, inside, vt` | once per animation frame, only if the pointer moved |
| `click` | `x, y, inside, vt, button` | pointerdown on the player area |
| `seek` | `from, to, via` (`scrollbar` / `key`) | scroll bar change or arrow-key step while paused (`seeked` event) |
| `zoom` | `state` (`start`/`end`), `scale`, `originX, originY` | hold-to-zoom starts or ends; `origin` is in normalised frame coordinates |
| `zoomPan` | `originX, originY` | zoom origin moves while held (sampled with pointer events) |
| `visibility` | `state` (`hidden`/`visible`/`blur`/`focus`) | tab or window changes |
| `layout` | `contentRect, containerWidth, containerHeight, fullscreen` | resize or fullscreen change |

`vt` is `video.currentTime` at the time of the event.

### Upload protocol
All reviewer endpoints are under `/api/r/<token>/`. The token must match a video; otherwise 404.

| Method and path | Body | Result |
|---|---|---|
| `POST sessions` | `{ reviewerName, userAgent }` | `{ sessionId, version }` |
| `GET sessions/<sid>` | | `{ sessionId, version, reviewerName, done }` or 404 |
| `GET video?version=<n>` | | `source.mp4` with HTTP Range support |
| `PUT sessions/<sid>/comments/<cid>/chunks/<seq>` | multipart: `audio` (blob), `events` (JSON array), `meta` (JSON, on seq 0 only) | 200 `{ received: seq }` |
| `POST sessions/<sid>/comments/<cid>/complete` | `{ totalChunks, endedAt, durationMs, player }` | 200 once all chunks 0..totalChunks-1 are present; 409 listing missing seqs otherwise |
| `POST sessions/<sid>/done` | | 200 |

- Chunk PUTs are idempotent: a seq already on disk is acknowledged without rewriting.
- The client keeps unacknowledged chunks in IndexedDB and retries with backoff (1s, 2s, 4s ... capped at 30s). If any chunk has been failing for more than 20s, the banner "Having trouble saving. Keep this tab open and we'll keep trying." appears.
- On page load with pending IndexedDB chunks for this token, the client resumes uploading them before anything else.
- Limits: 5MB per chunk, 50MB per comment, 120 chunk requests per minute per session. Over the limit returns 413/429; the client stops recording that comment and shows the saving banner.

## 7. Processing pipeline (server)

Triggered by a successful `complete`. Jobs are processed one at a time. On startup the server scans for comments whose `status.state` is `queued` or `processing` and re-queues them.

1. **Assemble audio.** Concatenate `chunks/0..n` in order into `audio.webm` or `audio.mp4` (MediaRecorder timeslice chunks concatenate into a valid file). Merge `events/*.json` into `events.json`, sorted by `t`. Produce `audio16k.wav` (mono, 16kHz) with ffmpeg.
2. **Silence check.** Run ffmpeg `silencedetect` (noise -40dB, d=0.5). If no non-silent region of 0.3s or longer exists, set state `empty` and stop (no transcription, no renders).
3. **Transcribe.** Groq `whisper-large-v3`, `response_format=verbose_json`, `timestamp_granularities=[word, segment]`, language from `WHISPER_LANGUAGE`. Save the full response as `transcript.json`. On failure: retry 3 times with backoff (5s, 30s, 120s), then state `failed` with the error. The remaining steps still run without word timings.
4. **Choose key moments.** Candidates, with reason labels:
   - `pause`: the first pointer position after `t = 0` (or centre if none), at `pausedAtVideoTime`.
   - `click`: every click.
   - `dwell`: pointer stays within a radius of 0.02 (normalised) for 400ms or more; one candidate per dwell, at its midpoint.
   - `word`: every transcript word in the list `this, that, these, those, here, there, it`, case-insensitive, at the word's start time, using the latest pointer sample at or before that time.
   - `seek`: every seek destination (consecutive arrow-key steps within 1s collapse into one, at the final frame).
   - `zoom`: every zoom start, plus its end position if the pointer moved more than 0.05 while zoomed.
   Merge candidates within 500ms and 0.03 distance of each other, keeping all reasons. If more than 12 remain, keep by priority `click > zoom > word > dwell > seek > pause`, then earliest. Every moment records `t`, `vt`, `x`, `y`, `inside`, and `reasons` (e.g. `["word 'this' at 3.2s", "dwell 0.9s"]`). Save as `moments.json`.
   General comments have no `vt` and the picture is covered by the 5b screen, so they get no moments, stills, overview or clip: just audio and transcript.
5. **Render stills.** For each moment, extract the frame at `vt` from the session's `source.mp4` with ffmpeg (accurate seek), scaled to at most 1920px wide. Draw with sharp: a high-contrast pointer at (x, y), the previous 1s of trail, and rings for clicks within that second. Save `moment-NN.jpg` (JPEG quality 85). If the reviewer was zoomed at that moment, the full-frame still also gets a rectangle showing the zoomed area, and a second image `moment-NN-zoom.jpg` shows the crop they actually saw (the zoomed region at source resolution, with the pointer).
   `overview.jpg`: the frame at `pausedAtVideoTime` with the whole pointer path drawn, light at the start and dark at the end, clicks as rings. If the reviewer scrolled during the comment, the path segments after a seek are drawn in a different colour and the overview notes "frame changed during comment" in the export.
6. **Render clip** (lowest priority, after all stills in the queue): 15fps, max 1280px wide, H.264 + AAC. Each output frame shows the video frame at the current `vt` plus the pointer and short trail; audio is the comment audio. Frames are generated in Node and piped to ffmpeg as rawvideo. Duration equals the comment audio.

`yarn reprocess <videoId> [--version n] [--comment id] [--from-step name]` clears derived outputs and re-queues. Raw captures are untouched.

## 8. Video import and admin

### Import
- Admin copies MP4s into `data/inbox/` (scp/rsync). Browser upload is not used for source videos, because the Cloudflare Tunnel limits request bodies to 100MB.
- Admin UI `/admin/inbox` lists inbox files. For each: "New video" (enter title) or "New version of..." (pick an existing video).
- Validation with ffprobe: the video stream must be `h264` with pixel format `yuv420p` (8-bit), the container must be MP4, and the duration must be greater than 0. Failures show the reason and leave the file in the inbox.
- Accepted files are remuxed losslessly with `ffmpeg -c copy -movflags +faststart` into `versions/<n>/source.mp4`, `probe.json` is written, and the inbox file is deleted only after the remux succeeds.
- `yarn import <file> --title "..."` or `--video <videoId>` does the same from the shell.

### Admin UI
- `/admin`: videos with title, latest version, sessions, comments, pending processing, last activity, Copy review link.
- `/admin/videos/<videoId>`: versions; per version the sessions (reviewer name, started, done, comment count, empty/failed counts); Download zip button with a "with clips" toggle; Reprocess button for failed comments.
- `/admin/inbox`: import as above.

### Auth
- `/admin*` and `/api/admin/*` are protected by a Cloudflare Access application. People sign in with email; machines use an Access service token (`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers).
- The app also verifies the `Cf-Access-Jwt-Assertion` header against the team's JWKS and `CF_ACCESS_AUD` (using `jose`). Requests without a valid JWT get 401.
- The app listens only on `127.0.0.1`, so the tunnel is the only way in.
- Shell CLIs on geriatrix read `DATA_DIR` directly and need no auth.

## 9. Export

### Admin API
```
GET /api/admin/videos
  -> [{ videoId, title, reviewUrl, latestVersion,
        versions: [{ version, sessions, comments, emptyComments, failedComments,
                     pendingProcessing, lastActivity }] }]

GET /api/admin/videos/<videoId>/export.zip
      ?version=latest|<n>|all   (default latest)
      &clips=1                  (default off)
      &since=<ISO time>         (only comments whose endedAt is after this)
      &partial=1                (don't wait for processing)
  -> 200 application/zip
       Content-Disposition filename: <videoId>-v<n>-<YYYYMMDD-HHmm>.zip  (v"all" for all)
       ETag: hash of the included comment IDs and their status.updatedAt values
  -> 202 + Retry-After: 30 if any included comment is queued/processing (unless partial=1)
  -> 304 if If-None-Match matches

GET /api/admin/videos/<videoId>/export.json   (same query params; feedback.json only)
```
CLI: `yarn export <videoId> [--version n|all] [--clips] [--since ISO] [--out path]`.

Clip rendering is part of normal processing, so `pendingProcessing` counts comments whose clip is not yet rendered. Without `clips=1`, a comment only waiting for its clip does not cause a 202.

### Zip layout
```
README.md          # for the LLM: what this is, how to read it
feedback.md        # main readable document
feedback.json      # complete structured data
media/<commentId>/ overview.jpg, moment-NN.jpg, audio.(webm|mp4), clip.mp4 (if clips=1)
raw/<commentId>/   events.json, transcript.json, moments.json, meta.json
previous/v<n>/     feedback.md + media/ for each earlier version (when exporting v2+ with version=<n> or latest)
```

### `README.md`
Explains, in plain terms for a model reading it cold:
- what the video is, which version, how many reviewers and comments, and the export time
- that each moment comment starts when the reviewer paused, and video times are in seconds from the start of the video (also shown as m:ss.s)
- the coordinate system (0..1 of the picture, origin top-left, values outside mean off-picture)
- what `click`, `zoom`, `dwell`, `word` and `seek` reasons mean, and that `-zoom.jpg` images show exactly what the reviewer was looking at when zoomed in
- that stills show the pointer as drawn by us, not a real screenshot
- which comments failed transcription (audio still included)
- that `previous/` holds feedback on earlier versions, for checking whether it was addressed

### `feedback.md`
- Header: title, version, reviewers, export time.
- Moment comments sorted by `pausedAtVideoTime` across all reviewers (ties by reviewer name, then start time).
- Then general comments, grouped by reviewer.
- Then a count of empty comments per reviewer.
- With `version=all`, one top-level section per version.

Each comment:
```markdown
### Sarah, 0:12.4 (paused 34s)
![overview](media/<cid>/overview.jpg)

"So this logo [📍 moment-02: top-left, 12%/8%] is the old one, and the text
here [📍 moment-03: bottom-centre, clicked] runs on too long..."

Moments:
- moment-01 at 0:12.4, pause, (50%, 50%) ![](media/<cid>/moment-01.jpg)
- moment-02 at 0:12.4, word 'this' at 3.2s + dwell 0.9s, (12%, 8%) ![](media/<cid>/moment-02.jpg)
- moment-03 at 0:12.4, click + word 'here' at 7.8s, (48%, 81%) ![](media/<cid>/moment-03.jpg)
```
Moment references are placed inline after the transcript word nearest the moment's `t`. Position labels come from a 3x3 grid: top-left, top-centre, top-right, middle-left, centre, middle-right, bottom-left, bottom-centre, bottom-right, or off-picture. If the reviewer scrolled during the comment, the header notes the video-time range covered, e.g. `0:12.4 to 0:09.0`.

### `feedback.json`
```json
{
  "schemaVersion": 1,
  "video": { "videoId": "...", "title": "...", "version": 2, "fps": 25, "width": 1920, "height": 1080, "duration": 93.4 },
  "exportedAt": "...",
  "sessions": [ { "sessionId": "...", "reviewerName": "...", "startedAt": "...", "doneAt": "..." } ],
  "comments": [
    {
      "commentId": "...", "sessionId": "...", "reviewerName": "...", "kind": "moment",
      "pausedAtVideoTime": 12.4, "pausedAtFrame": 310, "durationMs": 34120,
      "videoTimeRange": [9.0, 12.4],
      "state": "done", "micLost": false,
      "transcript": { "text": "...", "words": [ { "word": "this", "start": 3.2, "end": 3.4, "pointer": { "x": 0.12, "y": 0.08, "inside": true, "vt": 12.4 } } ] },
      "moments": [ { "id": "moment-02", "t": 3200, "vt": 12.4, "x": 0.12, "y": 0.08, "inside": true, "reasons": ["word 'this' at 3.2s", "dwell 0.9s"], "image": "media/<cid>/moment-02.jpg" } ],
      "files": { "overview": "...", "audio": "...", "clip": null, "events": "raw/<cid>/events.json" }
    }
  ]
}
```
Every transcript word carries the pointer position at the moment it was spoken.

## 10. Errors

| Situation | Handling |
|---|---|
| Mic permission denied | Browser-specific steps and Try again; cannot proceed |
| Mic track ends mid-session | Reconnect prompt on next pause; comment flagged `micLost` |
| Upload failure | IndexedDB retry; banner after 20s of failure; resume on reload |
| Over size/rate limit | 413/429; stop that comment; banner |
| Invalid video in inbox | Rejected with reason; file stays in inbox |
| Groq failure | 3 retries, then `failed`; stills still rendered; README flags it; `yarn reprocess` |
| ffmpeg/sharp failure on one step | That step marked failed in `status.json`; other comments continue; admin UI shows it |
| New version added mid-session | Session stays on its version |
| Bad token | 404 "This link isn't valid" |
| Admin request without valid Access JWT | 401 |
| Server restart mid-processing | Startup scan re-queues |

## 11. Testing

- **Unit (Jest):** coordinate normalisation with letterboxing (wide and tall videos, fullscreen); dwell detection; key-moment merging and capping; word-to-pointer alignment; position labels; `feedback.md` and `feedback.json` generation from fixture data; chunk idempotency and missing-chunk detection; ETag stability; Access JWT verification (valid, expired, wrong audience).
- **Pipeline fixtures:** a recorded sample session (real `events.json` plus a short real audio file and a short H.264 test video) runs through assemble, silence check, moments, stills and export with Groq mocked from a saved response. Assert on `moments.json`, `feedback.json` and file presence, not pixels. A silent-audio fixture must come out `empty`.
- **End-to-end (Playwright, Chromium with `--use-fake-device-for-media-stream` and `--use-file-for-fake-audio-capture=<wav>`):** name, mic check, play, pause, mouse moves and clicks, scroll back while paused, arrow-key frame steps, press-and-hold zoom and pan, play, end of video, general comment, I'm done. Then assert the files on disk, wait for processing (Groq mocked via env), and fetch the zip from the admin API with `ADMIN_AUTH=off`.
- **Manual:** Safari and Firefox pass on macOS/Windows before first real use: mic prompt, recording format, fullscreen pointer tracking, space bar.

## 12. Deployment

- `yarn build` (standalone output), run with systemd: `HOSTNAME=127.0.0.1 PORT=3000 node .next/standalone/server.js`, with `DATA_DIR` outside the app directory (e.g. `/srv/video-feedback/data`).
- cloudflared ingress rule for the hostname pointing to `http://127.0.0.1:3000`.
- Cloudflare Access application covering `/admin*` and `/api/admin/*` with Tim's email allowed, plus one service token for scripts.
- Backups: rsync of `DATA_DIR`.
