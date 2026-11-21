// Minimal Lottie emitter for the Talkie spike.
//
// Input: a tree of nodes (see proto/capture.mjs). A node is a group or a Bezier path with a fill
// and/or stroke, a static transform, and keyframed opacity, position, scale and trim end.
// Output: Lottie JSON at fr 60.
//
// Mapping:
//   plain art             shape layers (ty 4) of nested groups: gr > sh, st, fl, tm, tr
//   group opacity, masks  a layer of their own, so the group fades as one piece (as SVG does);
//                         a precomp (ty 0) when such groups nest
//   passthrough groups    null layers (ty 3) used as parents
//   the camera            one null layer (ty 3) that every top-level layer is parented to
//   CSS cubic-bezier      Lottie keyframe o/i handles (the same curve, exactly)
//   per-frame tweens      sampled at 60 fps, then thinned to the keyframes a straight line needs
//
// Anything that cannot be represented throws with a message. Nothing is silently approximated.
import svgpath from 'svgpath';

export const FR = 60;
const PRECOMP_OFFSET = 8192;   // precomps clip to their own box, so art is shifted well inside one
const n2 = (x) => Math.round(x * 100) / 100;
const n3 = (x) => Math.round(x * 1000) / 1000;
const sv = (k) => ({ a: 0, k });
const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
const LINEAR = { o: { x: [0.167], y: [0.167] }, i: { x: [0.833], y: [0.833] } };

// ---------------------------------------------------------------- parsing
export function parseColor(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str);
  if (!m) throw new Error(`emit: cannot read colour "${str}"`);
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
  return { rgb: p.slice(0, 3).map((v) => n3(v / 255)), a: p.length > 3 ? p[3] : 1 };
}
function parseEase(str) {
  if (str === 'linear') return [0, 0, 1, 1];
  const m = /cubic-bezier\(([^)]+)\)/.exec(str);
  if (!m) throw new Error(`emit: easing "${str}" is not a cubic-bezier`);
  return m[1].split(',').map(Number);
}
const pxList = (v) => (v === 'none' ? [] : String(v).trim().split(/\s+/).map(parseFloat));
const parseTranslate = (v) => { const p = pxList(v); return [p[0] || 0, p[1] || 0]; };
const parseScale = (v) => { const p = pxList(v); if (!p.length) return [100, 100]; return [n2(p[0] * 100), n2((p.length > 1 ? p[1] : p[0]) * 100)]; };

/** The CSS cubic-bezier timing function, for the rare track that has to be sampled. */
function bezier([x1, y1, x2, y2]) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 50; i++) { const e = X(t); if (Math.abs(e - x) < 1e-7) break; if (e < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return Y(t);
  };
}

// ---------------------------------------------------------------- keyframes
/** Thin a per-frame series of vectors to the frames a piecewise-linear curve needs. */
function thin(series, tol) {
  const keys = [0];
  const within = (a, b) => {
    for (let k = a + 1; k < b; k++) {
      const f = (k - a) / (b - a);
      for (let c = 0; c < series[a].length; c++) if (Math.abs(series[k][c] - (series[a][c] + (series[b][c] - series[a][c]) * f)) > tol[c % tol.length]) return false;
    }
    return true;
  };
  let a = 0;
  while (a < series.length - 1) {
    let b = a + 1;
    while (b + 1 < series.length && within(a, b + 1)) b++;
    keys.push(b);
    a = b;
  }
  return keys;
}
function linearKeys(frames, values) {
  if (frames.length === 1 || values.every((v) => same(v, values[0]))) return sv(values[0]);
  return { a: 1, k: frames.map((f, i) => (i < frames.length - 1 ? { t: f, s: values[i], ...LINEAR } : { t: f, s: values[i] })) };
}

/**
 * Animations on one property of one element, as a Lottie animated value. The first animation also
 * holds its "from" before it starts; each later one takes over when it starts (the runtime's fill rules).
 */
function animated(segs, conv, opFrame) {
  const k = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], nx = segs[i + 1];
    const end = s.at + s.dur;
    if (nx && nx.at < end - 1e-6) return sampled(segs, conv, opFrame);
    const [x1, y1, x2, y2] = parseEase(s.easing);
    const from = conv(s.from), to = conv(s.to);
    k.push({ t: n3(s.at * FR), s: from, o: { x: [x1], y: [y1] }, i: { x: [x2], y: [y2] } });
    if (!nx) { k.push({ t: n3(end * FR), s: to }); break; }
    const touching = nx.at - end < 1e-6;
    if (touching && same(conv(nx.from), to)) continue;      // the next keyframe is this one's end
    k.push({ t: n3(end * FR - (touching ? 0.02 : 0)), s: to, h: 1 });
  }
  return { a: 1, k };
}
function sampled(segs, conv, opFrame) {
  const ease = segs.map((s) => bezier(parseEase(s.easing)));
  const series = [];
  for (let f = 0; f <= opFrame; f++) {
    const t = f / FR;
    let j = -1;
    for (let i = 0; i < segs.length; i++) if (segs[i].at <= t) j = i;
    if (j < 0) { series.push(conv(segs[0].from)); continue; }
    const s = segs[j], p = ease[j]((t - s.at) / Math.max(1e-6, s.dur));
    const a = conv(s.from), b = conv(s.to);
    series.push(a.map((v, c) => v + (b[c] - v) * p));
  }
  const keys = thin(series, [0.2]);
  return linearKeys(keys, keys.map((f) => series[f].map(n2)));
}

// ---------------------------------------------------------------- paths
/** SVG path data to Lottie Bezier shapes (one per subpath): { v, i, o, c } with relative tangents. */
export function toBeziers(d) {
  const subs = [];
  let cur = null;
  const start = (x, y) => { cur = { v: [[x, y]], i: [[0, 0]], o: [[0, 0]], c: false }; subs.push(cur); };
  const line = (x, y) => { cur.v.push([x, y]); cur.i.push([0, 0]); cur.o.push([0, 0]); };
  svgpath(d).abs().unarc().unshort().iterate((seg, _i, x, y) => {
    const c = seg[0];
    if (c === 'M') { start(seg[1], seg[2]); return; }
    if (!cur || cur.c) start(x, y);
    if (c === 'L') line(seg[1], seg[2]);
    else if (c === 'H') line(seg[1], y);
    else if (c === 'V') line(x, seg[1]);
    else if (c === 'C') {
      cur.o[cur.o.length - 1] = [seg[1] - x, seg[2] - y];
      cur.v.push([seg[5], seg[6]]); cur.i.push([seg[3] - seg[5], seg[4] - seg[6]]); cur.o.push([0, 0]);
    } else if (c === 'Q') {
      const c1 = [x + (2 / 3) * (seg[1] - x), y + (2 / 3) * (seg[2] - y)], c2 = [seg[3] + (2 / 3) * (seg[1] - seg[3]), seg[4] + (2 / 3) * (seg[2] - seg[4])];
      cur.o[cur.o.length - 1] = [c1[0] - x, c1[1] - y];
      cur.v.push([seg[3], seg[4]]); cur.i.push([c2[0] - seg[3], c2[1] - seg[4]]); cur.o.push([0, 0]);
    } else if (c === 'Z' || c === 'z') {
      cur.c = true;
      const last = cur.v.length - 1;
      if (last > 0 && Math.abs(cur.v[last][0] - cur.v[0][0]) < 1e-6 && Math.abs(cur.v[last][1] - cur.v[0][1]) < 1e-6) {
        cur.i[0] = cur.i[last]; cur.v.pop(); cur.i.pop(); cur.o.pop();
      }
    } else throw new Error(`emit: path command ${c} is not supported`);
  });
  const r = (list) => list.map((p) => [n2(p[0]), n2(p[1])]);
  return subs.filter((s) => s.v.length > 0).map((s) => ({ i: r(s.i), o: r(s.o), v: r(s.v), c: s.c }));
}
const shiftBezier = (b, dx, dy) => ({ ...b, v: b.v.map(([x, y]) => [n2(x + dx), n2(y + dy)]) });

/** Expand run-length samples ([frame, value] at each change) to one value per frame. */
function expand(runs, frames) {
  const out = [];
  let j = 0;
  for (let f = 0; f <= frames; f++) { while (j + 1 < runs.length && runs[j + 1][0] <= f) j++; out.push(runs[j][1]); }
  return out;
}

// ---------------------------------------------------------------- transforms
function decompose([a, b, c, d, e, f]) {
  const sx = Math.hypot(a, b);
  if (Math.abs(a * c + b * d) > 1e-6 * Math.max(1, sx)) throw new Error('emit: skewed transforms are not supported');
  const sy = (a * d - b * c) / sx;
  return { p: [e, f], r: (Math.atan2(b, a) * 180) / Math.PI, s: [sx * 100, sy * 100] };
}
const IDENTITY = () => ({ a: sv([0, 0]), p: sv([0, 0]), s: sv([100, 100]), r: sv(0) });
const isIdentity = (t) => !t.p.a && !t.s.a && !t.r.a && same(t.p.k, t.a.k) && same(t.s.k, [100, 100]) && t.r.k === 0;

/** The transforms on a node, outermost first: its animated CSS translate/scale, then its transform attribute. */
function transforms(n, op) {
  const out = [];
  const track = (prop) => (n.anims || []).filter((a) => a.prop === prop).sort((a, b) => a.at - b.at);
  const tr = track('translate'), sc = track('scale');
  if (tr.length || sc.length) {
    const o = sc.length ? n.origin : [0, 0];
    if (!o) throw new Error(`emit: node ${n.id} scales but has no pivot`);
    out.push({
      a: sv(o.map(n2)),
      p: tr.length ? animated(tr, (v) => { const t = parseTranslate(v); return [n2(o[0] + t[0]), n2(o[1] + t[1])]; }, op) : sv(o.map(n2)),
      s: sc.length ? animated(sc, parseScale, op) : sv([100, 100]),
      r: sv(0),
    });
  }
  if (n.matrixSamples) {
    const series = expand(n.matrixSamples, op).map((m) => { const d = decompose(m || [1, 0, 0, 1, 0, 0]); return [d.p[0], d.p[1], d.r, d.s[0], d.s[1]]; });
    for (let f = 1; f < series.length; f++) {   // take the short way round between samples
      while (series[f][2] - series[f - 1][2] > 180) series[f][2] -= 360;
      while (series[f][2] - series[f - 1][2] < -180) series[f][2] += 360;
    }
    const keys = thin(series, [0.3, 0.3, 1, 0.5, 0.5]);
    out.push({
      a: sv([0, 0]),
      p: linearKeys(keys, keys.map((f) => [n2(series[f][0]), n2(series[f][1])])),
      r: linearKeys(keys, keys.map((f) => [n2(series[f][2])])),
      s: linearKeys(keys, keys.map((f) => [n2(series[f][3]), n2(series[f][4])])),
    });
    if (!out[out.length - 1].r.a) out[out.length - 1].r = sv(out[out.length - 1].r.k[0]);
  } else if (n.matrix) {
    const d = decompose(n.matrix);
    const t = { a: sv([0, 0]), p: sv(d.p.map(n2)), s: sv(d.s.map(n2)), r: sv(n2(d.r)) };
    if (!isIdentity(t)) out.push(t);
  }
  return out;
}
function opacityOf(n, op) {
  const tr = (n.anims || []).filter((a) => a.prop === 'opacity').sort((a, b) => a.at - b.at);
  return tr.length ? animated(tr, (v) => [n2(parseFloat(v) * 100)], op) : sv(n2(n.opacity * 100));
}

// ---------------------------------------------------------------- shapes
const CAP = { butt: 1, round: 2, square: 3 }, JOIN = { miter: 1, round: 2, bevel: 3 };
const group = (nm, it, tr, o) => ({ ty: 'gr', nm, it: [...it, { ty: 'tr', p: tr.p, a: tr.a, s: tr.s, r: tr.r, o, sk: sv(0), sa: sv(0) }] });

function fillItem(n, ctx) {
  const f = n.fill;
  if (!f.server) {
    const c = parseColor(f.color);
    return { ty: 'fl', c: sv([...c.rgb, 1]), o: sv(n2(c.a * f.opacity * 100)), r: f.rule === 'evenodd' ? 2 : 1 };
  }
  const g = f.server, b = f.bbox;
  if (g.kind !== 'linear') throw new Error(`emit: fill ${g.kind} is not supported here`);
  if (g.stops.some((s) => s.opacity !== 1)) throw new Error('emit: gradient stops with opacity are not supported');
  const pt = (x, y) => (g.units === 'userSpaceOnUse' ? [x, y] : [b.x + x * b.width, b.y + y * b.height]).map(n2);
  ctx.stats.gradients++;
  return { ty: 'gf', o: sv(n2(f.opacity * 100)), r: 1, t: 1, s: sv(pt(g.x1, g.y1)), e: sv(pt(g.x2, g.y2)), g: { p: g.stops.length, k: sv(g.stops.flatMap((s) => [s.offset, ...parseColor(s.color).rgb])) } };
}

/** A rect filled with a pattern of small tiles: the tile art once, then two repeaters (columns, rows). */
function patternItems(n, ctx) {
  const p = n.fill.server, b = n.fill.bbox;
  const cols = b.width / p.w, rows = b.height / p.h;
  if (Math.abs(cols - Math.round(cols)) > 1e-6 || Math.abs(rows - Math.round(rows)) > 1e-6 || (b.x - p.x) % p.w || (b.y - p.y) % p.h) throw new Error('emit: a pattern must tile its rect exactly (there is no clip to hide a part tile)');
  const rep = (count, dx, dy) => ({ ty: 'rp', nm: 'repeat', c: sv(Math.round(count)), o: sv(0), m: 1, tr: { ty: 'tr', p: sv([dx, dy]), a: sv([0, 0]), s: sv([100, 100]), r: sv(0), so: sv(100), eo: sv(100) } });
  const tiles = [...p.tiles].reverse().flatMap((t) => items(t, ctx));
  const at = { ...IDENTITY(), p: sv([n2(b.x), n2(b.y)]) };
  ctx.stats.repeaters += 2;
  return [group('pattern rows', [group('pattern row', [...tiles, rep(cols, p.w, 0)], IDENTITY(), sv(100)), rep(rows, 0, p.h)], at, sv(100))];
}

function leafItems(n, ctx) {
  if (n.fill && n.fill.server && n.fill.server.kind === 'pattern') return patternItems(n, ctx);
  let shapes;
  if (n.dSamples) {
    // a path redrawn every frame by a tween: shape keyframes (same vertex count throughout)
    const series = expand(n.dSamples, ctx.op).map((d) => { const b = toBeziers(d || 'M0 0'); if (b.length !== 1 || b[0].i.flat().some(Boolean)) throw new Error('emit: a tweened path must be one polyline'); return b[0].v.flat(); });
    if (series.some((s) => s.length !== series[0].length)) throw new Error('emit: a tweened path changed its vertex count');
    const keys = thin(series, [0.3]);
    const zeros = series[0].length / 2;
    const shape = (f) => { const v = []; for (let i = 0; i < series[f].length; i += 2) v.push([n2(series[f][i]), n2(series[f][i + 1])]); return { i: Array.from({ length: zeros }, () => [0, 0]), o: Array.from({ length: zeros }, () => [0, 0]), v, c: false }; };
    shapes = [{ ty: 'sh', ks: { a: 1, k: keys.map((f, i) => (i < keys.length - 1 ? { t: f, s: [shape(f)], ...LINEAR } : { t: f, s: [shape(f)] })) } }];
    ctx.stats.shapeKeyframes += keys.length;
  } else shapes = toBeziers(n.d).map((b) => ({ ty: 'sh', ks: sv(b) }));
  if (!shapes.length || (!n.fill && !n.stroke)) return [];
  ctx.stats.paths += shapes.length;
  const out = [...shapes];
  let st = null;
  if (n.stroke) {
    const c = parseColor(n.stroke.color);
    st = { ty: 'st', c: sv([...c.rgb, 1]), o: sv(n2(c.a * n.stroke.opacity * 100)), w: sv(n2(n.stroke.width)), lc: CAP[n.stroke.cap] || 1, lj: JOIN[n.stroke.join] || 1, ml: n.stroke.miter || 4 };
    if (n.stroke.drawLength) {
      const len = n.stroke.drawLength;
      const tr = n.anims.filter((a) => a.prop === 'strokeDashoffset').sort((a, b) => a.at - b.at);
      out.push({ ty: 'tm', s: sv(0), e: animated(tr, (v) => [n2((1 - parseFloat(v) / len) * 100)], ctx.op), o: sv(0), m: 1 });
      ctx.stats.trims++;
    }
  }
  const fl = n.fill ? fillItem(n, ctx) : null;
  // Lottie paints the first item on top: SVG's default is the stroke over the fill.
  out.push(...(n.strokeUnder ? [fl, st] : [st, fl]).filter(Boolean));
  return out;
}

/** Shape items for a node with no isolated groups inside it. Returns an array (plain groups are flattened). */
function items(n, ctx) {
  const xfs = transforms(n, ctx.op), o = opacityOf(n, ctx.op);
  const inner = n.children ? [...n.children].reverse().flatMap((c) => items(c, ctx)) : leafItems(n, ctx);
  if (!inner.length) return [];
  const plainOpacity = !o.a && o.k === 100;
  if (n.children && !xfs.length && plainOpacity) return inner;
  if (!xfs.length) return [group(n.name || n.tag, inner, IDENTITY(), o)];
  let g = null;
  for (let i = xfs.length - 1; i >= 0; i--) g = group(n.name || n.tag, g ? [g] : inner, xfs[i], i === xfs.length - 1 ? o : sv(100));
  return [g];
}

// ---------------------------------------------------------------- layers
/** Work out which nodes need a layer of their own. Mutates and prunes the tree. */
function prepare(nodes) {
  const out = [];
  for (const n of nodes) {
    const animatedOpacity = (n.anims || []).some((a) => a.prop === 'opacity');
    if (!animatedOpacity && n.opacity === 0) continue;                 // never visible
    if (n.children) { n.children = prepare(n.children); if (!n.children.length) continue; } else if (!n.fill && !n.stroke) continue;
    n.leaves = n.children ? n.children.reduce((s, c) => s + c.leaves, 0) : 1;
    n.iso = !!n.mask || ((animatedOpacity || n.opacity < 1) && n.leaves > 1);
    n.isoInside = !!n.children && n.children.some((c) => c.iso || c.isoInside);
    out.push(n);
  }
  return out;
}

function composition(nodes, ctx, rootKs) {
  const layers = [];
  let ind = 0;
  const add = (ty, nm, ks, parent, extra = {}) => {
    const l = { ddd: 0, ind: ++ind, ty, nm, sr: 1, ks: { o: ks.o || sv(100), r: ks.r, p: ks.p, a: ks.a, s: ks.s }, ao: 0, ...extra, ip: 0, op: ctx.op, st: 0, bm: 0 };
    if (parent) l.parent = parent;
    layers.push(l);
    ctx.stats.layers++;
    return l;
  };
  const root = add(3, rootKs.nm, rootKs, 0).ind;
  const masks = (n, shift) => n.mask.flatMap((m, i) => toBeziers(m.d).map((b) => ({ inv: false, mode: i === 0 ? 'a' : m.mode, pt: sv(shiftBezier(b, shift, shift)), o: sv(100), x: sv(0), nm: `mask ${i}` })));
  const walk = (list, parent) => {
    let run = null;
    for (const n of list) {
      if (!n.iso && !n.isoInside) {
        const it = items(n, ctx);
        if (!it.length) continue;
        if (!run) run = add(4, 'art', IDENTITY(), parent, { shapes: [] });
        run.shapes.unshift(...it);
        continue;
      }
      run = null;
      const xfs = transforms(n, ctx.op);
      let par = parent;
      const nm = n.name || n.tag;
      if (!n.iso) {
        for (const xf of xfs) par = add(3, nm, xf, par).ind;
        walk(n.children, par);
        continue;
      }
      for (const xf of xfs.slice(0, -1)) par = add(3, nm, xf, par).ind;
      const ks = { ...(xfs[xfs.length - 1] || IDENTITY()), o: opacityOf(n, ctx.op) };
      let layer;
      if (n.isoInside) {
        const id = `comp_${n.id}`;
        const off = PRECOMP_OFFSET;
        ctx.assets.push({ id, nm, fr: FR, layers: composition(n.children, ctx, { ...IDENTITY(), p: sv([off, off]), nm: 'origin' }) });
        ks.a = sv([ks.a.k[0] + off, ks.a.k[1] + off]);
        layer = add(0, nm, ks, par, { refId: id, w: off * 2, h: off * 2 });
        if (n.mask) { layer.hasMask = true; layer.masksProperties = masks(n, off); }
        ctx.stats.precomps++;
      } else {
        const shapes = n.children ? [...n.children].reverse().flatMap((c) => items(c, ctx)) : leafItems(n, ctx);
        layer = add(4, nm, ks, par, { shapes: n.children ? shapes : [group(nm, shapes, IDENTITY(), sv(100))] });
        if (n.mask) { layer.hasMask = true; layer.masksProperties = masks(n, 0); }
      }
      if (n.mask) ctx.stats.masks += layer.masksProperties.length;
    }
  };
  walk(nodes, root);
  return layers.reverse();   // Lottie paints the first layer on top
}

/**
 * scene: { id, size: [w, h], duration, paper, dip: { fadeIn, fadeOut }, children: node[] }
 * opts.camera: { from, to } percent scale for a slow ease on the camera null over the whole scene.
 */
export function emitLottie(scene, opts = {}) {
  const [w, h] = scene.size;
  const op = Math.ceil(scene.duration * FR - 1e-6);
  const ctx = { op, assets: [], stats: { layers: 0, precomps: 0, masks: 0, paths: 0, trims: 0, gradients: 0, repeaters: 0, shapeKeyframes: 0 } };
  const camera = { ...IDENTITY(), a: sv([w / 2, h / 2]), p: sv([w / 2, h / 2]), nm: 'camera' };
  if (opts.camera) camera.s = { a: 1, k: [{ t: 0, s: [opts.camera.from, opts.camera.from], o: { x: [0.33], y: [0] }, i: { x: [0.2], y: [1] } }, { t: op, s: [opts.camera.to, opts.camera.to] }] };
  const layers = composition(prepare(structuredClone(scene.children)), ctx, camera);
  // the scene's dip to paper at its start and end (smoothstep, which is cubic-bezier(1/3, 0, 2/3, 1))
  const { fadeIn = 0, fadeOut = 0 } = scene.dip || {};
  if (fadeIn > 0 || fadeOut > 0) {
    const smooth = { o: { x: [0.333], y: [0] }, i: { x: [0.667], y: [1] } };
    const k = [];
    if (fadeIn > 0) k.push({ t: 0, s: [100], ...smooth }, { t: n3(fadeIn * FR), s: [0], h: 1 });
    else k.push({ t: 0, s: [0], h: 1 });
    if (fadeOut > 0) k.push({ t: n3((scene.duration - fadeOut) * FR), s: [0], ...smooth }, { t: n3(scene.duration * FR), s: [100] });
    const c = parseColor(scene.paper);
    const rect = { i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], v: [[0, 0], [w, 0], [w, h], [0, h]], c: true };
    layers.unshift({ ddd: 0, ind: layers.length + 1, ty: 4, nm: 'dip', sr: 1, ks: { o: { a: 1, k }, r: sv(0), p: sv([0, 0]), a: sv([0, 0]), s: sv([100, 100]) }, ao: 0, shapes: [group('dip', [{ ty: 'sh', ks: sv(rect) }, { ty: 'fl', c: sv([...c.rgb, 1]), o: sv(100), r: 1 }], IDENTITY(), sv(100))], ip: 0, op, st: 0, bm: 0 });
    ctx.stats.layers++;
  }
  const lottie = { v: '5.7.0', nm: scene.id, fr: FR, ip: 0, op, w, h, ddd: 0, assets: ctx.assets, layers };
  return { lottie, stats: ctx.stats };
}
