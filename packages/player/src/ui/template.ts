const svg = (path: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${path}"/></svg>`;

/** Inline SVG icons, so the player needs no icon font and no extra requests. */
export const ICONS = {
  play: svg('M8 5v14l11-7z'),
  pause: svg('M6 5h4v14H6zM14 5h4v14h-4z'),
  replay: svg('M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z'),
  back10: svg(
    'M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8zM9.6 16H8.7v-3.3l-1 .3v-.7l1.8-.6h.1V16zm4.3-1.8c0 .6-.1 1.1-.4 1.4-.3.3-.6.5-1.1.5s-.8-.2-1.1-.5c-.3-.3-.4-.8-.4-1.4v-.8c0-.6.1-1.1.4-1.4.3-.3.6-.5 1.1-.5s.8.2 1.1.5c.3.3.4.8.4 1.4v.8zm-.9-.9c0-.4-.1-.6-.2-.8-.1-.2-.2-.2-.4-.2s-.3.1-.4.2c-.1.2-.2.4-.2.8v1c0 .4.1.7.2.8.1.2.2.2.4.2s.3-.1.4-.2c.1-.2.2-.4.2-.8v-1z'
  ),
  forward10: svg(
    'M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8zM9.6 16H8.7v-3.3l-1 .3v-.7l1.8-.6h.1V16zm4.3-1.8c0 .6-.1 1.1-.4 1.4-.3.3-.6.5-1.1.5s-.8-.2-1.1-.5c-.3-.3-.4-.8-.4-1.4v-.8c0-.6.1-1.1.4-1.4.3-.3.6-.5 1.1-.5s.8.2 1.1.5c.3.3.4.8.4 1.4v.8zm-.9-.9c0-.4-.1-.6-.2-.8-.1-.2-.2-.2-.4-.2s-.3.1-.4.2c-.1.2-.2.4-.2.8v1c0 .4.1.7.2.8.1.2.2.2.4.2s.3-.1.4-.2c.1-.2.2-.4.2-.8v-1z'
  ),
  volume: svg(
    'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z'
  ),
  muted: svg(
    'M3 9v6h4l5 5V4L7 9H3zm18.3-.9-1.4-1.4-2.4 2.4-2.4-2.4-1.4 1.4 2.4 2.4-2.4 2.4 1.4 1.4 2.4-2.4 2.4 2.4 1.4-1.4-2.4-2.4z'
  ),
  captions: svg(
    'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z'
  ),
  settings: svg(
    'M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5-2.3-1.6zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z'
  ),
  chapters: svg('M3 6h2v2H3zm4 0h14v2H7zM3 11h2v2H3zm4 0h14v2H7zM3 16h2v2H3zm4 0h14v2H7z'),
  fullscreen: svg('M5 5h6v2H7v4H5zm8 0h6v6h-2V7h-4zM5 13h2v4h4v2H5zm12 0h2v6h-6v-2h4z'),
  exitFullscreen: svg('M9 5h2v6H5V9h4zm4 0h2v4h4v2h-6zM5 13h6v6H9v-4H5zm8 0h6v2h-4v4h-2z'),
} as const;

export const CSS = `
:host {
  display: block;
  aspect-ratio: var(--talkie-aspect, 16 / 9);
  position: relative;
  background: #000;
  color: #fff;
  font-family: var(--talkie-font, system-ui, sans-serif);
  outline: none;
}
:host([hidden]) { display: none; }
:host(.talkie-fullscreen) {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  aspect-ratio: auto;
}
:host(:focus-visible) .root { box-shadow: inset 0 0 0 2px var(--talkie-accent, #228be6); }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.root {
  position: absolute;
  inset: 0;
  overflow: hidden;
  font-size: 14px;
  line-height: 1.4;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.root[data-hidden] { cursor: none; }
.stage { position: absolute; inset: 0; }
.canvases { position: absolute; inset: 0; }
.poster {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}
button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  cursor: pointer;
}
button:focus-visible, .scrubber:focus-visible, input:focus-visible {
  outline: 2px solid var(--talkie-accent, #228be6);
  outline-offset: 2px;
}
.big-play {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 72px;
  height: 72px;
  margin: -36px 0 0 -36px;
  border-radius: 50%;
  background: var(--talkie-accent, #228be6);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}
.big-play svg { width: 40px; height: 40px; }
.spinner {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 48px;
  height: 48px;
  margin: -24px 0 0 -24px;
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: talkie-spin 0.8s linear infinite;
  pointer-events: none;
}
@keyframes talkie-spin { to { transform: rotate(360deg); } }
.unmute {
  position: absolute;
  left: 12px;
  top: 12px;
  padding: 6px 12px;
  border-radius: var(--talkie-radius, 8px);
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  gap: 6px;
}
.ripple {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 33.4%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.18);
  opacity: 0;
  pointer-events: none;
}
.ripple.back { left: 0; border-radius: 0 50% 50% 0; }
.ripple.forward { right: 0; border-radius: 50% 0 0 50%; }
.ripple.on { animation: talkie-ripple 0.5s ease-out; }
@keyframes talkie-ripple { from { opacity: 1; } to { opacity: 0; } }
.captions {
  position: absolute;
  left: 5%;
  right: 5%;
  bottom: 8%;
  text-align: center;
  pointer-events: none;
  transition: bottom 0.15s;
}
.root:not([data-hidden]):not([data-controls='off']) .captions { bottom: 76px; }
.plate {
  display: inline-block;
  padding: 0.2em 0.6em;
  border-radius: calc(var(--talkie-radius, 8px) / 2);
  background: rgba(0, 0, 0, 0.78);
  font-size: calc(clamp(14px, 2.6cqw, 32px) * var(--talkie-caption-scale, 1));
  white-space: pre-line;
}
.stage { container-type: inline-size; }
.error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
  background: rgba(0, 0, 0, 0.82);
}
.error p { margin: 0; max-width: 40em; }
.retry {
  padding: 8px 16px;
  border-radius: var(--talkie-radius, 8px);
  background: var(--talkie-accent, #228be6);
}
.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 24px 12px 6px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
  transition: opacity 0.2s;
}
.root[data-hidden] .bar { opacity: 0; pointer-events: none; }
.root[data-controls='off'] .bar { display: none; }
.scrubber {
  position: relative;
  height: 16px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}
.segments { display: flex; gap: 2px; width: 100%; height: 4px; }
.scrubber:hover .segments, .scrubber[data-dragging] .segments { height: 6px; }
.segment {
  position: relative;
  min-width: 1px;
  background: rgba(255, 255, 255, 0.25);
  overflow: hidden;
}
.segment:first-child { border-radius: 3px 0 0 3px; }
.segment:last-child { border-radius: 0 3px 3px 0; }
.segment:only-child { border-radius: 3px; }
.buffered, .played { position: absolute; left: 0; top: 0; bottom: 0; width: 0; }
.buffered { background: rgba(255, 255, 255, 0.4); }
.played { background: var(--talkie-accent, #228be6); }
.thumb {
  position: absolute;
  left: 0;
  top: 50%;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  background: var(--talkie-accent, #228be6);
  pointer-events: none;
}
.preview {
  position: absolute;
  bottom: 22px;
  left: 0;
  width: 160px;
  transform: translateX(-50%);
  padding: 4px;
  border-radius: var(--talkie-radius, 8px);
  background: rgba(0, 0, 0, 0.85);
  text-align: center;
  font-size: 12px;
  pointer-events: none;
}
.preview canvas {
  display: block;
  width: 100%;
  aspect-ratio: var(--talkie-aspect, 16 / 9);
  border-radius: calc(var(--talkie-radius, 8px) / 2);
  background: #000;
}
.preview-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row { display: flex; align-items: center; gap: 4px; height: 40px; }
.row button {
  flex: none;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--talkie-radius, 8px);
}
.row button:hover { background: rgba(255, 255, 255, 0.15); }
.row button[aria-pressed='true'] { box-shadow: inset 0 -3px 0 var(--talkie-accent, #228be6); }
.volume { flex: none; width: 64px; accent-color: var(--talkie-accent, #228be6); }
.time { flex: none; padding: 0 6px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.chapter-title {
  flex: 1 1 0;
  min-width: 0;
  padding: 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}
.menu {
  position: absolute;
  right: 12px;
  bottom: 56px;
  min-width: 160px;
  max-width: 80%;
  max-height: calc(100% - 20px);
  overflow-y: auto;
  padding: 4px;
  border-radius: var(--talkie-radius, 8px);
  background: rgba(20, 20, 20, 0.95);
  display: flex;
  flex-direction: column;
}
.menu-title { padding: 6px 10px; font-size: 12px; opacity: 0.7; }
.menu button {
  padding: 8px 10px;
  text-align: left;
  border-radius: calc(var(--talkie-radius, 8px) / 2);
  display: flex;
  gap: 8px;
}
.menu button:hover { background: rgba(255, 255, 255, 0.15); }
.menu button[aria-checked='true'] { color: var(--talkie-accent, #228be6); font-weight: 600; }
.menu .item-note { margin-left: auto; opacity: 0.7; font-variant-numeric: tabular-nums; }
@media (max-width: 480px) {
  .volume, .chapter-title { display: none; }
  .time { margin-right: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .spinner { animation-duration: 2.4s; }
  .ripple.on { animation: none; }
  .bar, .captions { transition: none; }
}
`;

const button = (cls: string, label: string, icon: string, extra = '') =>
  `<button type="button" class="${cls}" part="${cls}" aria-label="${label}" ${extra}>${icon}</button>`;

export const HTML = `
<div class="root" part="root">
  <div class="stage" part="stage">
    <div class="canvases"></div>
    <img class="poster" part="poster" alt="" hidden>
    <div class="ripple back">${ICONS.back10}</div>
    <div class="ripple forward">${ICONS.forward10}</div>
    <div class="captions" part="captions" hidden><span class="plate"></span></div>
    <div class="spinner" role="status" aria-label="Loading" hidden></div>
    ${button('big-play', 'Play', ICONS.play)}
    <button type="button" class="unmute" part="unmute" aria-label="Unmute" hidden>${ICONS.muted}<span>Tap to unmute</span></button>
    <div class="error" part="error" role="alert" hidden>
      <p class="error-text"></p>
      <button type="button" class="retry" part="retry" hidden>Try again</button>
    </div>
  </div>
  <div class="bar" part="controls">
    <div class="scrubber" part="scrubber" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
      <div class="segments"></div>
      <div class="thumb"></div>
      <div class="preview" hidden>
        <canvas class="preview-canvas"></canvas>
        <div class="preview-title"></div>
        <div class="preview-time"></div>
      </div>
    </div>
    <div class="row">
      ${button('play', 'Play', ICONS.play)}
      ${button('skip-back', 'Back 10 seconds', ICONS.back10)}
      ${button('skip-forward', 'Forward 10 seconds', ICONS.forward10)}
      ${button('mute', 'Mute', ICONS.volume)}
      <input class="volume" part="volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">
      <span class="time" part="time">0:00 / 0:00</span>
      <span class="chapter-title" part="chapter-title"></span>
      ${button('captions-toggle', 'Captions', ICONS.captions, 'aria-pressed="false" hidden')}
      ${button('settings', 'Settings', ICONS.settings, 'aria-haspopup="menu" aria-expanded="false"')}
      ${button('chapters', 'Chapters', ICONS.chapters, 'aria-haspopup="menu" aria-expanded="false" hidden')}
      ${button('fullscreen', 'Full screen', ICONS.fullscreen)}
    </div>
    <div class="menu settings-menu" part="menu" role="menu" aria-label="Playback speed" hidden></div>
    <div class="menu chapters-menu" part="menu" role="menu" aria-label="Chapters" hidden></div>
  </div>
</div>
`;

export interface TemplateRefs {
  root: HTMLElement;
  stage: HTMLElement;
  canvases: HTMLElement;
  poster: HTMLImageElement;
  rippleBack: HTMLElement;
  rippleForward: HTMLElement;
  captions: HTMLElement;
  plate: HTMLElement;
  spinner: HTMLElement;
  bigPlay: HTMLButtonElement;
  unmute: HTMLButtonElement;
  error: HTMLElement;
  errorText: HTMLElement;
  retry: HTMLButtonElement;
  bar: HTMLElement;
  scrubber: HTMLElement;
  segments: HTMLElement;
  thumb: HTMLElement;
  preview: HTMLElement;
  previewCanvas: HTMLCanvasElement;
  previewTitle: HTMLElement;
  previewTime: HTMLElement;
  play: HTMLButtonElement;
  skipBack: HTMLButtonElement;
  skipForward: HTMLButtonElement;
  mute: HTMLButtonElement;
  volume: HTMLInputElement;
  time: HTMLElement;
  chapterTitle: HTMLElement;
  captionsToggle: HTMLButtonElement;
  settings: HTMLButtonElement;
  chapters: HTMLButtonElement;
  fullscreen: HTMLButtonElement;
  settingsMenu: HTMLElement;
  chaptersMenu: HTMLElement;
}

const SELECTORS: Record<keyof TemplateRefs, string> = {
  root: '.root',
  stage: '.stage',
  canvases: '.canvases',
  poster: '.poster',
  rippleBack: '.ripple.back',
  rippleForward: '.ripple.forward',
  captions: '.captions',
  plate: '.plate',
  spinner: '.spinner',
  bigPlay: '.big-play',
  unmute: '.unmute',
  error: '.error',
  errorText: '.error-text',
  retry: '.retry',
  bar: '.bar',
  scrubber: '.scrubber',
  segments: '.segments',
  thumb: '.thumb',
  preview: '.preview',
  previewCanvas: '.preview-canvas',
  previewTitle: '.preview-title',
  previewTime: '.preview-time',
  play: '.play',
  skipBack: '.skip-back',
  skipForward: '.skip-forward',
  mute: '.mute',
  volume: '.volume',
  time: '.time',
  chapterTitle: '.chapter-title',
  captionsToggle: '.captions-toggle',
  settings: '.settings',
  chapters: '.chapters',
  fullscreen: '.fullscreen',
  settingsMenu: '.settings-menu',
  chaptersMenu: '.chapters-menu',
};

/** Fill a shadow root with the player's markup and styles, and return its parts. */
export function renderTemplate(shadow: ShadowRoot): TemplateRefs {
  shadow.innerHTML = `<style>${CSS}</style>${HTML}`;
  const refs = {} as Record<string, Element>;
  for (const [name, selector] of Object.entries(SELECTORS)) {
    refs[name] = shadow.querySelector(selector)!;
  }
  return refs as unknown as TemplateRefs;
}
