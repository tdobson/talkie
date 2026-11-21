export interface DevPageInput {
  title: string;
  /** The film's scenes in order, with the film time each one starts at. */
  scenes: Array<{ id: string; start: number }>;
}

/** Frame steps are one frame at the rate scenes are authored at. */
const STEP_FPS = 25;

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const STYLE = `
body { margin: 0; padding: 16px; background: #16181d; color: #e8e8e8; font: 14px/1.4 system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
talkie-player { display: block; width: 100%; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
button { font: inherit; padding: 4px 10px; border: 1px solid #555; border-radius: 4px; background: #2a2d35; color: inherit; cursor: pointer; }
button:hover { background: #3a3e48; }
button[aria-current='true'] { border-color: #9ecbff; color: #9ecbff; }
#readout { font-variant-numeric: tabular-nums; margin-left: auto; }
#problem { margin-top: 12px; padding: 8px 12px; border: 1px solid #c0392b; border-radius: 4px; white-space: pre-wrap; color: #ffb4a8; }
`;

const SCRIPT = `
const player = document.querySelector('talkie-player');
const here = new URL(location.href);
const startAt = Number(here.searchParams.get('t'));
if (startAt > 0) {
  player.setAttribute('start', String(startAt));
}
const fps = ${STEP_FPS};
const readout = document.getElementById('readout');
const problem = document.getElementById('problem');
const sceneButtons = Array.from(document.querySelectorAll('[data-seek]'));

function show() {
  const t = player.currentTime || 0;
  readout.textContent = t.toFixed(3) + ' s, frame ' + Math.round(t * fps);
  let current = null;
  for (const button of sceneButtons) {
    if (Number(button.dataset.seek) <= t) {
      current = button;
    }
  }
  for (const button of sceneButtons) {
    button.setAttribute('aria-current', String(button === current));
  }
}
for (const type of ['timeupdate', 'seeked', 'loadedmetadata', 'frame']) {
  player.addEventListener(type, show);
}
for (const button of sceneButtons) {
  button.addEventListener('click', () => {
    player.currentTime = Number(button.dataset.seek);
  });
}
for (const button of document.querySelectorAll('[data-step]')) {
  button.addEventListener('click', () => {
    player.pause();
    const frame = Math.round(player.currentTime * fps) + Number(button.dataset.step);
    player.currentTime = Math.max(0, frame / fps);
  });
}

const events = new EventSource('/events');
events.addEventListener('reload', () => {
  here.searchParams.set('t', (player.currentTime || 0).toFixed(3));
  location.replace(here);
});
events.addEventListener('problem', (event) => {
  problem.textContent = 'The build failed. Fix it and save again.\\n\\n' + JSON.parse(event.data).message;
  problem.hidden = false;
});
`;

/** The `talkie dev` page: the real player in debug mode, a scene list and frame step buttons. */
export function devPage({ title, scenes }: DevPageInput): string {
  const sceneButtons = scenes
    .map((s) => `<button type="button" data-seek="${s.start}">${escapeHtml(s.id)}</button>`)
    .join('\n      ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <talkie-player src="/film/" debug wasm-url="/dotlottie-player.wasm"></talkie-player>
  <div class="row">
    <button type="button" data-step="-1">Back one frame</button>
    <button type="button" data-step="1">Forward one frame</button>
    <span id="readout"></span>
  </div>
  <nav class="row" aria-label="Scenes">
      ${sceneButtons}
  </nav>
  <pre id="problem" hidden></pre>
</main>
<script>${SCRIPT}</script>
<script type="module" src="/talkie-player.js"></script>
</body>
</html>
`;
}
