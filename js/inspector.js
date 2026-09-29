// Property editor for a selected element (opening, wall or room). Used by the 2D review
// editor and the 3D studio; every change mutates the model and calls onChange() so the
// 3D house rebuilds instantly.
import { resolveOpening, heightsOf, wallFrame } from './viewer/build.js';
import { ROOM_TYPES } from './analyze/text.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const OPENING_TYPES = [['door', 'Hinged door'], ['slider', 'Sliding door'], ['win', 'Window'], ['garage', 'Garage door'], ['arch', 'Flat arch opening'], ['void', 'Full-height opening']];
const WIN_STYLES = [['', 'Default (from options)'], ['AAW', 'Awning'], ['ASW', 'Sliding'], ['AFW', 'Fixed'], ['ADH', 'Double hung'], ['ACW', 'Casement'], ['LOUVRE', 'Louvre']];

export function findOpening(model, id) {
  for (const w of model.walls) { const op = w.openings.find(o => o.id === id); if (op) return { w, op }; }
  return null;
}
export function nextOpeningId(w) { let n = w.openings.length + 1; while (w.openings.some(o => o.id === `${w.id}.${n}`)) n++; return `${w.id}.${n}`; }
export function nextWallId(model) { let n = model.walls.length + 1; while (model.walls.some(w => w.id === 'W' + n)) n++; return 'W' + n; }

export function addOpening(model, w, at, type = 'door', width = null) {
  const f = wallFrame(w);
  const def = { door: w.kind === 'ext' ? 920 : 870, slider: 2400, win: 1200, garage: 4800, arch: 900, void: 1200 }[type] || 900;
  let wd = Math.min(width || def, f.L1 - f.L0 - 100);
  let a = Math.round(at - wd / 2), b = a + wd;
  if (a < f.L0 + 50) { a = f.L0 + 50; b = a + wd; }
  if (b > f.L1 - 50) { b = f.L1 - 50; a = b - wd; }
  for (const o of w.openings) if (a < o.b && b > o.a) return null; // overlaps
  const op = { id: nextOpeningId(w), type, style: null, a, b, hinge: 'a', swing: 1, obscure: false, h: null, head: null, sill: null, label: null, added: true };
  w.openings.push(op);
  return op;
}

export function renderInspector(el, sel, { model, spec, onChange, onDelete, onClose }) {
  if (!sel) { el.innerHTML = '<p class="muted">Click a door, window, wall or room to edit it.</p>'; return; }
  const H = heightsOf(spec);
  const num = (id, label, value, placeholder, unit = 'mm', extra = '') => `<label class="row col">${label}<span class="inrow"><input type="number" id="${id}" value="${value ?? ''}" placeholder="${placeholder ?? ''}" step="10" ${extra}><em>${unit}</em></span></label>`;
  const sel_ = (id, label, opts, v) => `<label class="row col">${label}<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${String(k) === String(v ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  if (sel.kind === 'opening') {
    const f0 = findOpening(model, sel.id); if (!f0) { el.innerHTML = ''; return; }
    const { w, op } = f0;
    const o = resolveOpening(model, spec, H, w, op);
    const rooms = o.rooms.filter(Boolean).map(r => r.name).join(' ↔ ') || (w.kind === 'ext' ? 'outside' : '');
    const typeName = OPENING_TYPES.find(t => t[0] === op.type)?.[1] || op.type;
    let html = `<div class="ihead"><b>${typeName}</b><span>${esc(op.id)} · ${esc(rooms)}${w.kind === 'ext' ? ' · external' : ''}</span></div>`;
    if (op.label) html += `<p class="muted small">Drawing label: <code>${esc(op.label)}</code></p>`;
    html += sel_('i-type', 'Type', OPENING_TYPES, op.type);
    if (op.type === 'win') html += sel_('i-style', 'Window style', WIN_STYLES, op.style || '');
    if (op.type === 'door') html += sel_('i-style', 'Leaf', [['', 'Single'], ['double', 'Double (French)']], op.style === 'double' ? 'double' : '');
    html += num('i-width', 'Width', op.b - op.a, '', 'mm', 'min="300" max="12000"');
    html += num('i-head', op.type === 'win' ? 'Head height (top of window)' : 'Height', op.head, `${o.head} (from options)`);
    if (op.type === 'win') {
      html += num('i-h', 'Window height', op.h ?? '', `${o.head - o.sill}`);
      html += num('i-sill', 'Sill height', op.sill, `${o.sill}`);
      html += `<label class="row"><input type="checkbox" id="i-obscure" ${op.obscure ? 'checked' : ''}> Obscure glass</label>`;
    }
    if (op.type === 'door') {
      html += sel_('i-hinge', 'Hinge side', [['a', w.o === 'H' || (w.rect[2] - w.rect[0]) >= (w.rect[3] - w.rect[1]) ? 'Left / west end' : 'Top / north end'], ['b', w.o === 'H' || (w.rect[2] - w.rect[0]) >= (w.rect[3] - w.rect[1]) ? 'Right / east end' : 'Bottom / south end']], op.hinge || 'a');
      html += sel_('i-swing', 'Opens towards', [['1', (w.o === 'H') ? 'South / down the plan' : 'East / right'], ['-1', (w.o === 'H') ? 'North / up the plan' : 'West / left']], String(op.swing || 1));
    }
    html += `<div class="btnrow"><button class="btn" id="i-center">Centre in wall</button><button class="btn" id="i-reset">Reset heights</button><button class="btn danger" id="i-del">Delete</button></div>`;
    el.innerHTML = html;
    const $ = s => el.querySelector(s);
    const ch = (id, fn) => { const x = $(id); if (x) x.addEventListener(x.type === 'checkbox' || x.tagName === 'SELECT' ? 'change' : 'input', () => { fn(x); onChange('opening'); }); };
    ch('#i-type', x => { op.type = x.value; op.style = null; renderInspector(el, sel, { model, spec, onChange, onDelete, onClose }); });
    ch('#i-style', x => { op.style = x.value || null; });
    ch('#i-width', x => { const v = +x.value; if (v >= 300) { const c = (op.a + op.b) / 2; op.a = Math.round(c - v / 2); op.b = op.a + v; } });
    ch('#i-head', x => { op.head = x.value === '' ? null : +x.value; });
    ch('#i-h', x => { op.h = x.value === '' ? null : +x.value; op.sill = null; });
    ch('#i-sill', x => { op.sill = x.value === '' ? null : +x.value; });
    ch('#i-obscure', x => { op.obscure = x.checked; });
    ch('#i-hinge', x => { op.hinge = x.value; });
    ch('#i-swing', x => { op.swing = +x.value; });
    $('#i-center').onclick = () => { const f = wallFrame(w), wd = op.b - op.a, c = (f.L0 + f.L1) / 2; op.a = Math.round(c - wd / 2); op.b = op.a + wd; onChange('opening'); };
    $('#i-reset').onclick = () => { op.head = null; op.sill = null; onChange('opening'); renderInspector(el, sel, { model, spec, onChange, onDelete, onClose }); };
    $('#i-del').onclick = () => { w.openings.splice(w.openings.indexOf(op), 1); onDelete && onDelete(); onChange('opening'); };
    return;
  }
  if (sel.kind === 'wall') {
    const w = model.walls.find(q => q.id === sel.id); if (!w) { el.innerHTML = ''; return; }
    const f = wallFrame(w);
    let html = `<div class="ihead"><b>${w.kind === 'ext' ? 'External' : 'Internal'} wall</b><span>${esc(w.id)} · ${Math.round(f.L1 - f.L0)} mm long${w.inferred ? ' · added to close the envelope' : ''}</span></div>`;
    html += sel_('i-kind', 'Type', [['ext', 'External'], ['int', 'Internal']], w.kind === 'ext' ? 'ext' : 'int');
    if (w.kind === 'ext') html += sel_('i-ext', 'Outside face', f.horiz ? [['N', 'Top (north on plan)'], ['S', 'Bottom (south on plan)']] : [['W', 'Left (west on plan)'], ['E', 'Right (east on plan)']], w.ext);
    html += num('i-thick', 'Thickness', Math.round(f.T1 - f.T0), '', 'mm', 'min="50" max="600"');
    html += `<p class="muted small">Add an opening at the point you clicked:</p><div class="btnrow">${OPENING_TYPES.map(([t, l]) => `<button class="btn" data-add="${t}">+ ${l}</button>`).join('')}</div>`;
    html += `<div class="btnrow"><button class="btn danger" id="i-del">Delete wall</button></div>`;
    el.innerHTML = html;
    const $ = s => el.querySelector(s);
    $('#i-kind').onchange = e => { w.kind = e.target.value; if (w.kind === 'ext' && !w.ext) w.ext = f.horiz ? 'S' : 'E'; if (w.kind !== 'ext') w.ext = null; onChange('wall'); renderInspector(el, sel, { model, spec, onChange, onDelete, onClose }); };
    if ($('#i-ext')) $('#i-ext').onchange = e => { w.ext = e.target.value; onChange('wall'); };
    $('#i-thick').oninput = e => {
      const t = +e.target.value; if (!(t >= 50)) return;
      const r = w.rect;
      // external walls keep their outside face; internal walls keep their centre line
      if (f.horiz) { if (w.kind === 'ext' && w.ext === 'N') r[3] = r[1] + t; else if (w.kind === 'ext') r[1] = r[3] - t; else { const c = (r[1] + r[3]) / 2; r[1] = Math.round(c - t / 2); r[3] = r[1] + t; } }
      else { if (w.kind === 'ext' && w.ext === 'W') r[2] = r[0] + t; else if (w.kind === 'ext') r[0] = r[2] - t; else { const c = (r[0] + r[2]) / 2; r[0] = Math.round(c - t / 2); r[2] = r[0] + t; } }
      w.t = t; onChange('wall');
    };
    el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
      const at = sel.at ?? (f.L0 + f.L1) / 2;
      const op = addOpening(model, w, at, b.dataset.add);
      if (!op) { b.textContent = 'No room here'; return; }
      onChange('opening');
      if (onClose) onClose({ kind: 'opening', id: op.id });
    });
    $('#i-del').onclick = () => { model.walls.splice(model.walls.indexOf(w), 1); onDelete && onDelete(); onChange('wall'); };
    return;
  }
  if (sel.kind === 'room') {
    const r = model.rooms.find(q => q.id === sel.id); if (!r) { el.innerHTML = ''; return; }
    const types = [...new Set(ROOM_TYPES.map(t => t[0]))].concat(['room']);
    let html = `<div class="ihead"><b>${esc(r.name)}</b><span>${r.area ? r.area.toFixed(2) + ' m²' : ''}${r.guessed ? ' · name guessed' : ''}</span></div>`;
    html += `<label class="row col">Name<input type="text" id="i-name" value="${esc(r.name)}"></label>`;
    html += sel_('i-rtype', 'Room type (drives fit-out & floor finish)', types.map(t => [t, t[0].toUpperCase() + t.slice(1)]), r.type);
    html += num('i-ceil', 'Ceiling height', r.ceiling, `${H.ceiling} (from options)`);
    el.innerHTML = html;
    const $ = s => el.querySelector(s);
    $('#i-name').oninput = e => { r.name = e.target.value; r.guessed = false; onChange('room'); };
    $('#i-rtype').onchange = e => { r.type = e.target.value; r.outdoor = r.type === 'outdoor' || undefined; onChange('room'); };
    $('#i-ceil').oninput = e => { r.ceiling = e.target.value === '' ? null : +e.target.value; onChange('room'); };
    return;
  }
  if (sel.kind === 'roof') { el.innerHTML = '<div class="ihead"><b>Roof</b><span>Pitch, eaves, material & colours are in Options → Roof.</span></div><button class="btn" id="i-roofopts">Open roof options</button>'; el.querySelector('#i-roofopts').onclick = () => onClose && onClose('roof-options'); }
}
