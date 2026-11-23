# Snagging list

Things to fix in due course. Newest at the bottom of each section. When an item is done, move it to
"Done" with the commit.

## Talkie

- **New screenshot baselines need Tim's eye.** After the sample-film background fix, the three chromium
  baselines in `e2e/player.spec.ts-snapshots/` are regenerated but not committed. Old and new copies go in
  `/tmp/talkie-baselines-old/` and `/tmp/talkie-baselines-new/` for comparison.
- **Phone checks** of the spike pages and the real player on iPhone and Android (procedure in [phone-checks.md](phone-checks.md)). Set up after fixes 1 and 2 land.
  They decide whether WebM Opus or AAC is tried first (WebM is the current choice).
- **React Native (Phase 2: T16 and T17)**, held until it can be tested on phones.
- **See-through fill and stroke on one shape.** A shape whose fill and stroke are both see-through (the
  same `fill-opacity` and `stroke-opacity` below 1) fades as one picture in the film, so the fill does not
  show through the inner half of the stroke as it does in a browser. Predates gradients. The art mirror
  test (`packages/cli/test/art-mirror.test.ts`) skips the `styles` fixture for this. Workaround in
  [authoring.md](authoring.md#art-rules): keep the stroke solid, or draw fill and stroke as two shapes.
- **stroke-miterlimit is ignored.** The film always uses a miter limit of 4 (the SVG default), and
  Illustrator writes 10, so a sharp miter join between about 11 and 29 degrees comes out bevelled in the
  film. Refusing the attribute would refuse nearly all Illustrator art; the fix is to carry it into the
  Lottie `ml` and the SVG mirror. Predates gradients.
- **draw and trimEnd on a filled node.** The film trims the fill along with the stroke (the Lottie trim
  cuts the path both use); the SVG mirror dashes only the stroke and draws the whole fill, so server
  stills and mirror-based tests disagree with the film part way through. Either refuse a trim on a node
  with a fill (the docs already say draw is for stroked paths) or clip the mirror's fill. Predates
  gradients; check the films in use before refusing.
- **Shared paint rules.** The stretched radial stroke refusal is written in svg-import, emit-lottie and
  emit-svg, the stretched fill trim refusal in motion and emit-lottie, and round6, label and multiply are
  copied between files. Move them into paint.ts and clip.ts so the film, the mirror and the importer
  cannot drift apart.

## Talkie, fixed on branch `fix/talkie-handover` (merged into main 2026-11-21)

1. The "Try again" button is hidden under the control bar on phones (400 px wide or less).
2. The sample film's art stops at about y=540, so the bottom quarter of every frame is blank.
3. Motion bugs in `packages/author`: `pop()` after a move puts the node in the wrong place, and two motions
   on one property at the same instant silently drop a value. Also: input validation for durations,
   coordinates and a second `camera()` call.
4. Fill and stroke fade separately, so the fill shows through a half-transparent stroke. (Fixed for a fading
   node with several paints. Still open: a fade inside another fade still fades paint by paint; needs a precomp.)
5. Two e2e timing tests failed once under heavy machine load (firefox sync p99 85 ms against 70; mobile-safari
   speed 1.5). Rerun `yarn e2e` on a quiet machine to settle it.

## Video feedback

From `apps/video-feedback/docs/FOLLOW-UPS.md` (details there):

- Comments over 20 minutes are transcribed only up to 20 minutes, and the reviewer is not told.
- There is no `cutShort` flag for comments finished by the server sweep or from the browser's saved copy.
- The raw Groq response is not kept (only the normalised transcript).
- The per-session byte cap is counted in memory only.
- A comment with no audio gets no clip.
- A running clip render is not pre-empted by new comments.
- Wording when the microphone disappears during the mic check.
- Fold `lib/review/additions.ts` into the shared copy and test ids (planned in Talkie review Task 2.1).
- The e2e test `silent pause is stored but marked empty @silence` fails most runs, with or without
  recent changes (4 of 4 with `--repeat-each 4` on 2026-11-23): the mic check often misses the fake
  microphone's one "hello" at the start of `e2e-hello-silence.wav`. Needs the hello repeated, or the
  check started before the file plays.

## Talkie review in the feedback tool

- Pointer hit-testing against Lottie layer names ("the reviewer pointed at layer `logo/wordmark`").
- The error panel says "video" for a Talkie film too (`copy.player.videoError`).
- The loading spinner can clear before the first frame of a Talkie film is drawn.
- The standalone build traces the whole app folder (Turbopack warning from `existsSync` in
  `lib/media/talkie-browser.ts`), so releases carry tests and fixtures. Harmless, 70MB.

## Deployment

- **geriatrix root disk is 96% full** (140 MB free). Everything lives on `/srv/data`.
- The old pre-monorepo install (`/srv/video-feedback/app`) can be deleted once the new release
  layout has run for a while.

## Done

- 2026-11-23: back 10 s and forward 5 s buttons either side of play and pause (mp4 and Talkie),
  logged as `seek` with `via: "button"`. And Safari can seek again: the video and film files now go
  out with `Content-Length` (Pages Router routes, as Next drops the header from App Router routes).
  Without it, at internet speed, Safari saw an endless stream and every seek went back to the start.
- 2026-11-22: SVG gradients and clip paths are accepted (branch `feat/svg-gradients-clips`). Linear and
  radial gradients as fills and strokes become Lottie `gf` and `gs`; clip paths become layer masks, with
  precomps under fades. Unsupported forms (reflect and repeat, masks, filters, patterns, `<style>` sheets,
  blend modes, shared ids and others) are refused with the reason. A soft shadow is now one radial
  gradient, smaller than stacked copies. Docs updated: [authoring.md](authoring.md#art-rules).
- 2026-11-22: reviewer onboarding built (mp4 and Talkie): the mic check moves on by itself after
  "Got you, loud and clear", a practice pause on the real film that is never saved, a Give feedback
  button by the scroll bar, and the "Pause any time" hint after 60 s of playing.
- 2026-11-21: one-command deploy (`scripts/deploy/video-feedback.sh`) with the old-CPU sharp build
  (`scripts/deploy/sharp-old-cpu.sh`), Chromium for Talkie stills on geriatrix, and rollback.
  Live Talkie smoke test (`scripts/deploy/smoke-talkie.mjs`) passed on the old CPU.
- 2026-11-21: the Talkie fixes branch (Try again on phones, sample film sky, motion bugs, multi-paint
  fades) merged.
