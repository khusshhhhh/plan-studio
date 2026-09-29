// 2D review editor: shows what was recognised over the original drawing and lets you fix it
// – select & edit, draw walls, drop doors/windows onto walls, delete, calibrate the scale.
import { wallFrame } from './viewer/build.js';
import { addOpening, nextWallId } from './inspector.js';

const COL = { door: '#ff8a00', win: '#1aa3ff', slider: '#00b36b', garage: '#e6b800', arch: '#b04bff', void: '#ff3fb4' };

export class PlanEditor {
  constructor(canvas, { onSelect, onChange, onCalibrate } = {}) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect; this.onChange = onChange; this.onCalibrate = onCalibrate;
    this.tool = 'select'; this.sel = null; this.view = { s: 0.05, ox: 0, oy: 0 };
    this.img = null; this.showOverlay = true; this.overlayAlpha = 0.55; this.wallT = 90;
    this.drag = null; this.hover = null; this.calib = [];
    const c = canvas;
    c.addEventListener('wheel', e => { e.preventDefault(); const r = c.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const [wx, wy] = this.toW(mx, my); const f = Math.exp(-e.deltaY * 0.0015); this.view.s *= f; this.view.ox = mx - wx * this.view.s; this.view.oy = my - wy * this.view.s; this.draw(); }, { passive: false });
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('contextmenu', e => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(c.parentElement);
    window.addEventListener('keydown', e => {
      if (!this.c.isConnected || this.c.offsetParent === null) return;
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { this.deleteSel(); e.preventDefault(); }
      if (e.key === 'Escape') { this.drag = null; this.calib = []; this.setTool('select'); }
    });
  }
  load(model, overlay) {
    this.model = model;
    this.overlay = overlay;
    this.img = null;
    if (overlay) { const im = new Image(); im.onload = () => { this.img = im; this.draw(); }; im.src = overlay.url; }
    this._fitted = false; this.resize();
  }
  resize() { const p = this.c.parentElement; if (!p.clientWidth) return; this.c.width = p.clientWidth * devicePixelRatio; this.c.height = p.clientHeight * devicePixelRatio; this.c.style.width = p.clientWidth + 'px'; this.c.style.height = p.clientHeight + 'px'; if (!this._fitted) this.fit(); this.draw(); }
  fit() {
    if (!this.model || !this.c.width) return;
    const pts = this.model.outline.length ? this.model.outline : this.model.houseOutline;
    if (!pts.length) return;
    const bb = [Math.min(...pts.map(p => p[0])) - 2500, Math.min(...pts.map(p => p[1])) - 2500, Math.max(...pts.map(p => p[0])) + 2500, Math.max(...pts.map(p => p[1])) + 2500];
    const W = this.c.width / devicePixelRatio, H = this.c.height / devicePixelRatio;
    const s = Math.min(W / (bb[2] - bb[0]), H / (bb[3] - bb[1]));
    this.view = { s, ox: (W - (bb[2] - bb[0]) * s) / 2 - bb[0] * s, oy: (H - (bb[3] - bb[1]) * s) / 2 - bb[1] * s };
    this._fitted = true;
  }
  toW(mx, my) { return [(mx - this.view.ox) / this.view.s, (my - this.view.oy) / this.view.s]; }
  toS(x, y) { return [x * this.view.s + this.view.ox, y * this.view.s + this.view.oy]; }
  setTool(t) { this.tool = t; this.calib = []; this.drag = null; this.c.style.cursor = t === 'select' ? 'default' : 'crosshair'; this.draw(); this.onToolChange?.(t); }

  // ------------------------------------------------------------------ hit testing
  hit(x, y) {
    const m = this.model, tol = 6 / this.view.s;
    for (const w of m.walls) {
      const f = wallFrame(w);
      const al = f.horiz ? x : y, pc = f.horiz ? y : x;
      if (pc < f.T0 - tol || pc > f.T1 + tol || al < f.L0 - tol || al > f.L1 + tol) continue;
      for (const op of w.openings) if (al >= op.a - tol && al <= op.b + tol) return { kind: 'opening', id: op.id };
      return { kind: 'wall', id: w.id, at: al };
    }
    for (const r of m.rooms) for (const q of r.rects) if (x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]) return { kind: 'room', id: r.id };
    return null;
  }
  wallAt(x, y) { const h = this.hit(x, y); if (!h) return null; if (h.kind === 'wall') return { w: this.model.walls.find(q => q.id === h.id), at: h.at }; if (h.kind === 'opening') return null; return null; }

  down(e) {
    const r = this.c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const [x, y] = this.toW(mx, my);
    if (e.button === 1 || e.button === 2 || (this.tool === 'select' && !this.hit(x, y))) { this.drag = { pan: true, mx, my, ox: this.view.ox, oy: this.view.oy, moved: false }; this.c.setPointerCapture(e.pointerId); return; }
    if (this.tool === 'select') { this.select(this.hit(x, y)); return; }
    if (this.tool === 'wall') { const p = this.snap(x, y); this.drag = { wall: true, a: p, b: p }; this.c.setPointerCapture(e.pointerId); return; }
    if (this.tool === 'calibrate') { this.calib.push([x, y]); if (this.calib.length === 2) { const d = Math.hypot(this.calib[1][0] - this.calib[0][0], this.calib[1][1] - this.calib[0][1]); this.onCalibrate?.(d); this.setTool('select'); } this.draw(); return; }
    if (COL[this.tool]) {
      const hw = this.wallAt(x, y);
      if (!hw) { this.flash = 'Click on a wall'; this.draw(); return; }
      const op = addOpening(this.model, hw.w, Math.round(hw.at / 10) * 10, this.tool);
      if (op) { this.onChange?.('opening'); this.select({ kind: 'opening', id: op.id }); }
      return;
    }
  }
  move(e) {
    const r = this.c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (this.drag?.pan) { this.view.ox = this.drag.ox + mx - this.drag.mx; this.view.oy = this.drag.oy + my - this.drag.my; this.drag.moved = true; this.draw(); return; }
    const [x, y] = this.toW(mx, my);
    if (this.drag?.wall) { this.drag.b = this.snap(x, y); this.draw(); return; }
    this.cursor = [x, y];
    if (this.tool === 'calibrate' && this.calib.length) this.draw();
  }
  up(e) {
    if (this.drag?.pan) { const moved = this.drag.moved; this.drag = null; if (!moved && this.tool === 'select') { const r = this.c.getBoundingClientRect(); this.select(this.hit(...this.toW(e.clientX - r.left, e.clientY - r.top))); } return; }
    if (this.drag?.wall) {
      const { a, b } = this.drag; this.drag = null;
      const horiz = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
      const L = horiz ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]);
      if (L > 200) {
        const t = this.wallT;
        const rect = horiz ? [Math.min(a[0], b[0]), a[1] - t / 2, Math.max(a[0], b[0]), a[1] + t / 2] : [a[0] - t / 2, Math.min(a[1], b[1]), a[0] + t / 2, Math.max(a[1], b[1])];
        const w = { id: nextWallId(this.model), rect: rect.map(Math.round), o: horiz ? 'H' : 'V', t, kind: 'int', ext: null, openings: [], added: true };
        this.model.walls.push(w);
        this.onChange?.('wall');
        this.select({ kind: 'wall', id: w.id });
      }
      this.draw();
    }
  }
  snap(x, y) {
    // snap to wall faces / ends within 150 mm, else to 10 mm
    let sx = Math.round(x / 10) * 10, sy = Math.round(y / 10) * 10, bx = 150 / Math.max(1, this.view.s * 20), by = bx;
    for (const w of this.model.walls) for (const v of [w.rect[0], w.rect[2], (w.rect[0] + w.rect[2]) / 2]) if (Math.abs(v - x) < bx) { bx = Math.abs(v - x); sx = v; }
    for (const w of this.model.walls) for (const v of [w.rect[1], w.rect[3], (w.rect[1] + w.rect[3]) / 2]) if (Math.abs(v - y) < by) { by = Math.abs(v - y); sy = v; }
    return [sx, sy];
  }
  select(sel) { this.sel = sel; this.draw(); this.onSelect?.(sel); }
  deleteSel() {
    const s = this.sel, m = this.model; if (!s) return;
    if (s.kind === 'opening') for (const w of m.walls) { const i = w.openings.findIndex(o => o.id === s.id); if (i >= 0) w.openings.splice(i, 1); }
    if (s.kind === 'wall') { const i = m.walls.findIndex(w => w.id === s.id); if (i >= 0) m.walls.splice(i, 1); }
    this.select(null); this.onChange?.(s.kind);
  }

  // ------------------------------------------------------------------ drawing
  draw() {
    const { c, ctx: x } = this; if (!this.model || !c.width) return;
    const dpr = devicePixelRatio, s = this.view.s;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = getComputedStyle(c).getPropertyValue('--plan-bg') || '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.setTransform(dpr * s, 0, 0, dpr * s, dpr * this.view.ox, dpr * this.view.oy);
    const m = this.model;
    const px = 1 / s;
    if (this.img && this.showOverlay) { x.globalAlpha = this.overlayAlpha; const [x0, y0, x1, y1] = this.overlay.rect; x.drawImage(this.img, x0, y0, x1 - x0, y1 - y0); x.globalAlpha = 1; }
    // outline
    if (m.outline.length) { x.beginPath(); m.outline.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath(); x.setLineDash([8 * px, 5 * px]); x.strokeStyle = '#c99400'; x.lineWidth = 1.5 * px; x.stroke(); x.setLineDash([]); }
    // rooms
    const rc = { bedroom: 'rgba(120,150,255,.13)', kitchen: 'rgba(255,170,60,.16)', living: 'rgba(255,200,90,.14)', dining: 'rgba(255,200,90,.14)', bath: 'rgba(60,190,255,.16)', ensuite: 'rgba(60,190,255,.16)', wc: 'rgba(60,190,255,.16)', laundry: 'rgba(60,190,255,.16)', garage: 'rgba(130,130,130,.16)', outdoor: 'rgba(90,190,90,.16)', hall: 'rgba(200,200,160,.14)' };
    for (const r of m.rooms) { x.fillStyle = rc[r.type] || 'rgba(180,180,180,.12)'; for (const q of r.rects) x.fillRect(q[0], q[1], q[2] - q[0], q[3] - q[1]); }
    // robes, columns
    x.fillStyle = 'rgba(255,90,90,.25)'; for (const r of m.robes || []) x.fillRect(r.rect[0], r.rect[1], r.rect[2] - r.rect[0], r.rect[3] - r.rect[1]);
    x.fillStyle = '#556'; for (const cl of m.columns || []) x.fillRect(cl.rect[0], cl.rect[1], cl.rect[2] - cl.rect[0], cl.rect[3] - cl.rect[1]);
    // walls
    for (const w of m.walls) {
      const [x1, y1, x2, y2] = w.rect;
      x.fillStyle = w.kind === 'ext' ? '#202226' : '#6d737c';
      if (w.inferred) x.fillStyle = '#8a5a00';
      x.fillRect(x1, y1, x2 - x1, y2 - y1);
      const f = wallFrame(w);
      for (const op of w.openings) {
        const r = f.horiz ? [op.a, f.T0 - 15, op.b, f.T1 + 15] : [f.T0 - 15, op.a, f.T1 + 15, op.b];
        x.fillStyle = COL[op.type] || '#f0f';
        x.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
        if (op.type === 'door') { // swing arc
          const hinge = op.hinge === 'b' ? op.b : op.a, L = op.b - op.a, sw = op.swing || 1;
          const tc = sw > 0 ? f.T1 : f.T0;
          x.beginPath(); x.strokeStyle = COL.door; x.lineWidth = 1.2 * px;
          const [hx, hy] = f.horiz ? [hinge, tc] : [tc, hinge];
          const a0 = f.horiz ? (op.hinge === 'b' ? Math.PI : 0) : (op.hinge === 'b' ? -Math.PI / 2 : Math.PI / 2);
          const a1 = f.horiz ? (sw > 0 ? Math.PI / 2 : -Math.PI / 2) : (sw > 0 ? 0 : Math.PI);
          x.moveTo(hx, hy); x.arc(hx, hy, L, a0, a1, (a1 - a0 + 2 * Math.PI) % (2 * Math.PI) > Math.PI); x.stroke();
        }
      }
    }
    // selection
    const s0 = this.sel;
    if (s0) {
      x.strokeStyle = '#00a2ff'; x.lineWidth = 3 * px;
      if (s0.kind === 'wall') { const w = m.walls.find(q => q.id === s0.id); if (w) x.strokeRect(w.rect[0] - 30, w.rect[1] - 30, w.rect[2] - w.rect[0] + 60, w.rect[3] - w.rect[1] + 60); }
      if (s0.kind === 'opening') for (const w of m.walls) for (const op of w.openings) if (op.id === s0.id) { const f = wallFrame(w); const r = f.horiz ? [op.a, f.T0 - 60, op.b, f.T1 + 60] : [f.T0 - 60, op.a, f.T1 + 60, op.b]; x.strokeRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); }
      if (s0.kind === 'room') { const r = m.rooms.find(q => q.id === s0.id); if (r) for (const q of r.rects) x.strokeRect(q[0], q[1], q[2] - q[0], q[3] - q[1]); }
    }
    // labels
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (const r of m.rooms) {
      const fs = Math.max(9, Math.min(14, 13)) * px;
      x.font = `600 ${fs}px Inter, Arial`; x.fillStyle = '#0d3b66';
      x.fillText(r.name.toUpperCase(), r.label[0], r.label[1] - fs * 0.6);
      x.font = `${fs * 0.85}px Inter, Arial`; x.fillStyle = '#35516b';
      if (r.area) x.fillText(r.area.toFixed(1) + ' m²', r.label[0], r.label[1] + fs * 0.6);
    }
    // wall being drawn
    if (this.drag?.wall) {
      const { a, b } = this.drag; const horiz = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]); const t = this.wallT;
      x.fillStyle = 'rgba(0,160,255,.6)';
      if (horiz) x.fillRect(Math.min(a[0], b[0]), a[1] - t / 2, Math.abs(b[0] - a[0]), t); else x.fillRect(a[0] - t / 2, Math.min(a[1], b[1]), t, Math.abs(b[1] - a[1]));
      x.font = `${12 * px}px Inter`; x.fillStyle = '#0078c8'; x.fillText(`${Math.round(horiz ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]))} mm`, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 20 * px);
    }
    if (this.tool === 'calibrate' && this.calib.length && this.cursor) { x.strokeStyle = '#e0245e'; x.lineWidth = 2 * px; x.beginPath(); x.moveTo(...this.calib[0]); x.lineTo(...this.cursor); x.stroke(); }
    x.setTransform(1, 0, 0, 1, 0, 0);
    if (this.flash) { x.font = `${13 * dpr}px Inter`; x.fillStyle = '#e0245e'; x.fillText(this.flash, 20 * dpr, 24 * dpr); setTimeout(() => { this.flash = null; this.draw(); }, 1400); }
  }
}
