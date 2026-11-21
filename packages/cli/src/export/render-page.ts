/**
 * The page `talkie export` drives in headless Chromium. It holds the player's engine and nothing
 * else: no controls, no audio playback. The exporter calls `window.talkieExport.render(t, ...)`
 * and screenshots the page after each call.
 *
 * Served beside it: `/player/` (the built @talkie/player), `/dotlottie/` (dotlottie-web and its
 * WASM, so nothing is fetched from a CDN) and `/film/` (the film in folder form).
 */
const SCRIPT = `
import { TalkieEngine, setWasmUrl } from '/player/index.js';

setWasmUrl('/dotlottie/dotlottie-player.wasm');
const box = document.getElementById('captions');
const plate = document.getElementById('plate');
const engine = new TalkieEngine({ container: document.getElementById('stage') });
const failed = [];
engine.addEventListener('scenewarning', (event) => {
  const { sceneId, error } = event.detail;
  const cause = error && error.details && error.details.message ? ': ' + error.details.message : '';
  failed.push('scene ' + sceneId + ' could not be drawn' + cause);
});
const nextPaint = () => new Promise((done) => requestAnimationFrame(() => done()));

window.talkieExport = {
  ready: engine.load('/film/').then(
    () => null,
    (error) => String((error && error.message) || error)
  ),
  // Draw film time t. "fresh" is set on the first frame and on the first frame of each scene:
  // the canvas takes its size a moment after a scene loads, so wait for that and draw again.
  async render(t, caption, fresh) {
    await engine.renderAt(t);
    if (fresh) {
      await nextPaint();
      await nextPaint();
      engine.resize();
      await engine.renderAt(t);
    }
    if (failed.length > 0) {
      throw new Error(failed[0]);
    }
    plate.textContent = caption;
    box.hidden = caption === '';
  },
};
`;

const STYLE = `
html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
#stage { position: fixed; inset: 0; }
#captions { position: fixed; left: 5%; right: 5%; bottom: 8%; text-align: center; color: #fff; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; line-height: 1.35; }
#captions[hidden] { display: none; }
#plate { display: inline-block; padding: 0.2em 0.6em; border-radius: 4px; background: rgba(0, 0, 0, 0.78); font-size: clamp(14px, 2.6vw, 32px); white-space: pre-line; }
`;

/** The HTML of the export render page. */
export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Talkie export</title>
<style>${STYLE}</style>
<script type="importmap">
{ "imports": { "@lottiefiles/dotlottie-web": "/dotlottie/index.js" } }
</script>
</head>
<body>
<div id="stage"></div>
<div id="captions" hidden><span id="plate"></span></div>
<script type="module">${SCRIPT}</script>
</body>
</html>
`;
}
