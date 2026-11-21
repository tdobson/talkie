// Capture a built md-roofkit-films scene as a plain node tree (spike/scene/<id>.nodes.json).
//
// The original scene is code: scene.html calls about 3,000 lines of parametric art helpers, which
// build an SVG in the browser and register paused Web Animations plus a few per-frame tweens.
// Rather than retype that geometry by hand, this script lets the original code build its SVG once
// in headless Chromium (no frames are rendered, no screenshots taken), then reads back:
//   - every drawn element, as an absolute path with its fill, stroke and opacity
//   - every registered animation (property, from, to, start, duration, cubic-bezier easing)
//   - the attributes that the per-frame tweens change (the water drop), sampled at 60 fps
//   - text, turned into outlines with the project's font
// The result is the "list of nodes" that proto/emit.mjs turns into Lottie JSON.
//
// Anything this script does not understand (clip paths, filters, skew, unknown animated
// properties) throws. It never guesses.
//
// Usage: node proto/capture.mjs --src /path/to/md-roofkit-films --unit /path/to/units/<id>/scene.json --id g01-s01
import { chromium } from 'playwright-core';
import opentype from 'opentype.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath } from './chromium.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const SRC = path.resolve(arg('src', '/tmp/s1src/root'));
const ID = arg('id', 'g01-s01');
const UNIT = arg('unit', '/tmp/s1src/unit.json');
const OUT = path.resolve(here, '..', 'scene', `${ID}.nodes.json`);
const FR = 60;

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(SRC, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(SRC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;

const unit = JSON.parse(fs.readFileSync(UNIT, 'utf8'));
// The same config the original renderer injects (tools/render.mjs), minus the HTML overlays
// (captions, corner bug, mini map), which are the player's job in Talkie, not the scene's.
const cfg = {
  timing: { lines: unit.plan.lines, captions: unit.plan.captions, duration: unit.duration },
  film: { title: '', chapters: [] }, chapterIndex: -1, captionsPos: 'off', miniMap: false,
  defaults: { fadeIn: 0.3, fadeOut: 0.3 },
};

const browser = await chromium.launch({ executablePath: chromiumPath() });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await context.addInitScript((c) => { window.__FILM_CONFIG = c; }, cfg);
const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
await page.goto(`http://localhost:${port}/scenes/${ID}/scene.html`, { waitUntil: 'load' });
await page.evaluate(() => window.__ready);
if (problems.length) throw new Error('the original scene reported problems:\n' + problems.join('\n'));

const captured = await page.evaluate((FR) => {
  const stage = document.getElementById('stage');
  const fail = (msg, el) => { throw new Error(`capture: ${msg}${el ? ': ' + el.outerHTML.slice(0, 160) : ''}`); };
  const num = (el, a) => parseFloat(el.getAttribute(a) || '0');

  // ---- animations by element
  const anims = new Map();
  const SKIP = new Set(['offset', 'easing', 'composite', 'computedOffset']);
  for (const a of document.getAnimations()) {
    const el = a.effect.target;
    if (!stage.contains(el)) fail('animation on an element outside the stage', el);
    const kf = a.effect.getKeyframes();
    if (kf.length !== 2) fail('animation with more than two keyframes', el);
    const tm = a.effect.getTiming();
    for (const prop of Object.keys(kf[0]).filter((k) => !SKIP.has(k))) {
      if (!['opacity', 'translate', 'scale', 'strokeDashoffset'].includes(prop)) fail(`animated property ${prop} is not supported`, el);
      const list = anims.get(el) || [];
      list.push({ prop, from: kf[0][prop], to: kf[1][prop], at: tm.delay / 1000, dur: tm.duration / 1000, easing: tm.easing, fill: tm.fill });
      anims.set(el, list);
    }
  }

  // ---- geometry of basic shapes as path data
  const shapeD = (el) => {
    switch (el.tagName) {
      case 'path': return el.getAttribute('d') || '';
      case 'line': return `M${num(el, 'x1')} ${num(el, 'y1')} L${num(el, 'x2')} ${num(el, 'y2')}`;
      case 'polyline': case 'polygon': {
        const p = [...el.points].map((q, i) => `${i ? 'L' : 'M'}${q.x} ${q.y}`).join(' ');
        return el.tagName === 'polygon' ? p + ' Z' : p;
      }
      case 'circle': case 'ellipse': {
        const cx = num(el, 'cx'), cy = num(el, 'cy');
        const rx = el.tagName === 'circle' ? num(el, 'r') : num(el, 'rx'), ry = el.tagName === 'circle' ? rx : num(el, 'ry');
        return `M${cx + rx} ${cy} A${rx} ${ry} 0 1 1 ${cx - rx} ${cy} A${rx} ${ry} 0 1 1 ${cx + rx} ${cy} Z`;
      }
      case 'rect': {
        const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height');
        let rx = el.hasAttribute('rx') ? num(el, 'rx') : el.hasAttribute('ry') ? num(el, 'ry') : 0;
        let ry = el.hasAttribute('ry') ? num(el, 'ry') : rx;
        rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
        if (!rx || !ry) return `M${x} ${y} L${x + w} ${y} L${x + w} ${y + h} L${x} ${y + h} Z`;
        return `M${x + rx} ${y} L${x + w - rx} ${y} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} L${x + w} ${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} L${x + rx} ${y + h} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} L${x} ${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
      }
      default: return null;
    }
  };
  const matrixOf = (el) => {
    if (!el.transform || !el.transform.baseVal.numberOfItems) return null;
    const m = el.transform.baseVal.consolidate().matrix;
    return [m.a, m.b, m.c, m.d, m.e, m.f];
  };
  const urlId = (v) => { const m = /url\(["']?#([^"')]+)["']?\)/.exec(v || ''); return m ? m[1] : null; };

  const paintServer = (id, el) => {
    const d = document.getElementById(id);
    if (!d) fail(`paint server #${id} not found`, el);
    if (d.tagName === 'linearGradient') {
      if (d.hasAttribute('gradientTransform')) fail('gradientTransform is not supported', d);
      return {
        kind: 'linear', units: d.getAttribute('gradientUnits') || 'objectBoundingBox',
        x1: num(d, 'x1'), y1: num(d, 'y1'), x2: d.hasAttribute('x2') ? num(d, 'x2') : 1, y2: num(d, 'y2'),
        stops: [...d.querySelectorAll('stop')].map((s) => { const cs = getComputedStyle(s); return { offset: parseFloat(s.getAttribute('offset')), color: cs.stopColor, opacity: parseFloat(cs.stopOpacity) }; }),
      };
    }
    if (d.tagName === 'pattern') {
      if (d.getAttribute('patternUnits') !== 'userSpaceOnUse' || d.hasAttribute('patternTransform')) fail('only untransformed userSpaceOnUse patterns are supported', d);
      return { kind: 'pattern', w: num(d, 'width'), h: num(d, 'height'), x: num(d, 'x'), y: num(d, 'y'), tiles: [...d.children].map((c) => walk(c, true)) };
    }
    fail(`paint server ${d.tagName} is not supported`, d);
  };

  let nextId = 0;
  const byId = [];
  function walk(el, inDefs = false) {
    const tag = el.tagName;
    if (!inDefs && ['defs', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'filter', 'clipPath', 'title', 'desc'].includes(tag)) return null;
    const cs = getComputedStyle(el);
    if (!inDefs && (cs.display === 'none' || cs.visibility === 'hidden')) return null;
    if (el.hasAttribute('clip-path') || (cs.clipPath && cs.clipPath !== 'none')) fail('clip-path is not supported', el);
    if (cs.filter && cs.filter !== 'none') fail('filter is not supported', el);
    const node = { id: nextId++, tag, opacity: parseFloat(cs.opacity) };
    byId[node.id] = el;
    const name = el.getAttribute('data-art') || el.getAttribute('data-part') || el.getAttribute('data-view') || el.getAttribute('data-layer');
    if (name) node.name = name;
    const m = matrixOf(el);
    if (m) node.matrix = m;
    const an = anims.get(el);
    if (an) node.anims = an;
    if (an && m && an.some((a) => a.prop === 'translate' || a.prop === 'scale')) fail('an element has both a transform attribute and an animated transform', el);
    const maskId = urlId(el.getAttribute('mask'));
    if (maskId) {
      const mk = document.getElementById(maskId);
      node.mask = [...mk.children].map((c) => {
        const d = shapeD(c);
        if (d == null || matrixOf(c)) fail('mask content must be untransformed basic shapes', c);
        const f = getComputedStyle(c).fill.replace(/\s/g, '');
        const mode = f === 'rgb(255,255,255)' ? 'a' : f === 'rgb(0,0,0)' ? 's' : null;
        if (!mode) fail('mask shapes must be pure white (show) or pure black (hide)', c);
        return { d, mode };
      });
    }
    if (tag === 'g') {
      node.children = [...el.children].map((c) => walk(c, inDefs)).filter(Boolean);
      return node;
    }
    const paint = () => {
      const fillUrl = urlId(cs.fill);
      if (fillUrl) node.fill = { server: paintServer(fillUrl, el), opacity: parseFloat(cs.fillOpacity), bbox: (({ x, y, width, height }) => ({ x, y, width, height }))(el.getBBox()) };
      else if (cs.fill !== 'none') node.fill = { color: cs.fill, opacity: parseFloat(cs.fillOpacity), rule: cs.fillRule };
      if (urlId(cs.stroke)) fail('stroke paint servers are not supported', el);
      if (cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0) {
        node.stroke = { color: cs.stroke, opacity: parseFloat(cs.strokeOpacity), width: parseFloat(cs.strokeWidth), cap: cs.strokeLinecap, join: cs.strokeLinejoin, miter: parseFloat(cs.strokeMiterlimit) };
        if (cs.strokeDasharray !== 'none') {
          const dash = cs.strokeDasharray.split(/[ ,]+/).map(parseFloat);
          const drawOn = (an || []).some((a) => a.prop === 'strokeDashoffset');
          if (!drawOn || dash.length !== 2 || dash[0] !== dash[1]) fail('dashed strokes are only supported as a draw-on (S.draw)', el);
          node.stroke.drawLength = dash[0];
        }
      }
      if (/^stroke/.test(cs.paintOrder)) node.strokeUnder = true;
    };
    if (tag === 'text') {
      if (el.children.length) fail('text with child elements is not supported', el);
      node.text = {
        chars: [...el.textContent].map((ch, i) => { const p = el.getStartPositionOfChar(i); return { ch, x: p.x, y: p.y }; }),
        top: el.getBBox().y, size: parseFloat(cs.fontSize), weight: parseFloat(cs.fontWeight), family: cs.fontFamily, content: el.textContent,
      };
      paint();
      return node;
    }
    const d = shapeD(el);
    if (d == null) fail(`element <${tag}> is not supported`, el);
    node.d = d;
    paint();
    return node;
  }
  window.seek(0);
  const children = [...stage.children].map((c) => walk(c)).filter(Boolean);

  // ---- pivot for scale animations: the element's own box centre (transform-box: fill-box), read
  // at the moment the animation starts
  for (const [el, list] of anims) {
    const sc = list.filter((a) => a.prop === 'scale');
    if (!sc.length) continue;
    window.seek(Math.min(...sc.map((a) => a.at)) * 1000);
    const b = el.getBBox();
    const node = { origin: [b.x + b.width / 2, b.y + b.height / 2] };
    byId.forEach((e, id) => { if (e === el) node.id = id; });
    (window.__origins ||= []).push(node);
  }

  // ---- per-frame tweens: find the attributes that change over time, then sample them at 60 fps
  const frames = Math.round(window.DURATION * FR);
  const watch = byId.map((el, id) => ({ el, id })).filter((w) => w.el.hasAttribute('transform') || w.el.tagName === 'path');
  const key = (el) => (el.getAttribute('transform') || '') + '|' + (el.getAttribute('d') || '');
  window.seek(0);
  const first = watch.map((w) => key(w.el));
  const varying = new Set();
  for (let f = 0; f <= frames; f++) {
    window.seek((f / FR) * 1000);
    watch.forEach((w, i) => { if (key(w.el) !== first[i]) varying.add(i); });
  }
  const samples = [...varying].map((i) => ({ id: watch[i].id, matrix: [], d: [] }));
  for (let f = 0; f <= frames; f++) {
    window.seek((f / FR) * 1000);
    for (const s of samples) {
      const el = byId[s.id];
      s.matrix.push(matrixOf(el));
      s.d.push(el.getAttribute('d'));
    }
  }
  for (const s of samples) {
    if (s.d.every((d) => d === s.d[0])) delete s.d;
    if (s.matrix.every((m) => JSON.stringify(m) === JSON.stringify(s.matrix[0]))) delete s.matrix;
  }
  window.seek(0);
  return {
    duration: window.DURATION, children, origins: window.__origins || [], samples,
    paper: getComputedStyle(document.body).backgroundColor,
    animationCount: document.getAnimations().length,
  };
}, FR);
await browser.close();
server.close();

// ---- text to outlines (Lottie has no reliable cross-renderer text, so labels ship as shapes)
const fontFile = path.join(SRC, 'tools/fonts/WorkSans-VariableFont_wght.ttf');
const fontBuf = fs.readFileSync(fontFile);
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));
const nodesById = new Map();
(function index(list) { for (const n of list) { nodesById.set(n.id, n); if (n.children) index(n.children); } })(captured.children);
for (const n of nodesById.values()) {
  if (!n.text) continue;
  if (!/Work Sans/.test(n.text.family)) throw new Error(`capture: text in ${n.text.family} has no font file mapped`);
  font.variation.set({ wght: n.text.weight });
  // getStartPositionOfChar ignores dominant-baseline, so take the baseline from the text's box:
  // Chromium puts the top of the box one font ascent above the baseline
  const ascent = (font.tables.hhea.ascender / font.unitsPerEm) * n.text.size;
  const shift = n.text.top + ascent - n.text.chars[0].y;
  n.d = n.text.chars.filter((c) => c.ch.trim()).map((c) => font.getPath(c.ch, c.x, c.y + shift, n.text.size).toPathData(2)).join(' ');
  n.name = `text: ${n.text.content}`;
  n.tag = 'path';
  if (n.fill) n.fill.rule = 'nonzero';
  delete n.text;
}
for (const o of captured.origins) nodesById.get(o.id).origin = o.origin;
for (const s of captured.samples) {
  const n = nodesById.get(s.id);
  // run-length form: [frame, value] at each frame where the value changes
  const runs = (list) => list.map((v, f) => [f, v]).filter(([f, v]) => f === 0 || JSON.stringify(v) !== JSON.stringify(list[f - 1]));
  if (s.matrix) n.matrixSamples = runs(s.matrix);
  if (s.d) n.dSamples = runs(s.d);
}

// The scene-level dip to paper (Scene.build's fadeIn / fadeOut options in scene.html).
const html = fs.readFileSync(path.join(SRC, 'scenes', ID, 'scene.html'), 'utf8');
const opt = (k, dflt) => { const m = new RegExp(`${k}:\\s*([0-9.]+)`).exec(html.slice(html.lastIndexOf('},'))); return m ? parseFloat(m[1]) : dflt; };
const out = {
  id: ID, size: [1920, 1080], duration: captured.duration, sampleRate: FR, paper: captured.paper,
  dip: { fadeIn: opt('fadeIn', 0.3), fadeOut: opt('fadeOut', 0.3) },
  lines: Object.values(unit.plan.lines).map((l) => ({ id: l.id, start: l.start, voice: l.voice, text: l.text })),
  captions: unit.plan.captions.map((c) => ({ start: c.start, end: c.end, text: c.text })),
  source: { animations: captured.animationCount, elements: nodesById.size },
  children: captured.children,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${OUT}: ${nodesById.size} elements, ${captured.animationCount} animations, ${captured.samples.length} tween-driven elements, ${captured.duration} s`);
