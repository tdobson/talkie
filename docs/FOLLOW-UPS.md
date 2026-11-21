# Follow-ups

Left over from the Phase 6 review (Task 6.2). Everything rated critical, high or medium was
fixed, and so were the low findings that were quick. What is here was either out of reach for
that task or a judgement call worth a second look.

## Shared files to fold in

Folded in by the Talkie review plan (Task 2.1): `moreCopy` is now part of `copy`, `MORE_T` is part
of `T`, `copy.micCheck.heard` has its full stop, and `CommentMeta` has `cutShort?: boolean`. Still
open:

- `lib/limits.ts` holds the new limits and time-outs. It can stay separate (tests lower the
  values on its one mutable object) or move into `constants.ts`.

## Not done

- **Raw Groq response.** The spec used to say the full `verbose_json` body is saved as
  `transcript.json`. The step saves the normalised `Transcript`, and the spec now says so. If
  the per-segment fields (`avg_logprob`, `no_speech_prob`, `compression_ratio`) turn out to be
  useful to the LLM, save the raw body next to it as `transcript.raw.json` and add it to
  `raw/<cid>/` in the zip. That needs the `Transcriber` interface to return the raw body too.
- **Very long comments are cut, not split.** Audio is processed up to 20 minutes
  (`limits.commentDurationMs`); the rest of a longer recording stays in `audio.webm` but is not
  transcribed. The reviewer is not told. Either stop the comment in the player at the limit
  (reuse the "This comment is full" notice) or split long audio into segments for Groq and
  offset the word timings.
- **A flag for comments that were cut short.** A comment finished by the server sweep, or
  completed from the provisional IndexedDB record, has an estimated `endedAt` and
  `durationMs` and may be missing its last two seconds. `CommentMeta` now has
  `cutShort?: boolean`, but nothing sets it yet. Set it in both places and mention it in the
  export.
- **Bytes per session survive only in memory.** The 2GB per-session cap is counted since the
  server started. Comments per session (300) and the free-disk check bound the real damage. A
  persistent count would mean summing the session's folders on a timer.
- **Clip for a comment with no audio.** A comment recorded with no microphone gets moments and
  stills but no clip (`clip: skipped`). A silent clip of the pointing would be possible.
- **A running clip is not pre-empted.** New comments wait behind a clip that is already
  rendering. It is now bounded (20 minutes of video at most, 45 minutes of wall clock), which
  was the risk; pre-emption would mean killing and re-queuing the clip job.
- **Mic-denied wording after a mid-check loss.** If the microphone goes away during the mic
  check, the reviewer lands on the "browser blocked the microphone" screen. The no-device
  wording is only used when the browser reports that no microphone exists.

## Talkie

Left over from the Talkie review (plan Task 5.2). The high and medium findings were fixed with
tests: the film route and `mediaKinds` are committed, `sceneWarning` events are stored,
`meta.json` records `mediaKind: 'talkie'`, and the welcome screen shows the film's poster.

- **A folder import packs the film in memory.** `stageFolder` in `lib/videos/import-film.ts`
  reads every listed file into one map and `packFilm` builds the zip in memory too, so a film
  near the 500 MB limit can need over 1 GB inside the Next server. Streaming the pack with yazl
  would fix it, but yazl and fflate do not deflate to the same bytes, so `film.lottie` would stop
  matching what `talkie pack` writes for the same folder (a test relies on that today). Either
  give up the byte match, or add a streaming packer to `@talkie/format` and use it in both
  places. Until then, import large films as a packed `.lottie`, which is copied and not repacked.
- **The load failure panel says "video" for a film.** `copy.player.videoError` reads "We couldn't
  load the video" for a Talkie film as well. `lib/review/copy.ts` is a frozen shared file, so the
  wording was left. "We couldn't load this" or a second string for films would do.
- **`mediaKind` is written for Talkie comments only.** A comment on an MP4 version has no
  `mediaKind` in its `meta.json`, which reads as `'mp4'`. That keeps old and new MP4 data the
  same. Write it for both kinds if a reader ever needs it spelled out.
- **A poster only for Talkie versions.** The welcome screen shows the poster of the latest
  version when that version is a film. An MP4 version still has no picture there.
- **The loading spinner can go before the first frame is up.** `TalkieAdapter.load()` reports the
  film as loaded once `talkie.json` is in, but the first scene is drawn only after the renderer's
  WebAssembly (1.2 MB) has arrived. On a slow link the reviewer sees a black picture with a
  caption for a moment. The first e2e screenshots showed exactly that, when the WebAssembly still
  came from a CDN. It is now served by this site from `public/talkie/` (copied there by
  `yarn build:render-page`), which shortens the gap, and the e2e test fails if the page asks any
  other site for anything. Holding the spinner until the engine shows its first scene needs an
  event from `@talkie/player`.
- **Reviewer screenshots are not compared.** `e2e/talkie-review.spec.ts` saves four screenshots
  under `test-results/` for a person to look at. Nothing fails if the caption plate or the error
  panel moves.

## Deployment notes for Phase 7

- Set the Cloudflare Access session cookie to `SameSite=Lax` or `Strict`. The app refuses
  cross-site admin POSTs on its own, and this is the second layer.
- `DATA_DIR` needs more than 1GB free (`limits.minFreeDiskBytes`), or new sessions and uploads
  are refused with 507.
- The per-address session limit reads `CF-Connecting-IP`, which only Cloudflare sets. Without
  the tunnel only the per-link limit applies.

## To check in a browser

Covered by unit tests but not yet by Playwright:

- Tab order during a general comment (the stage and controls are `inert`).
- The video error overlay and the loading spinner over the tunnel.
- Scrolling back from the end screen starts listening on the frame the drag settles on.
- Closing the tab mid-comment, reopening the link, and seeing the comment in the export.
