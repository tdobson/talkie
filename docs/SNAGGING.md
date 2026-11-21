# Snagging list

Things to fix in due course. Newest at the bottom of each section. When an item is done, move it to
"Done" with the commit.

## Talkie

- **SVG gradients and clip paths.** The design spec (`docs/superpowers/specs/2026-11-21-talkie-design.md`
  line 231) says the art importer covers them. The plan (line 641) and `packages/author/src/svg-import.ts`
  (lines 43 and 44) refuse them. The spike's converter (`spike/proto/emit.mjs`) handled a linear gradient,
  masks and a pattern, so porting is doable: gradients become Lottie `gf` fills. Tim: deferred, bring
  Talkie across first. Decide, then either port and update `docs/authoring.md` "Art rules", or fix the spec.
- **New screenshot baselines need Tim's eye.** After the sample-film background fix, the three chromium
  baselines in `e2e/player.spec.ts-snapshots/` are regenerated but not committed. Old and new copies go in
  `/tmp/talkie-baselines-old/` and `/tmp/talkie-baselines-new/` for comparison.
- **Phone checks** of the spike pages and the real player on iPhone and Android (procedure in [phone-checks.md](phone-checks.md)). Set up after fixes 1 and 2 land.
  They decide whether WebM Opus or AAC is tried first (WebM is the current choice).
- **React Native (Phase 2: T16 and T17)**, held until it can be tested on phones.

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

## Onboarding (sketch approved by Tim 2026-11-21: "looks good")

Build on main now that the Talkie integration has landed. Six steps as sketched:

1. Mic check: "Say hello". No button; it moves on by itself when it hears speech.
2. "Got you, loud and clear" for 1 s.
3. Practice: the real film starts playing with a coach mark on Pause (or the space bar).
4. Paused: "Listening", say anything and point at the picture.
5. About 1 s of speech then a short silence: "Got that", then after 2 s the film jumps back to the start
   and plays. The practice comment is thrown away.
6. Watching: a "Give feedback" button next to the scrub bar (same as pause). After 60 s of playing with
   no pause, a hint fades in for 4 s: "Got something to say? Pause any time."

Defaults taken (Tim didn't object): practise on the first seconds of the real film, keep the 60 s hint.

## Done

- 2026-11-21: one-command deploy (`scripts/deploy/video-feedback.sh`) with the old-CPU sharp build
  (`scripts/deploy/sharp-old-cpu.sh`), Chromium for Talkie stills on geriatrix, and rollback.
  Live Talkie smoke test (`scripts/deploy/smoke-talkie.mjs`) passed on the old CPU.
- 2026-11-21: the Talkie fixes branch (Try again on phones, sample film sky, motion bugs, multi-paint
  fades) merged.
