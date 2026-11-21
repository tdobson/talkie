# Talkie phone checks (from the Talkie session's handover, 2026-11-21)

Purpose: (a) does iPhone Safari play WebM Opus reliably, (b) does picture stay in step with sound on a
phone CPU (desktop p99 <= 40 ms), (c) does the real player work by touch.

Setup on tragicomix (LAN 192.168.1.65), after fix/talkie-handover issues 1 and 2 land:
1. Spike pages, port 3000: cd <repo>/spike; mkdir -p media; cp ~/Videos/md-roofkit-courses/gse/chapters/g01.mp4 media/;
   serve . (needs HTTP Range).
2. Real player, port 3001: yarn build && yarn sample; mkdir /tmp/talkie-phone; copy examples/watch.html,
   packages/player/dist/talkie-player.js, examples/sample-film/dist/film -> film; copy
   node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm and add wasm-url="./dotlottie-player.wasm"
   to the <talkie-player> tag; serve on 3001.
3. Phones on home Wi-Fi; check the firewall for 3000 and 3001.

On each phone (iPhone Safari, Android Chrome; note model, OS, browser versions):
- :3000/sync.html: canPlayType for audio/webm;codecs=opus, audio/ogg;codecs=opus, audio/mp4;codecs=mp4a.40.2.
  Play ~9 min, Random seek x20, then 0.5x, 1.5x, 2x a minute each; note p50/p95/p99/max. Force ?audio=webm,
  ?audio=m4a, ?audio=ogg a minute each. Judge sync by eye and ear too (Safari's metric reads near 0 regardless).
- :3000/compare.html: drag the slider; check 18.5 to 22.5 s (rain, two water drops).
- :3001/watch.html: play, pause/resume, scrub, captions, chapter 2, speed 1.5, fullscreen, rotate, lock screen
  mid-play, airplane mode mid-play then Try again.

Record in spike/REPORT.md "Phone checks". Decisions: WebM refused -> fine (m4a fallback), note it.
WebM claimed but stutters/drifts -> Tim decides AAC first or per-platform order (packages/cli/src/build.ts ~278).
p99 > 40 ms or visibly late -> Talkie session looks at draw cost and clock before React Native.
Player action fails -> bug in packages/player with phone, OS, steps. React Native (T16, T17) waits for this.
