// PDF import: every page's vector content (paths, fills, curves) and text is read with
// pdf.js and converted into the neutral drawing format, in PDF points with +y down.
import { newDrawing, pushSeg, pushArc, pushText, finishDrawing } from './drawing.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build';
let pdfjsPromise = null;
export function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ `${PDFJS}/pdf.min.mjs`).then(m => {
      m.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
      return m;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(buffer, pdfjs = null) {
  const lib = pdfjs || await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true }).promise;
  return { doc, lib };
}

// Quick page summary for the page picker (text only – cheap)
export async function pageSummaries({ doc }) {
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map(it => it.str).join(' ');
    const vp = page.getViewport({ scale: 1 });
    out.push({ index: i, text, width: vp.width, height: vp.height });
  }
  return out;
}

export async function renderPageThumb({ doc }, index, maxW = 900) {
  const page = await doc.getPage(index);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = maxW / vp0.width;
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas: c, scale };
}

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function hexOf(args) {
  if (typeof args?.[0] === 'string') return args[0];
  if (args && args.length >= 3) {
    const h = v => Math.round(v > 1 ? v : v * 255).toString(16).padStart(2, '0');
    return '#' + h(args[0]) + h(args[1]) + h(args[2]);
  }
  return '#000000';
}

export async function pageToDrawing({ doc, lib }, index) {
  const page = await doc.getPage(index);
  const vp = page.getViewport({ scale: 1 });
  const d = newDrawing('pdf');
  d.unitToMm = 25.4 / 72; // paper mm per point (plot scale applied later)
  d.meta.page = index; d.meta.pageSize = [vp.width, vp.height];
  const OPS = lib.OPS;
  const ops = await page.getOperatorList();
  const base = vp.transform.slice(); // user space → viewport (y down)

  let st = { ctm: base, lw: 1, dash: false, stroke: '#000000', fill: '#000000', fillAlpha: 1 };
  const stack = [];
  const opNames = {};
  for (const [k, v] of Object.entries(OPS)) opNames[v] = k;

  // current path in viewport space: array of subpaths; each item {type:'l'|'c', pts}
  let path = [];
  let cur = null, start = null;
  const scaleOf = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

  const addPathOps = (pops, coords) => {
    let j = 0;
    for (const op of pops) {
      if (op === OPS.moveTo) { cur = ap(st.ctm, coords[j], coords[j + 1]); start = cur; j += 2; path.push({ t: 'm', p: cur }); }
      else if (op === OPS.lineTo) { const p = ap(st.ctm, coords[j], coords[j + 1]); j += 2; path.push({ t: 'l', a: cur, b: p }); cur = p; }
      else if (op === OPS.curveTo) {
        const p1 = ap(st.ctm, coords[j], coords[j + 1]), p2 = ap(st.ctm, coords[j + 2], coords[j + 3]), p3 = ap(st.ctm, coords[j + 4], coords[j + 5]); j += 6;
        path.push({ t: 'c', a: cur, c1: p1, c2: p2, b: p3 }); cur = p3;
      } else if (op === OPS.curveTo2) {
        const p2 = ap(st.ctm, coords[j], coords[j + 1]), p3 = ap(st.ctm, coords[j + 2], coords[j + 3]); j += 4;
        path.push({ t: 'c', a: cur, c1: cur, c2: p2, b: p3 }); cur = p3;
      } else if (op === OPS.curveTo3) {
        const p1 = ap(st.ctm, coords[j], coords[j + 1]), p3 = ap(st.ctm, coords[j + 2], coords[j + 3]); j += 4;
        path.push({ t: 'c', a: cur, c1: p1, c2: p3, b: p3 }); cur = p3;
      } else if (op === OPS.closePath) { if (cur && start) path.push({ t: 'l', a: cur, b: start, close: true }); cur = start; }
      else if (op === OPS.rectangle) {
        const x = coords[j], y = coords[j + 1], w = coords[j + 2], h = coords[j + 3]; j += 4;
        const p = [ap(st.ctm, x, y), ap(st.ctm, x + w, y), ap(st.ctm, x + w, y + h), ap(st.ctm, x, y + h)];
        path.push({ t: 'm', p: p[0] });
        for (let i = 0; i < 4; i++) path.push({ t: 'l', a: p[i], b: p[(i + 1) % 4], close: i === 3 });
        cur = start = p[0];
      }
    }
  };

  const flush = (stroke, fill) => {
    if (!path.length) return;
    const lwPt = st.lw * scaleOf(st.ctm);
    const o = { w: lwPt * 25.4 / 72, dash: st.dash, col: stroke ? st.stroke : st.fill };
    if (stroke) {
      for (const it of path) {
        if (it.t === 'l') pushSeg(d, it.a[0], it.a[1], it.b[0], it.b[1], o);
        else if (it.t === 'c') curve(d, it, o);
      }
    }
    if (fill) {
      // each subpath becomes a fill polygon
      let poly = [];
      const done = () => { if (poly.length >= 3) d.fills.push({ pts: poly, col: st.fill, alpha: st.fillAlpha }); poly = []; };
      for (const it of path) {
        if (it.t === 'm') { done(); poly.push(it.p); }
        else if (it.t === 'l') { if (!poly.length) poly.push(it.a); poly.push(it.b); }
        else if (it.t === 'c') { if (!poly.length) poly.push(it.a); for (let k = 1; k <= 4; k++) poly.push(bez(it, k / 4)); }
      }
      done();
      // Filled shapes without a stroke still carry edges that matter (hatched wall poche)
      if (!stroke) for (const it of path) if (it.t === 'l') pushSeg(d, it.a[0], it.a[1], it.b[0], it.b[1], { ...o, fillEdge: 1 });
    }
    path = [];
  };

  const { fnArray, argsArray } = ops;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    switch (fn) {
      case OPS.save: stack.push({ ...st }); break;
      case OPS.restore: if (stack.length) st = stack.pop(); break;
      case OPS.transform: st.ctm = mul(st.ctm, args); break;
      case OPS.paintFormXObjectBegin: stack.push({ ...st }); if (args[0]) st.ctm = mul(st.ctm, args[0]); break;
      case OPS.paintFormXObjectEnd: if (stack.length) st = stack.pop(); break;
      case OPS.setLineWidth: st.lw = args[0]; break;
      case OPS.setDash: st.dash = !!(args[0] && args[0].length && args[0].some(v => v > 0)); break;
      case OPS.setStrokeRGBColor: case OPS.setStrokeColor: case OPS.setStrokeGray: case OPS.setStrokeCMYKColor: st.stroke = hexOf(args); break;
      case OPS.setFillRGBColor: case OPS.setFillColor: case OPS.setFillGray: case OPS.setFillCMYKColor: st.fill = hexOf(args); break;
      case OPS.setGState: {
        for (const [k, v] of args[0] || []) {
          if (k === 'LW') st.lw = v;
          if (k === 'ca') st.fillAlpha = v;
          if (k === 'D') st.dash = !!(v && v[0] && v[0].length);
        }
        break;
      }
      case OPS.constructPath: addPathOps(args[0], args[1]); break;
      case OPS.stroke: case OPS.closeStroke: flush(true, false); break;
      case OPS.fill: case OPS.eoFill: flush(false, true); break;
      case OPS.fillStroke: case OPS.eoFillStroke: case OPS.closeFillStroke: case OPS.closeEOFillStroke: flush(true, true); break;
      case OPS.endPath: path = []; break;
      default: break;
    }
  }

  // Text – merge the glyph runs pdf.js returns into words/lines
  const tc = await page.getTextContent();
  const runs = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) { if (it.str === ' ' && runs.length) runs[runs.length - 1].space = true; continue; }
    const m = mul(base, it.transform);
    const h = Math.hypot(m[2], m[3]);
    const rot = Math.atan2(m[1], m[0]);
    const w = it.width * (Math.hypot(m[0], m[1]) / Math.max(1e-9, Math.hypot(it.transform[0], it.transform[1])));
    runs.push({ s: it.str, x: m[4], y: m[5], h, rot, w });
  }
  const merged = mergeRuns(runs);
  for (const r of merged) {
    const cx = r.x + Math.cos(r.rot) * r.w / 2 + Math.sin(r.rot) * r.h * 0.35;
    const cy = r.y + Math.sin(r.rot) * r.w / 2 - Math.cos(r.rot) * r.h * 0.35;
    pushText(d, r.s.trim(), cx, cy, r.h, r.rot, { w: r.w });
  }
  return finishDrawing(d);
}

function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    const p = out[out.length - 1];
    if (p && Math.abs(p.rot - r.rot) < 0.02 && Math.abs(p.h - r.h) < p.h * 0.2) {
      // distance along baseline direction from end of p to start of r
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      const ex = p.x + c * p.w, ey = p.y + s * p.w;
      const along = (r.x - ex) * c + (r.y - ey) * s;
      const perp = -(r.x - p.x) * s + (r.y - p.y) * c;
      if (Math.abs(perp) < p.h * 0.3 && along > -p.h * 0.5 && along < p.h * 0.45) {
        p.s += (p.space || along > p.h * 0.2 ? ' ' : '') + r.s;
        p.w = (r.x - p.x) * c + (r.y - p.y) * s + r.w;
        p.space = r.space;
        continue;
      }
    }
    out.push({ ...r });
  }
  return out;
}

function bez(it, t) {
  const u = 1 - t;
  return [
    u * u * u * it.a[0] + 3 * u * u * t * it.c1[0] + 3 * u * t * t * it.c2[0] + t * t * t * it.b[0],
    u * u * u * it.a[1] + 3 * u * u * t * it.c1[1] + 3 * u * t * t * it.c2[1] + t * t * t * it.b[1],
  ];
}

// Bezier → circular arc (door swings, bath ends…) when it fits a circle, else a polyline.
function curve(d, it, o) {
  const pts = [];
  for (let k = 0; k <= 8; k++) pts.push(bez(it, k / 8));
  const c = circleFrom3(pts[0], pts[4], pts[8]);
  if (c && c.r > 0) {
    let maxErr = 0;
    for (const p of pts) maxErr = Math.max(maxErr, Math.abs(Math.hypot(p[0] - c.x, p[1] - c.y) - c.r));
    if (maxErr < Math.max(0.05, c.r * 0.01)) {
      const a0 = Math.atan2(pts[0][1] - c.y, pts[0][0] - c.x), a1 = Math.atan2(pts[8][1] - c.y, pts[8][0] - c.x);
      const am = Math.atan2(pts[4][1] - c.y, pts[4][0] - c.x);
      const ccw = normA(am - a0) < normA(a1 - a0);
      pushArc(d, c.x, c.y, c.r, a0, a1, ccw, pts, o);
      return;
    }
  }
  for (let k = 0; k < 8; k++) pushSeg(d, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], { ...o, curve: 1 });
}
const normA = a => { a %= Math.PI * 2; return a < 0 ? a + Math.PI * 2 : a; };

function circleFrom3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], c2 = c[0] * c[0] + c[1] * c[1];
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { x, y, r: Math.hypot(a[0] - x, a[1] - y) };
}
