// The page the server's headless browser opens to draw stills of a Talkie film. It holds the
// player's engine and nothing else: no controls and no sound. `build.ts` bundles this file with
// esbuild into dist/main.js; `lib/media/talkie-browser.ts` drives it.
import { sceneAt } from '@talkie/format';
import { setWasmUrl, TalkieEngine } from '@talkie/player';

declare global {
  interface Window {
    /** Settles when the film has loaded: null, or the reason it could not be opened. */
    talkieReady?: Promise<string | null>;
    /** Draws film time `t` (seconds) on a stage of exactly `width` by `height` CSS pixels. */
    renderAt?: (t: number, width: number, height: number) => Promise<void>;
  }
}

const stage = document.getElementById('stage') as HTMLElement;
setWasmUrl(new URL('page/dotlottie-player.wasm', location.href).href);

const engine = new TalkieEngine({ container: stage });
engine.muted = true;

const failed: string[] = [];
engine.addEventListener('scenewarning', (event) => {
  const { sceneId, error } = (event as CustomEvent<{ sceneId: string; error?: unknown }>).detail;
  const cause = (error as { details?: { message?: unknown } } | undefined)?.details?.message;
  failed.push(
    `scene ${sceneId} could not be drawn${typeof cause === 'string' ? `: ${cause}` : ''}`
  );
});

const nextPaint = (): Promise<void> =>
  new Promise((done) => {
    requestAnimationFrame(() => done());
  });

/** The size and scene last drawn. A change in either means the canvas has to settle again. */
let settled = '';

window.talkieReady = engine.load(new URL('film/', location.href).href).then(
  () => null,
  (error: unknown) => String((error as Error | undefined)?.message ?? error)
);

window.renderAt = async (t, width, height) => {
  const film = engine.film;
  if (!film) throw new Error('the film is not loaded');
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  failed.length = 0;
  await engine.renderAt(t);
  // A canvas takes its size a moment after its scene loads or its box changes: wait for that,
  // then draw again. Later frames of the same scene at the same size skip the wait.
  const key = `${width}x${height}:${sceneAt(film, t).index}`;
  if (key !== settled) {
    await nextPaint();
    await nextPaint();
    engine.resize();
    await engine.renderAt(t);
    settled = key;
  }
  const problem = failed[0];
  if (problem !== undefined) {
    settled = '';
    throw new Error(problem);
  }
  await nextPaint();
};
