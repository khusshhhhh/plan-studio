// Browser-side import pipeline: files → drawings → plan views → building model.
import { readCad } from './import/dwg.js';
import { openPdf, pageSummaries, pageToDrawing } from './import/pdf.js';
import { cropDrawing } from './import/drawing.js';
import { toMM, findViews, buildModel, guessPdfScale } from './analyze/index.js';
import { roomTypeOf } from './analyze/text.js';

const extOf = n => (n.split('.').pop() || '').toLowerCase();

// Read every file; returns candidate plan views across all of them
export async function readSources(files, log = () => {}) {
  const sources = [];
  for (const file of files) {
    const ext = extOf(file.name);
    const buf = await file.arrayBuffer();
    if (ext === 'dwg' || ext === 'dxf') {
      log(`Reading ${file.name} (CAD)… loading the DWG engine`);
      const raw = await readCad(buf, ext);
      const dmm = toMM(raw);
      const views = findViews(dmm);
      log(`${file.name}: ${raw.segs.length.toLocaleString()} lines, ${raw.symbols.length} symbols, ${views.length} plan view(s)`);
      sources.push({ name: file.name, kind: 'cad', dmm, views, texts: dmm.texts.map(t => t.t) });
    } else if (ext === 'pdf') {
      log(`Reading ${file.name} (PDF)…`);
      const pdf = await openPdf(buf);
      const pages = await pageSummaries(pdf);
      const allTexts = pages.map(p => p.text);
      const score = p => (/FLOOR\s*PLAN|GROUND\s*FLOOR/i.test(p.text) ? 20 : 0) + (p.text.match(/BED|KITCHEN|BATH|LIVING|FAMILY|GARAGE|DINING|LAUNDRY|ENS|W\.?I\.?R/gi) || []).length - (/SITE\s*PLAN|ELEVATION/i.test(p.text) ? 8 : 0);
      const ranked = pages.map(p => ({ ...p, score: score(p) })).sort((a, b) => b.score - a.score);
      const src = { name: file.name, kind: 'pdf', pdf, pages, texts: allTexts, views: [], pageDrawings: {} };
      for (const p of ranked.slice(0, 2)) {
        if (p.score <= 0 && src.views.length) break;
        log(`${file.name}: analysing page ${p.index}…`);
        const raw = await pageToDrawing(pdf, p.index);
        const sc = guessPdfScale(raw, p.text);
        const dmm = toMM(raw, sc.denom);
        src.pageDrawings[p.index] = { raw, dmm, scale: sc };
        for (const v of findViews(dmm)) src.views.push({ ...v, page: p.index, scale: sc });
      }
      log(`${file.name}: ${pages.length} pages, ${src.views.length} plan view(s)`);
      sources.push(src);
    } else {
      log(`Skipped ${file.name}: use DWG, DXF or PDF files.`);
    }
  }
  return sources;
}

export function candidates(sources) {
  const out = [];
  sources.forEach((s, si) => s.views.forEach((v, vi) => out.push({ si, vi, source: s.name, kind: s.kind, page: v.page, role: v.role, title: v.title, score: v.score + (s.kind === 'cad' ? 6 : 0), labels: v.labels })));
  return out.sort((a, b) => (b.role === 'floor') - (a.role === 'floor') || b.score - a.score);
}

export async function analyse(sources, cand, { denom = null } = {}) {
  const s = sources[cand.si];
  let dmm = s.dmm, view = s.views[cand.vi];
  if (s.kind === 'pdf') {
    const pd = s.pageDrawings[view.page];
    if (denom && denom !== pd.scale.denom) {
      const f = denom / pd.scale.denom;
      dmm = toMM(pd.raw, denom);
      view = { ...view, bbox: view.bbox.map(v => v * f) };
    } else dmm = pd.dmm;
  }
  const allTexts = sources.flatMap(x => x.texts);
  const extra = s.views.filter((v, i) => i !== cand.vi && (v.page === undefined || v.page === view.page));
  const r = buildModel(dmm, view, { extraViews: extra, allTexts: allTexts.map(t => ({ t })) });
  if (r.error) return r;
  r.overlay = renderOverlay(dmm, view.bbox, r.model);
  r.meta = { source: s.name, kind: s.kind, page: view.page, title: view.title, scale: s.kind === 'pdf' ? (denom || s.pageDrawings[view.page].scale.denom) : null, scaleWhy: s.kind === 'pdf' ? s.pageDrawings[view.page].scale.why : 'CAD units (mm)' };
  return r;
}

// Render the source drawing (the analysed region) into model coordinates as an image
export function renderOverlay(dmm, region, model) {
  const d = cropDrawing(dmm, region);
  const { rot = 0, center = [0, 0], origin = [0, 0] } = model.source || {};
  const c = Math.cos(-rot), n = Math.sin(-rot);
  const T = (x, y) => { const X = x - center[0], Y = y - center[1]; return [X * c - Y * n + center[0] - origin[0], X * n + Y * c + center[1] - origin[1]]; };
  const pts = model.outline.length ? model.outline : model.houseOutline;
  const bb = [Math.min(...pts.map(p => p[0])) - 4000, Math.min(...pts.map(p => p[1])) - 4000, Math.max(...pts.map(p => p[0])) + 4000, Math.max(...pts.map(p => p[1])) + 4000];
  const W = bb[2] - bb[0], H = bb[3] - bb[1];
  const px = Math.min(2400, Math.max(1000, Math.round(W / 12)));
  const s = px / W;
  const cv = document.createElement('canvas'); cv.width = px; cv.height = Math.round(H * s);
  const x = cv.getContext('2d');
  x.fillStyle = 'rgba(255,255,255,0.0)'; x.fillRect(0, 0, cv.width, cv.height);
  x.strokeStyle = '#1a1a1a'; x.lineCap = 'round';
  const P = (a, b) => { const [u, v] = T(a, b); return [(u - bb[0]) * s, (v - bb[1]) * s]; };
  x.beginPath();
  for (const q of d.segs) { const [a, b] = P(q.x1, q.y1), [e, f] = P(q.x2, q.y2); x.moveTo(a, b); x.lineTo(e, f); }
  for (const q of d.arcs) if (q.pts) { q.pts.forEach((p, i) => { const [a, b] = P(p[0], p[1]); if (i) x.lineTo(a, b); else x.moveTo(a, b); }); }
  x.lineWidth = Math.max(1, 12 * s); x.stroke();
  x.fillStyle = '#0b4f8a';
  for (const t of d.texts) {
    if (t.h * s < 5) continue;
    const [a, b] = P(t.x, t.y);
    x.save(); x.translate(a, b); x.rotate((t.rot || 0) - rot); x.font = `${Math.round(t.h * s)}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t.t.slice(0, 60), 0, 0); x.restore();
  }
  return { url: cv.toDataURL('image/png'), rect: bb, rot: 0 };
}

export { roomTypeOf };
