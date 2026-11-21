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
