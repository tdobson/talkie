# Talkie spike report (Phase 0, Task S2)

Measured on 2026-11-21. Scene: GSE `g01-s01`, "In the roof, not on it", 27.24 s, from chapter `g01`
(292.88 s). The checks are the four in section 10 of the design spec.

| Check | Result | Short version |
|---|---|---|
| 1. Style | **Tim to judge** | Five side by side stills are in `out/`. Four match closely. In the fifth (rain and drops) the drops sit about 10 px from the MP4's and the rain differs a little. |
| 2. Sync | **FAIL as measured** (Firefox), cause not established | Chromium and WebKit: p99 0 ms. Firefox: p99 55 to 60 ms against a 40 ms limit, with the picture ahead of the reported `currentTime` and the worst frames at the clock's 250 ms cap. The machine was heavily loaded. Needs the clock probe and a rerun on a quiet machine before T5 copies the clock, then phones. |
| 3. Size | **PASS** | Scene: 119 KB against 789 KB in H.265 (6.6 times smaller). Chapter: about 1.35 MB (estimate) against 9.14 MB in H.265 (6.8 times smaller). |
| 4. Compatibility | **PASS** (stock dotlottie-web) | `out/scene.lottie` loads with no error and draws frame 120. LottieFiles' own web viewer is a manual step. |

Chosen Opus container: **WebM**, with the AAC `.m4a` as the fallback. Chosen SVG converter: **our own**.
Reasons for both are further down.

## Check 1: style

Run: `nice -n19 ionice -c2 -n7 node stills.mjs` (last rerun at 13:53, after review). Each PNG is
3840 x 1080: the MP4 frame on the left, the Lottie canvas on the right, at the same scene time.

| File | Scene time | MP4 time | What is on screen |
|---|---|---|---|
| `out/compare-3.00.png` | 3.00 s | 26.88 s | both roof sections, both headings |
| `out/compare-9.50.png` | 9.48 s | 33.36 s | left half dimmed, tiles lifted off the right |
| `out/compare-12.60.png` | 12.60 s | 36.48 s | the system arriving |
| `out/compare-18.20.png` | 18.20 s | 42.08 s | "Black tray" label and its leader line. No rain yet. |
| `out/compare-20.50.png` | 20.48 s | 44.36 s | rain streaks and both water drops, mid run |

**Correction.** The first version of this report listed a still at 23.00 s as "the water drops", and
the README said 18.20 showed the label "with rain". Both were wrong. In `scene/g01-s01.nodes.json`
the rain animations run from 18.31 to 22.26 s and the two `water` groups are visible only from
18.88 to about 22.67 s, so the whole passage fell between those two stills and neither showed it.
The drops are the one part of the port made by sampling per frame code (175 and 185 samples), so the
riskiest part had no evidence at all. I replaced the 23.00 still with one at 20.5 s. It is still
five stills.

I opened 3.00, 9.50 and 18.20 for the first version, S1 opened 12.60, and I opened the new 20.50 at
full size with crops around each drop. In the first four, geometry, colours, the dimming, the label
and the leader line match the MP4. In 20.50:

- Both drops are there on both sides, same shape, colour and size, each on the right surface (one
  on the glass of the on-roof module, one at the foot of the tray).
- Each Lottie drop sits about 10 px uphill of its MP4 twin (10 to 12 px by eye on a 1920 px wide
  frame). The MP4 frame is read 20 ms later than the Lottie one (`stills.mjs` takes the middle of
  the video frame and the start of it for Lottie), and a drop moving downhill would account for
  some of that. I have not worked out how much, so treat it as an open difference.
- The drop's trail on the right section reads a little stronger in Lottie than in the MP4.
- The rain streaks are present on both sides in the same style. They are not in identical places.
  They move fast, so the same 20 ms may explain it. I did not check.

So "matches the MP4" holds for the static art and the label. For the rain and drops the honest
statement is "close, with small differences in position that I have not explained". One still is
thin evidence for a moving passage; manual step 1 asks Tim to scrub 18.5 to 22.5 s in
`compare.html` as well.

What differs on purpose:

- The MP4 has the caption, the chapter card in the top left and the dragon in the corner. The Lottie
  side has none of them on purpose: in Talkie the player draws those.
- The scene has no camera move, so the stills do not show one. `scene/g01-s01-camera.json` adds a slow
  ease to prove the mechanism. It has nothing in the MP4 to compare with.

The verdict is Tim's (see the manual steps).

## Check 2: sync

Script: `sync.mjs`, which drives `sync.html?repeats=24` (a 653.76 s track) in Playwright's Chromium
159.0.8154.6, Firefox 159.0 and WebKit 27.2. For each of the three narration files it plays 10 minutes
from the start, then makes 20 random seeks with 3 s of playback after each (same seeded targets in
every browser), then plays 60 s each at 0.5x, 1.5x and 2x. Raw results: `out/sync-<browser>.json` and
`out/sync-<browser>.log`.

Drift is the plan's definition: on every animation frame, |film time just drawn - `audio.currentTime`
read straight after the draw|. Pass is p99 at or under 40 ms.

`canPlayType`: all three browsers answered "probably" for `audio/webm; codecs=opus`,
`audio/ogg; codecs=opus` and `audio/mp4; codecs=mp4a.40.2`. All nine runs played to the end with no
page errors. Measured speeds were 0.49 to 0.50, 1.47 to 1.49 and 1.96 to 1.99.

### Overall, all three phases together (ms)

| Browser | Track | Frames | p50 | p95 | p99 | max | Result |
|---|---|---|---|---|---|---|---|
| Chromium | WebM Opus | 28825 | 0 | 0 | 0 | 88 | PASS |
| Chromium | Ogg Opus | 30799 | 0 | 0 | 0 | 32.1 | PASS |
| Chromium | AAC m4a | 32167 | 0 | 0 | 0 | 39.6 | PASS |
| Firefox | WebM Opus | 24213 | 0 | 32 | 60 | 250 | FAIL |
| Firefox | Ogg Opus | 25594 | 0 | 32 | 55 | 250 | FAIL |
| Firefox | AAC m4a | 27256 | 0 | 33 | 56 | 250 | FAIL |
| WebKit | WebM Opus | 25835 | 0 | 0 | 0 | 5.93 | PASS |
| WebKit | Ogg Opus | 27763 | 0 | 0 | 0 | 18.66 | PASS |
| WebKit | AAC m4a | 29421 | 0 | 0 | 0 | 6.57 | PASS |

### By phase, p99 and max (ms)

| Browser | Track | 10 min play | last 30 s of it | 20 seeks | 0.5x | 1.5x | 2x |
|---|---|---|---|---|---|---|---|
| Chromium | WebM | 0 / 3.43 | 0 / 0 | 0 / 29.4 | 0 / 0 | 0 / 37.95 | 0 / 88 |
| Chromium | Ogg | 0 / 6.19 | 0 / 0 | 0 / 32.1 | 0 / 0 | 0 / 0 | 0 / 0 |
| Chromium | m4a | 0 / 6.56 | 0 / 0 | 11.17 / 39.6 | 0 / 0 | 0 / 0 | 0 / 0 |
| Firefox | WebM | 55 / 238 | 50 / 154 | 59 / 250 | 39 / 81.5 | 136.5 / 250 | 118 / 250 |
| Firefox | Ogg | 56 / 250 | 60 / 91 | 50 / 250 | 39.5 / 96.5 | 54 / 178.5 | 68 / 250 |
| Firefox | m4a | 59 / 250 | 41 / 72 | 40 / 95 | 38 / 48.5 | 73.5 / 250 | 68 / 250 |
| WebKit | WebM | 0 / 5.93 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| WebKit | Ogg | 0 / 14 | 0 / 2.33 | 0 / 18.66 | 0 / 0 | 0 / 0 | 0 / 0 |
| WebKit | m4a | 0 / 6.57 | 0 / 0 | 0 / 0 | 0 / 3.38 | 0 / 0 | 0 / 0 |

Nothing drifts over time. The last 30 s of the 10 minute run look like the rest of it in every case,
and the sound advanced 597.7 to 600.1 s in 600 s of wall clock.

### How much weight these numbers can carry

Read them with four things in mind. I think they matter more than the pass and fail column.

**Correction.** The first version of this section said Firefox lets `currentTime` advance during the
draw, so the Firefox drift was drawing time, the smoothing clock held, and the player could fix it by
aiming ahead by its drawing time. The data in `out/sync-firefox.json` contradicts that, and the
review caught it. Points 2 and 3 and the conclusion below replace it.

1. **The machine was busy and the browsers were niced.** tragicomix had a load average of 15 to 27 on
   12 cores throughout (recorded per track in the JSON), and all three browsers ran at once at
   nice 19. They managed 30 to 36 frames a second, and one `setFrame` call took 17 to 38 ms at the
   median and 35 to 204 ms at p99, depending on the phase.
2. **In Firefox the picture is ahead of the reported `currentTime`, and the drift is the smoothing
   clock's own extrapolation.** Three things in the raw data say so:
   - `meanSigned` is positive in every Firefox phase, +2.8 to +14.4 ms. `sync.mjs` defines negative
     as the picture behind the sound, so the picture is ahead. A picture held up by drawing would
     be behind.
   - p50 is 0 in the play, seek, 1.5x and 2x phases while `renderP50` is 23 to 38 ms. On at least
     half the frames `currentTime` did not move at all during a draw that took that long.
   - The maximum is exactly 250 ms in 9 of the 15 separate phases (play, seeks and the three speeds,
     for three tracks). 250 ms is `SmoothClock`'s cap on running ahead. The 0.5x figures in the JSON are all
     multiples of 0.5 ms, which is a whole number of wall clock milliseconds times the rate: the
     clock's extrapolation term and nothing else.

   A short run of `proto/probe-clock.mjs` after the review (13:53, load average about 8, so not a
   quiet machine) shows the mechanism. Firefox moved `currentTime` in steps of 40.2 ms, on 75 of
   179 frames in 3 s of plain playback. Chromium moved it on 180 of 181 frames, in steps of about
   16.7 ms. So in Firefox the clock extrapolates between steps on most frames, and the metric
   (clock against raw `currentTime`) counts that extrapolation as drift. That explains the p95 of
   32 to 33 ms. It also means that with 40 ms steps a limit of 40 ms on this metric leaves Firefox
   almost no room, whatever the player does.
3. **Why the worst Firefox frames are so far out is not established.** A p99 of 55 to 60 ms and a
   maximum at the 250 ms cap mean `currentTime` sometimes went 55 ms, and at times 250 ms or more,
   without changing. There are two readings and this run cannot tell them apart:
   - the sound kept playing and Firefox was late updating `currentTime` on a loaded machine, in
     which case the clock was right to run on and the picture was near the sound; or
   - the sound really stalled, in which case the clock ran the picture up to 250 ms ahead of it,
     which is a real sync fault and one the clock caused.

   Nobody listened (the run was muted) and nothing recorded the audio output position.
4. **The metric says little about Chromium and WebKit either.** There `currentTime` changes on
   every frame and does not move while a script runs, so the clock never extrapolates, the reading
   after the draw equals the one before, and the drift is 0 almost by construction. A p99 of 0 shows
   the clock follows `currentTime`. It does not show the picture reached the screen in time with
   the sound.

I also added a second reading of the same samples (`estimated` in the JSON, `estimatedDrift` in
`sync.mjs`). It takes the highest recent `currentTime`, carried forward at the playback rate, as a
guess at where the sound is, and measures the picture against that. Overall p50 / p95 / p99 in ms:

| Browser | WebM | Ogg | m4a |
|---|---|---|---|
| Chromium | 7.8 / 50.1 / 113.4 | 7.9 / 37.3 / 76.1 | 7.0 / 42.0 / 82.9 |
| Firefox | 15.2 / 58.6 / 114.6 | 15.1 / 51.0 / 91.2 | 13.6 / 51.0 / 94.4 |
| WebKit | 7.7 / 40.3 / 91.9 | 8.4 / 32.3 / 66.5 | 7.1 / 34.3 / 75.0 |

By this reading no browser is inside 40 ms at p99 on this machine today. Treat it as a diagnostic
and no more: I designed it today, the plan did not ask for it, and it rests on the assumption that
the sound never stalls, which is the very thing point 3 leaves open.

What I take from it:

- Nothing drifts over the long run. That part stands, in all three engines: 597.7 to 600.1 s of
  sound in 600 s, and the last 30 s like the rest.
- For Chromium and WebKit the clock follows `currentTime` across seeks and speed changes. That is
  all the 0 shows.
- For Firefox I cannot say the smoothing clock holds. Its typical error on this metric is its own
  extrapolation over 40 ms steps, which is by design and probably harmless. Its worst frames hit
  the cap, and whether that is harmless depends on point 3.
- Do not make the player aim ahead by its drawing time on the strength of this run. The Firefox
  picture is already ahead on this metric, so that would move it the wrong way. Drawing cost is
  still worth measuring on a quiet machine and on a phone (17 to 38 ms a frame here says nothing
  about either), but as its own question.
- Before T5 copies `SmoothClock`: run `proto/probe-clock.mjs firefox` on a quiet machine (manual
  step 2). If `currentTime` still steps by 40 ms and never sits unchanged for much longer than that,
  the long gaps here were load, and the clock can be copied as it is, with the test limit set
  against the step size. If it still goes 100 ms or more without changing on a quiet machine, the
  cap and the pass metric both need a second look first. I have not done that run: the machine was
  not quiet today.

Two other caveats:

- The three tracks ran one after another while the other browsers ran alongside, so the differences
  between WebM, Ogg and m4a in these tables follow the machine's load at that moment (they move
  together across browsers). They do not show one container syncing better than another.
- Playwright's WebKit on Linux uses GStreamer. It is not Safari's media stack, and it says nothing
  about which containers an iPhone plays. Only the phone check answers that.

Changes to the harness for this run:

- `sync.html` now counts a frame as playing when `currentTime` is moving, as well as when
  `readyState` is 3 or more. WebKit on Linux reports `readyState` 2 for long spells after a seek or a
  speed change while the sound plays on, and the old test threw those frames away (zero samples at
  0.5x, 1.5x and 2x). `proto/probe-clock.mjs` is the small diagnostic that showed it.
- `sync.mjs` sets the audio element's volume to 0. See the apology at the end.

## Check 3: size

Script: `node sizes.mjs`, raw output in `out/check3.json`. The video files were encoded on asterix at
nice 19 into `/tmp/talkie-spike/` (ffmpeg 7.1.5, x265 4.1):

```sh
C=~/dev/md-roofkit-films-media/gse/chapters/g01.mp4
L="nice -n19 ionice -c2 -n7 ffmpeg -v error -y"
$L -ss 23.88 -t 27.24 -i $C -c:v libx264 -crf 23 -preset medium -c:a aac -b:a 64k -movflags +faststart slice-h264.mp4
$L -ss 23.88 -t 27.24 -i $C -c:v libx265 -crf 26 -preset medium -tag:v hvc1 -c:a aac -b:a 64k -movflags +faststart slice-h265.mp4
$L -i $C -c:v libx265 -crf 26 -preset medium -tag:v hvc1 -c:a aac -b:a 64k -movflags +faststart g01-h265.mp4
```

### The scene (27.24 s), measured

| What | Bytes |
|---|---|
| `a/g01-s01.json` raw | 265,155 |
| `a/g01-s01.json` brotli (quality 11) | 16,905 |
| `a/g01-s01.json` gzip (level 9) | 24,069 |
| Narration, Opus in WebM, 32 kbit/s | 102,280 |
| Narration, Opus in Ogg, 32 kbit/s | 95,673 |
| Narration, AAC m4a, 64 kbit/s | 190,153 |
| **Talkie: brotli animation + WebM Opus** | **119,185** |
| Talkie on the AAC fallback: brotli animation + m4a | 207,058 |
| Talkie from a host that only gzips: gzip animation + WebM Opus | 126,349 |
| H.264 slice, re-encoded (crf 23, AAC 64k) | 1,077,998 |
| **H.265 slice (crf 26, AAC 64k)** | **789,361** |

Talkie is 6.62 times smaller than the H.265 slice and 9.04 times smaller than the H.264 slice. PASS.

### The chapter (292.88 s)

| What | Bytes | |
|---|---|---|
| Existing H.264 chapter `g01.mp4` | 30,990,036 | measured |
| **H.265 chapter (crf 26, AAC 64k)** | **9,140,868** | measured |
| Talkie animation: 620.6 bytes/s from the scene x 292.88 s | 181,760 | estimate |
| Talkie Opus at 32 kbit/s x 292.88 s | 1,171,520 | estimate |
| **Talkie chapter, folder form** | **1,353,280** | **estimate** |
| Talkie chapter on the AAC fallback | 2,226,254 | estimate |

The estimated Talkie chapter is 6.75 times smaller than H.265 and 22.9 times smaller than the
existing H.264 file. On the AAC fallback it is still 4.11 times smaller than H.265. PASS, on an
estimate.

About that estimate:

- It scales one scene to the whole chapter. Other scenes may be heavier or lighter than this one.
  The margin is wide: the animation could be 43.8 times larger per second before the chapter stopped
  beating H.265.
- Sound is 87% of the Talkie chapter. The picture is close to free; the narration bitrate sets the size.
- It leaves out `talkie.json`, `manifest.json`, captions and the poster. Those are a few KB.
- The brotli figure assumes the host serves `.json` with brotli. With gzip only, the scene's
  animation is 24 KB and the result does not change.
- The H.265 files carry AAC at 64 kbit/s requested (about 54 as measured); Talkie's main track is
  Opus at 32. Video alone in the H.265 chapter is 189 kbit/s, about 6.9 MB, which is still five times
  the whole Talkie estimate.
- The H.264 slice is a re-encode at crf 23, as the plan asked. It comes to about 317 kbit/s, against
  846 for the existing chapter file, so the existing film was encoded more generously than my slice.
  I did not find out which settings the film used.

## Check 4: compatibility

Script: `nice -n19 ionice -c2 -n7 node pack.mjs`, raw output in `out/check4.json`, screenshot in
`out/check4-frame120.png`.

`out/scene.lottie` is 319,410 bytes, packed with fflate: `manifest.json` (80 bytes), `talkie.json`
(333), `a/g01-s01.json` (265,155 before deflate), `u/n.webm` (102,280, stored) and `u/n.m4a` (190,153,
stored). The manifest is `{"version":"2","generator":"talkie-spike 0.0.0","animations":[{"id":"g01-s01"}]}`.

`compat.html` hands the file's URL to stock `DotLottie` from `@lottiefiles/dotlottie-web` 0.83.2 and
has no Talkie code in it. In Chromium 159: the `load` event fired, there was no `loadError` and no
console error, the player reported 1635 frames and read the manifest back, `setFrame(120)` left
`currentFrame` at 120, and the canvas had 226 distinct colours (a blank one has 1). I looked at the
screenshot and it is the scene. PASS.

The extra files (`talkie.json`, `u/`) did not upset the stock player. I did not upload the file to
lottiefiles.com, because that would send project material to an outside service. That is a manual
step below. The manifest shape beyond `version`, `generator` and `animations` was not checked against
the published v2 schema; the stock player accepting it is the evidence.

## Chosen Opus container: WebM

- All three desktop engines said "probably" to both WebM Opus and Ogg Opus and played both. Sync was
  the same in both, within the noise of this run.
- The spec already names `audio/webm; codecs=opus` in `talkie.json`. Nothing here argues for changing it.
- Safari is the open question. The explorer's reading (web search, not verified) was that iOS Safari
  only gained Ogg Opus in 18.4, while WebM Opus arrived earlier but had `<audio>` bugs on some
  versions between iOS 15.4 and 17.3. WebM is the safer of the two, and the AAC `.m4a` covers any
  iPhone that refuses it.
- So: WebM Opus first, AAC m4a second, no Ogg. The iPhone check below confirms or overturns this.
- The WebM file is 7% larger than the Ogg one (102,280 against 95,673 bytes for the scene). That is
  container overhead and is not worth trading compatibility for.

## Chosen SVG converter: our own

- The S1 pipeline (`proto/capture.mjs` and `proto/emit.mjs`) already took this whole scene from the
  built SVG to Lottie with no fallback: 495 elements, 292 animations, paths, basic shapes, fills,
  strokes, a linear gradient, groups, transforms, masks, a pattern and outlined text. The emitter
  throws on anything it cannot represent, which is the behaviour we want in a build.
- python-lottie and Glaxnimate are not installed here and I did not install or run them, so this is
  not a head to head. As far as the explorer's survey goes, they convert a drawing; our scenes are
  SVG plus Web Animations timings, so we would need our own animation mapping in any case.
- An in-house converter keeps the toolchain in one language (Node), with no Python or Qt dependency.
- Known gap to fix in the real one: a shape with both fill and stroke that fades on its own fades the
  two paints separately. I did not see it in the stills.

## Manual steps for Tim

1. **Judge check 1.** Open the five `out/compare-*.png` files. Left is today's MP4, right is Lottie.
   Ignore the caption, chapter card and dragon on the left. Is the right side acceptable? If not,
   the spec says stop and revisit approach C. Look hardest at `compare-20.50.png`: the rain and the
   two drops are the part converted by sampling, and the drops are about 10 px off. Then open
   `compare.html` (step 3 says how) and drag the slider through 18.5 to 22.5 s, since one still
   cannot show whether the drops move the way the MP4's do.
2. **Rerun check 2 when tragicomix is quiet,** or on asterix, one browser at a time:
   ```sh
   cd spike
   REPEATS=24 ./make-audio.sh        # the 24x tracks are not in git (9 MB)
   node sync.mjs --browser chromium  # then firefox, then webkit; about 43 minutes each
   ```
   Do the clock probe first. It takes about 10 seconds and settles the open question in check 2:
   ```sh
   nice -n19 ionice -c2 -n7 node proto/probe-clock.mjs firefox webm
   ```
   Read "step size" and "wall between changes". Today, under load, Firefox gave 40.2 ms steps and a
   longest gap of 55 ms in three 3 second windows. If the longest gap stays near 40 ms when the
   machine is quiet, the 250 ms readings were load. The probe only watches 3 seconds per phase, so
   the full Firefox run is still needed to see whether any frame reaches the cap.
   Add `--tracks webm` to do one track in about 15 minutes. Look at `renderP50` and the load average
   in the output first. In the Firefox JSON, check `max` (250 means the clock hit its cap) and
   `meanSigned` (positive means the picture is ahead of `currentTime`). The run is silent
   (volume 0), so it cannot tell you whether the sound stalled. To find that out, play
   `sync.html` aloud in Firefox with headphones and listen for gaps.
3. **Phones.** From the repo root run `npx serve spike`, then on an iPhone and an Android phone on
   the same network open `http://<this machine's address>:3000/sync.html` and
   `http://<this machine's address>:3000/compare.html`.
   - On `sync.html`: note the `canPlayType` line (this settles WebM against Ogg on the iPhone), press
     Play, leave it 9 minutes (the track in git is 544.8 s), press Random seek 20 times, then try
     0.5x, 1.5x and 2x for a minute each. The readout shows p50, p95, p99 and max. Pass is p99 at or
     under 40 ms. On Safari the number will probably read near 0 (point 4 under check 2), so also watch
     whether the label and the drops land with the words.
   - To force a track: `sync.html?audio=webm`, `?audio=ogg` or `?audio=m4a`.
   - On `compare.html`: copy the chapter MP4 to `spike/media/g01.mp4` first (see `README.md`), then
     drag the slider and check the two sides agree.
4. **Safari on a Mac,** if one is to hand: the same two pages. Playwright's WebKit is not Safari.
5. **LottieFiles' own tools.** Drop `out/scene.lottie` onto the viewer at lottiefiles.com (or open it
   in the LottieFiles desktop app) and confirm it opens and plays without an error. This uploads the
   scene to their service, which is why I left it to you.

## An apology, and what ran where

- **Sound came out of tragicomix.** My first full sync run (started about 13:01, stopped about
  13:02:30) played the narration aloud through the desktop's audio from headless Chromium and Firefox
  at once. The short smoke runs before it, between about 12:53 and 13:00, will have been audible too.
  Playwright does not mute them and I had not checked. I killed the run when I saw the streams in
  PulseAudio, set the volume to 0 in `sync.mjs` and the probe, watched the streams to confirm, and
  started again. I changed no PulseAudio settings.
- After review, on tragicomix, niced: the five stills again (13:53, with 20.5 s in place of 23 s) and
  `proto/probe-clock.mjs` once each for Firefox and Chromium (about 10 s each, muted). The nine full
  sync runs were not repeated; the tables above are the original run.
- On tragicomix, all niced: the five stills, the sync harness (smoke runs, a clock probe, then the
  nine full runs), the pack and load for check 4, the 24x narration encode (audio only), and the
  Playwright browser download (Chromium headless shell 1255, Firefox 1572, WebKit 2388, ffmpeg 1013,
  into `~/.cache/ms-playwright`).
- On asterix, niced: the two slices and the H.265 chapter (979 s of encoding for the chapter). The
  outputs are in `/tmp/talkie-spike/` there and can be deleted.

## Clock probe on a quiet machine (added after the spike)

Run on judithix at 14:00 on 2026-11-21, load average 0.4 to 0.8 on 12 cores, niced, muted:
`node proto/probe-clock.mjs firefox webm|ogg|m4a` (Firefox 159.0, playwright firefox v1572).

| Track | Phase | `currentTime` step (ms, p50 / max) | Wall time between changes (ms, p50 / max) |
|---|---|---|---|
| WebM | play | 40.2 / 40.4 | 34 / 55 |
| WebM | after seek | 40.2 / 40.4 | 36 / 60 |
| WebM | 2x | 40.4 / 81.2 | 17 / 44 |
| Ogg | play | 40.2 / 40.5 | 41 / 66 |
| Ogg | after seek | 40.2 / 40.4 | 42 / 67 |
| Ogg | 2x | 40.4 / 80.9 | 17 / 48 |
| m4a | play | 40.2 / 40.4 | 44 / 55 |
| m4a | after seek | 40.2 / 40.4 | 34 / 67 |
| m4a | 2x | 40.4 / 81.1 | 17 / 48 |

Firefox still steps by 40.2 ms, and the longest gap is 55 to 67 ms, well short of 100 ms. So the
250 ms readings in the main run were load on tragicomix, and `SmoothClock` can be copied into T5 as
it is. The plan's end-to-end sync limit for the Firefox project is now 0.07 s instead of 0.04 s,
because on this metric the clock's extrapolation across a 40 ms step counts as drift.

### Full Firefox sync run on a quiet machine

Run on judithix from 14:01 to 14:15, load average 0.7 to 1.0, niced, muted:
`node sync.mjs --browser firefox --tracks webm` (same protocol as check 2). Raw output:
`out/sync-firefox-judithix.json` and `.log`.

| Phase | p50 | p95 | p99 | max (ms) |
|---|---|---|---|---|
| 10 min play | 16 | 34 | 35 | 56 |
| 20 seeks | 16 | 34 | 34 | 54 |
| 0.5x | 16.5 | 33.5 | 34 | 44 |
| 1.5x | 0 | 27 | 30 | 66 |
| 2x | 0 | 34 | 36 | 70 |
| **Overall** | 15 | 34 | **35** | **70** |

Firefox passes check 2 on a quiet machine: p99 35 ms against the 40 ms limit, and no frame came
near the 250 ms cap. `setFrame` took 10 ms at the median (38 on tragicomix under load). The sound
advanced 600.55 s in 600 s of wall clock. The margin is small (5 ms), so the plan keeps 0.07 s as the
Firefox limit in the end-to-end test, which runs niced on a busy machine.
