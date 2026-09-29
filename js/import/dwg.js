// DWG / DXF import. Parsing uses LibreDWG compiled to WebAssembly (@mlightcad/libredwg-web),
// loaded from the jsDelivr CDN on first use. The parsed database is flattened into the
// app's neutral "drawing" format (see drawing.js): block references are exploded with their
// transforms, y is flipped so +y runs down the sheet, and every symbol insert is recorded
// by name so doors, fixtures and electrical symbols can be recognised later.
import { newDrawing, pushSeg, pushArc, pushText, finishDrawing } from './drawing.js';

const LIBREDWG = 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.14';
let libPromise = null;

export function loadLibreDwg() {
  if (!libPromise) {
    libPromise = import(/* @vite-ignore */ `${LIBREDWG}/dist/libredwg-web.js`)
      .then(m => m.LibreDwg.create(`${LIBREDWG}/wasm`).then(lib => ({ lib, Dwg_File_Type: m.Dwg_File_Type })));
  }
  return libPromise;
}

export async function readCad(buffer, ext, lib = null) {
  const L = lib || await loadLibreDwg();
  const type = ext === 'dxf' ? L.Dwg_File_Type.DXF : L.Dwg_File_Type.DWG;
  const dwg = L.lib.dwg_read_data(buffer, type);
  if (!dwg) throw new Error('This CAD file could not be read. Try saving it as DWG 2018 or DXF.');
  const db = L.lib.convert(dwg);
  try { L.lib.dwg_free(dwg); } catch (e) { /* ignore */ }
  return dwgToDrawing(db);
}

const UNIT_MM = { 0: 1, 1: 25.4, 2: 304.8, 3: 1609344, 4: 1, 5: 10, 6: 1000, 7: 1e6, 8: 0.0000254, 9: 0.0254, 10: 914.4, 14: 100, 15: 10000 };

// Strip MTEXT formatting codes (\P paragraph, {\f...;}, \H, \W, \p..., %%u etc.)
export function cleanMText(s) {
  if (!s) return '';
  return String(s)
    .replace(/\\P/g, '\n')
    .replace(/\\[fFHWQTACpLlOoKk][^;\\{}]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\S([^;]*)\^([^;]*);/g, '$1/$2')
    .replace(/\\~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/%%[uUoO]/g, '')
    .replace(/%%[dD]/g, '°').replace(/%%[cC]/g, 'Ø').replace(/%%[pP]/g, '±')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

// 2D affine: [a, b, c, d, e, f] maps (x, y) → (a x + c y + e, b x + d y + f)
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const det = m => m[0] * m[3] - m[1] * m[2];

export function dwgToDrawing(db) {
  const hdr = db.header || {};
  const unitMm = UNIT_MM[hdr.INSUNITS] ?? 1;
  const d = newDrawing('cad');
  d.unitToMm = unitMm; // drawing units → mm (before any plot scale)
  d.meta.insunits = hdr.INSUNITS;

  const layers = new Map();
  for (const l of db.tables?.LAYER?.entries || []) layers.set(l.name, l);
  const layerOff = name => {
    const l = layers.get(name);
    if (!l) return false;
    return !!(l.off || l.frozen || (l.standardFlags & 1) || l.colorIndex < 0 || l.isVisible === false);
  };
  const blocks = new Map();
  let modelHandle = null;
  for (const b of db.tables?.BLOCK_RECORD?.entries || []) {
    blocks.set(b.name, b);
    if (/^\*model_space$/i.test(b.name)) modelHandle = b.handle;
  }

  // Flip y so +y points down the sheet (matches PDF and the 3D model's plan axes)
  const FLIP = [1, 0, 0, -1, 0, 0];
  let symbolId = 0;

  const walk = (entities, M, depth, ctx) => {
    for (let e of entities) {
      if (!e || e.isVisible === false) continue;
      const layer = e.layer === '0' && ctx.layer ? ctx.layer : e.layer;
      if (layerOff(e.layer)) continue;
      // OCS mirror (extrusion 0,0,-1)
      let Me = M;
      if (e.extrusionDirection && e.extrusionDirection.z < -0.5 && e.type !== 'INSERT') Me = mul(M, [-1, 0, 0, 1, 0, 0]);
      const lw = e.lineweight > 0 ? e.lineweight / 100 : 0.25; // mm
      const dashed = !!(e.lineType && /dash|hidden|center|dot/i.test(e.lineType));
      const base = { l: layer, w: lw, dash: dashed, blk: ctx.blk, sym: ctx.sym };
      switch (e.type) {
        case 'LINE': {
          const a = ap(Me, e.startPoint.x, e.startPoint.y), b = ap(Me, e.endPoint.x, e.endPoint.y);
          pushSeg(d, a[0], a[1], b[0], b[1], base);
          break;
        }
        case 'LWPOLYLINE':
        case 'POLYLINE2D':
        case 'POLYLINE': {
          const vs = e.vertices || [];
          const closed = !!((e.flag ?? e.flags ?? 0) & 1);
          const n = vs.length;
          for (let i = 0; i < (closed ? n : n - 1); i++) {
            const p = vs[i], q = vs[(i + 1) % n];
            if (!q) break;
            polyEdge(d, Me, p, q, p.bulge || 0, base);
          }
          if (closed && n >= 3) d.polys.push({ pts: vs.map(v => ap(Me, v.x, v.y)), ...base });
          break;
        }
        case 'ARC': {
          arcTo(d, Me, e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle, base);
          break;
        }
        case 'CIRCLE': {
          const c = ap(Me, e.center.x, e.center.y), r = e.radius * Math.sqrt(Math.abs(det(Me)));
          d.circles.push({ x: c[0], y: c[1], r, ...base });
          break;
        }
        case 'ELLIPSE': {
          const c = e.center, mj = e.majorAxisEndPoint, ratio = e.axisRatio;
          let t0 = e.startAngle ?? 0, t1 = e.endAngle ?? Math.PI * 2;
          if (t1 < t0) t1 += Math.PI * 2;
          const n = Math.max(8, Math.ceil((t1 - t0) / 0.2));
          let prev = null;
          for (let i = 0; i <= n; i++) {
            const t = t0 + (t1 - t0) * i / n;
            const x = c.x + mj.x * Math.cos(t) - mj.y * ratio * Math.sin(t);
            const y = c.y + mj.y * Math.cos(t) + mj.x * ratio * Math.sin(t);
            const p = ap(Me, x, y);
            if (prev) pushSeg(d, prev[0], prev[1], p[0], p[1], { ...base, curve: 1 });
            prev = p;
          }
          break;
        }
        case 'SPLINE': {
          const pts = (e.fitPoints && e.fitPoints.length ? e.fitPoints : e.controlPoints) || [];
          for (let i = 0; i + 1 < pts.length; i++) {
            const a = ap(Me, pts[i].x, pts[i].y), b = ap(Me, pts[i + 1].x, pts[i + 1].y);
            pushSeg(d, a[0], a[1], b[0], b[1], { ...base, curve: 1 });
          }
          break;
        }
        case 'SOLID':
        case 'TRACE': {
          const pts = ['corner1', 'corner2', 'corner4', 'corner3'].map(k => e[k]).filter(Boolean);
          if (pts.length >= 3) d.fills.push({ pts: pts.map(p => ap(Me, p.x, p.y)), ...base });
          break;
        }
        case 'HATCH': {
          if (!e.solidFill && !/solid/i.test(e.patternName || '')) break;
          for (const path of e.boundaryPaths || []) {
            let pts = [];
            if (path.vertices) pts = path.vertices.map(v => ap(Me, v.x, v.y));
            else if (path.edges) for (const ed of path.edges) {
              if (ed.start) pts.push(ap(Me, ed.start.x, ed.start.y));
              else if (ed.center) pts.push(ap(Me, ed.center.x + ed.radius * Math.cos(ed.startAngle), ed.center.y + ed.radius * Math.sin(ed.startAngle)));
            }
            if (pts.length >= 3) d.fills.push({ pts, ...base });
          }
          break;
        }
        case 'TEXT':
        case 'ATTRIB':
        case 'ATTDEF': {
          if (e.type === 'ATTDEF') break;
          if (e.type === 'ATTRIB' && e.text && typeof e.text === 'object') e = { ...e, ...e.text };
          const txt = cleanMText(e.text);
          if (!txt) break;
          const h = e.textHeight || 100;
          const useAlign = (e.halign || e.valign) && e.endPoint;
          const p0 = (useAlign ? e.endPoint : e.startPoint) || e.startPoint || e.insertionPoint || e.alignmentPoint;
          if (!p0) break;
          const rot = e.rotation || 0;
          const w = txt.length * h * 0.62 * (e.xScale || 1);
          // approximate centre of the text box in entity space
          let ox = w / 2, oy = h / 2;
          if (useAlign) { ox = e.halign === 1 || e.halign === 4 ? 0 : e.halign === 2 ? -w / 2 : w / 2; oy = e.valign === 3 ? -h / 2 : e.valign === 2 ? 0 : e.valign === 1 ? h / 2 : h / 2; }
          const cx = p0.x + ox * Math.cos(rot) - oy * Math.sin(rot), cy = p0.y + ox * Math.sin(rot) + oy * Math.cos(rot);
          const c = ap(Me, cx, cy);
          const sc = Math.sqrt(Math.abs(det(Me)));
          pushText(d, txt, c[0], c[1], h * sc, textRot(Me, rot), { ...base, w: w * sc });
          break;
        }
        case 'MTEXT': {
          if (!e.insertionPoint) break;
          const txt = cleanMText(e.text);
          if (!txt) break;
          const h = e.textHeight || 100;
          const lines = txt.split('\n');
          const w = e.extentsWidth || Math.max(...lines.map(s => s.length)) * h * 0.62;
          const ht = e.extentsHeight || lines.length * h * 1.4;
          const ap0 = e.attachmentPoint || 1; // 1..9: TL TC TR ML MC MR BL BC BR
          const col = (ap0 - 1) % 3, row = Math.floor((ap0 - 1) / 3);
          const ox = [w / 2, 0, -w / 2][col], oy = [-ht / 2, 0, ht / 2][row];
          const rot = e.direction ? Math.atan2(e.direction.y, e.direction.x) : (e.rotation || 0);
          const p0 = e.insertionPoint;
          const cx = p0.x + ox * Math.cos(rot) - oy * Math.sin(rot), cy = p0.y + ox * Math.sin(rot) + oy * Math.cos(rot);
          const c = ap(Me, cx, cy);
          const sc = Math.sqrt(Math.abs(det(Me)));
          pushText(d, txt, c[0], c[1], h * sc, textRot(Me, rot), { ...base, w: w * sc });
          break;
        }
        case 'DIMENSION': {
          const p1 = e.subDefinitionPoint1, p2 = e.subDefinitionPoint2;
          if (p1 && p2 && e.measurement > 0) {
            const a = ap(Me, p1.x, p1.y), b = ap(Me, p2.x, p2.y);
            const dp = e.definitionPoint ? ap(Me, e.definitionPoint.x, e.definitionPoint.y) : b;
            const tp = e.textPoint ? ap(Me, e.textPoint.x, e.textPoint.y) : dp;
            d.dims.push({ a, b, dp, tp, value: e.measurement, text: cleanMText(e.text || ''), rot: e.rotationAngle || 0 });
          }
          break;
        }
        case 'MULTILEADER': {
          const txt = cleanMText(e.textContent || e.contextData?.mtext?.text || '');
          const p = e.textAnchor || e.contentBasePosition;
          if (txt && p) {
            const h = e.textHeight || 100, w = e.textWidth || txt.length * h * 0.62;
            const c = ap(Me, p.x + Math.min(w, txt.length * h * 0.62) / 2, p.y - h / 2);
            pushText(d, txt, c[0], c[1], h * Math.sqrt(Math.abs(det(Me))), 0, { ...base, leader: true });
          }
          break;
        }
        case 'INSERT': {
          const blk = blocks.get(e.name);
          if (!blk || depth > 8) break;
          const bp = blk.basePoint || { x: 0, y: 0 };
          const sx = e.xScale ?? 1, sy = e.yScale ?? 1, r = e.rotation || 0;
          const cs = Math.cos(r), sn = Math.sin(r);
          let T = [cs * sx, sn * sx, -sn * sy, cs * sy, e.insertionPoint.x, e.insertionPoint.y];
          T = mul(T, [1, 0, 0, 1, -bp.x, -bp.y]);
          if (e.extrusionDirection && e.extrusionDirection.z < -0.5) T = mul([-1, 0, 0, 1, 0, 0], T);
          const Mi = mul(M, T);
          const clean = String(e.name).replace(/^\$0\$/, '').replace(/^A\$C[0-9A-Fa-f]+$/, '');
          const isAnon = /^\*/.test(e.name) || !clean;
          const sid = ctx.sym ?? (isAnon ? null : ++symbolId);
          const start = { s: d.segs.length, a: d.arcs.length, c: d.circles.length };
          walk(blk.entities || [], Mi, depth + 1, { layer: layer, blk: ctx.blk || (isAnon ? null : clean), sym: sid });
          if (!isAnon && ctx.sym == null) {
            const o = ap(Mi, bp.x, bp.y);
            const ax = ap(Mi, bp.x + 1, bp.y);
            const bb = bboxOf(d, start);
            const sxw = Math.hypot(ax[0] - o[0], ax[1] - o[1]);
            d.symbols.push({ id: sid, name: clean, layer, x: o[0], y: o[1], rot: Math.atan2(ax[1] - o[1], ax[0] - o[0]), scale: sxw, mirrored: det(Mi) > 0, bbox: bb });
          }
          for (const at of e.attribs || []) walk([at], M, depth + 1, ctx);
          break;
        }
        default: break;
      }
    }
  };

  const model = modelHandle
    ? db.entities.filter(e => e.ownerBlockRecordSoftId === modelHandle || e.ownerBlockRecordSoftId == null)
    : db.entities;
  walk(model, FLIP, 0, { layer: null, blk: null, sym: null });
  return finishDrawing(d);
}

function textRot(M, rot) {
  const v = [Math.cos(rot), Math.sin(rot)];
  const x = M[0] * v[0] + M[2] * v[1], y = M[1] * v[0] + M[3] * v[1];
  return Math.atan2(y, x);
}

function bboxOf(d, start) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
  for (let i = start.s; i < d.segs.length; i++) { const s = d.segs[i]; add(s.x1, s.y1); add(s.x2, s.y2); }
  for (let i = start.a; i < d.arcs.length; i++) { const a = d.arcs[i]; add(a.cx - a.r, a.cy - a.r); add(a.cx + a.r, a.cy + a.r); }
  for (let i = start.c; i < d.circles.length; i++) { const c = d.circles[i]; add(c.x - c.r, c.y - c.r); add(c.x + c.r, c.y + c.r); }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

function arcTo(d, M, cx, cy, r, a0, a1, base) {
  // Arc in entity space, angles in radians CCW. Transform endpoints and keep as a true arc
  // when the transform is a similarity, otherwise tessellate.
  if (a1 < a0) a1 += Math.PI * 2;
  const sc = Math.sqrt(Math.abs(det(M)));
  const isSim = Math.abs(Math.hypot(M[0], M[1]) - Math.hypot(M[2], M[3])) < 1e-6 * Math.max(1, sc) && Math.abs(M[0] * M[2] + M[1] * M[3]) < 1e-6 * Math.max(1, sc * sc);
  const n = Math.max(2, Math.ceil((a1 - a0) / 0.15));
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; pts.push(ap(M, cx + r * Math.cos(t), cy + r * Math.sin(t))); }
  if (isSim) {
    const c = ap(M, cx, cy);
    const s = pts[0], e = pts[pts.length - 1];
    pushArc(d, c[0], c[1], r * sc, Math.atan2(s[1] - c[1], s[0] - c[0]), Math.atan2(e[1] - c[1], e[0] - c[0]), det(M) > 0, pts, base);
  } else {
    for (let i = 0; i + 1 < pts.length; i++) pushSeg(d, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], { ...base, curve: 1 });
  }
}

function polyEdge(d, M, p, q, bulge, base) {
  if (Math.abs(bulge) < 1e-9) {
    const a = ap(M, p.x, p.y), b = ap(M, q.x, q.y);
    pushSeg(d, a[0], a[1], b[0], b[1], base);
    return;
  }
  const dx = q.x - p.x, dy = q.y - p.y, c = Math.hypot(dx, dy);
  if (c < 1e-9) return;
  const theta = 4 * Math.atan(bulge);
  const r = c / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  const h = Math.sqrt(Math.max(0, r * r - c * c / 4)) * Math.sign(bulge) * (Math.abs(theta) > Math.PI ? -1 : 1);
  const cx = mx - dy / c * h, cy = my + dx / c * h;
  let a0 = Math.atan2(p.y - cy, p.x - cx), a1 = Math.atan2(q.y - cy, q.x - cx);
  if (bulge < 0) [a0, a1] = [a1, a0];
  arcTo(d, M, cx, cy, r, a0, a1, base);
}
