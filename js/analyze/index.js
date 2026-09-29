// Orchestration: find the plan views in a drawing, pick the floor plan, work out the scale,
// run the recogniser and return a normalised building model (mm, origin at the building's
// top-left, +x right, +y down the sheet).
import { transformDrawing, cropDrawing } from '../import/drawing.js';
import { analyzePlan } from './plan.js';
import { roomTypeOf, specHints, scalesInText, STATE_LOC, symbolTypeOf } from './text.js';
import { dominantAngle, wallCandidates, pieceRect } from './walls.js';

// Convert a raw drawing to millimetres. PDF: paper points × plot scale.
export function toMM(d, denom = 100) {
  const s = d.kind === 'pdf' ? (25.4 / 72) * denom : (d.unitToMm || 1);
  const out = transformDrawing(d, { s });
  out.meta = { ...d.meta, mmPerUnit: s, denom: d.kind === 'pdf' ? denom : null };
  return out;
}

export function guessPdfScale(d, pageText = '') {
  const found = scalesInText(d.texts.map(t => t.t).concat(pageText ? [pageText] : []));
  if (!found.length) return { denom: 100, why: 'no scale printed on the sheet – assumed 1:100' };
  const cnt = {};
  for (const f of found) cnt[f.denom] = (cnt[f.denom] || 0) + 1;
  // floor plans are usually 1:100 or 1:50; prefer those if present
  const pref = [100, 50, 75, 200].find(v => cnt[v]);
  const denom = pref || +Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
  return { denom, why: `"1:${denom}" printed on the sheet` };
}

const ROLE = [
  ['electrical', /ELECTRI/i], ['plumbing', /PLUMB|DRAINAGE|HYDRAULIC/i], ['footing', /FOOTING|SLAB|FOUNDATION/i],
  ['frame', /FRAME|TIMBER/i], ['roof', /ROOF/i], ['site', /SITE/i], ['floor', /FLOOR\s*PLAN|GROUND\s*FLOOR|PLAN/i],
];

// Clusters of room names = plan views. Returns [{bbox, labels, title, role, score}] in mm.
export function findViews(dmm) {
  const labs = dmm.texts.filter(t => roomTypeOf(t.t));
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < labs.length; i++) {
    if (used.has(i)) continue;
    const c = [labs[i]]; used.add(i);
    for (let k = 0; k < c.length; k++) {
      for (let j = 0; j < labs.length; j++) {
        if (used.has(j)) continue;
        if (Math.hypot(labs[j].x - c[k].x, labs[j].y - c[k].y) < 7000) { c.push(labs[j]); used.add(j); }
      }
    }
    if (c.length >= 3) clusters.push(c);
  }
  const views = clusters.map(c => {
    let bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const t of c) bb = [Math.min(bb[0], t.x), Math.min(bb[1], t.y), Math.max(bb[2], t.x), Math.max(bb[3], t.y)];
    const region = [bb[0] - 4500, bb[1] - 4500, bb[2] + 4500, bb[3] + 4500];
    // title: text containing PLAN / LAYOUT nearest to the region (below or inside)
    let title = null, best = Infinity;
    for (const t of dmm.texts) {
      if (!/PLAN|LAYOUT/i.test(t.t) || t.t.length > 60) continue;
      const cx = Math.max(region[0], Math.min(t.x, region[2])), cy = Math.max(region[1], Math.min(t.y, region[3]));
      const dist = Math.hypot(t.x - cx, t.y - cy);
      if (dist < 9000 && dist < best) { best = dist; title = t.t; }
    }
    let role = 'floor';
    if (title) for (const [r, re] of ROLE) if (re.test(title)) { role = r; break; }
    const fixtureWords = c.filter(t => !/^(W\.?C|B\.?I\.?R\.?|V|S|T)$/i.test(t.t.trim())).length;
    const score = fixtureWords + (role === 'floor' ? 25 : 0) + (title && /FLOOR/i.test(title) ? 10 : 0);
    return { bbox: region, labels: c.map(t => t.t), title, role, score };
  });
  views.sort((a, b) => b.score - a.score);
  return views;
}

// Wall-line bbox of a region, for aligning views of the same building
function wallBBox(dmm, region) {
  const c = cropDrawing(dmm, region);
  const { pieces } = wallCandidates(c);
  let bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of pieces) {
    if (p.b - p.a < 1500) continue;
    const r = pieceRect(p);
    bb = [Math.min(bb[0], r[0]), Math.min(bb[1], r[1]), Math.max(bb[2], r[2]), Math.max(bb[3], r[3])];
  }
  return bb[0] === Infinity ? null : bb;
}

export function buildModel(dmm, view, { extraViews = [], allTexts = [] } = {}) {
  const region = view.bbox;
  let d = cropDrawing(dmm, region);
  // square up a rotated plan
  const ang = dominantAngle(d.segs);
  const rot = Math.abs(ang) > 0.004 ? ang : 0;
  const cx = (region[0] + region[2]) / 2, cy = (region[1] + region[3]) / 2;
  if (rot) d = transformDrawing(d, { s: 1, ox: cx, oy: cy, rot });
  const plan = analyzePlan(d);
  if (plan.error) return { error: plan.error };

  // electrical symbols drawn on a separate "electrical layout" view of the same building
  let electrical = plan.electrical.slice();
  const ev = extraViews.find(v => v.role === 'electrical');
  if (ev && !rot) {
    const wb = ws => ws.reduce((b, w) => [Math.min(b[0], w.rect[0]), Math.min(b[1], w.rect[1]), Math.max(b[2], w.rect[2]), Math.max(b[3], w.rect[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const b0 = wb(plan.walls.filter(w => w.kind === 'ext' && !w.inferred));
    const ep = analyzePlan(cropDrawing(dmm, ev.bbox));
    const b1 = ep.error ? null : wb(ep.walls.filter(w => w.kind === 'ext' && !w.inferred));
    if (b0 && b1 && Math.abs((b0[2] - b0[0]) - (b1[2] - b1[0])) < 600 && Math.abs((b0[3] - b0[1]) - (b1[3] - b1[1])) < 600) {
      const dx = b0[0] - b1[0], dy = b0[1] - b1[1];
      const syms = dmm.symbols.filter(s => s.x >= ev.bbox[0] && s.x <= ev.bbox[2] && s.y >= ev.bbox[1] && s.y <= ev.bbox[3]);
      const moved = [];
      for (const s of syms) {
        const ty = symbolTypeOf(s.name);
        if (!ty || ty.cat !== 'elec') continue;
        const x = (s.bbox ? (s.bbox[0] + s.bbox[2]) / 2 : s.x) + dx, y = (s.bbox ? (s.bbox[1] + s.bbox[3]) / 2 : s.y) + dy;
        moved.push({ type: ty.type, gang: ty.gang, x: Math.round(x), y: Math.round(y), name: s.name });
      }
      if (moved.length > electrical.length) electrical = moved;
    }
  }

  // normalise: origin at the roof outline's top-left
  const pts = plan.outline.length ? plan.outline : plan.houseOutline;
  const ox = Math.min(...pts.map(p => p[0])), oy = Math.min(...pts.map(p => p[1]));
  const X = v => Math.round(v - ox), Y = v => Math.round(v - oy);
  const rect = r => [X(r[0]), Y(r[1]), X(r[2]), Y(r[3])];
  const walls = plan.walls.map(w => ({
    ...w, rect: rect(w.rect),
    openings: w.openings.map((o, i) => {
      const off = w.o === 'H' ? ox : oy;
      return { id: `${w.id}-o${i}`, type: o.type, style: o.style || null, a: Math.round(o.a - off), b: Math.round(o.b - off), hinge: o.hinge, swing: o.swing, obscure: o.obscure || false, h: o.h, label: o.label, head: null, sill: null };
    }),
  }));
  const model = {
    version: 1,
    walls,
    rooms: plan.rooms.map(r => ({ ...r, rects: r.rects.map(rect), label: [X(r.label[0]), Y(r.label[1])] })),
    robes: plan.robes.map(r => ({ ...r, rect: rect(r.rect) })),
    columns: plan.columns.map(c => ({ ...c, rect: rect(c.rect) })),
    beams: plan.beams.map(c => ({ ...c, rect: rect(c.rect) })),
    outline: plan.outline.map(p => [X(p[0]), Y(p[1])]),
    houseOutline: plan.houseOutline.map(p => [X(p[0]), Y(p[1])]),
    fixtures: plan.fixtures.map(f => ({ ...f, x: X(f.x), y: Y(f.y), bbox: f.bbox ? rect(f.bbox) : null })),
    electrical: electrical.map(e => ({ ...e, x: X(e.x), y: Y(e.y) })),
    source: { region, rot, origin: [ox, oy], center: [cx, cy] },
    northDeg: 0,
    notes: plan.notes,
  };
  // give walls stable, readable ids
  let n = 1;
  for (const w of model.walls) { w.id = 'W' + (n++); w.openings.forEach((o, i) => { o.id = `${w.id}.${i + 1}`; }); }
  model.hints = specHints(allTexts.length ? allTexts : dmm.texts);
  const st = model.hints['site.state']?.value;
  if (st && STATE_LOC[st]) model.location = { ...STATE_LOC[st], from: st };
  return { model, plan };
}
