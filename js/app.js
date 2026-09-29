// Plan Studio – app controller: upload → check the plan → choose options → 3D walkthrough.
import { readSources, candidates, analyse } from './importer.js';
import { PlanEditor } from './editor2d.js';
import { renderInspector } from './inspector.js';
import { renderOptions } from './options.js';
import { defaultSpec, applyHints, GROUPS } from './spec.js';
import { saveProject, listProjects, loadProject, deleteProject, newId } from './store.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const toast = (msg, ms = 2600) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms); };
const busy = msg => { $('#busy').hidden = !msg; if (msg) $('#busyMsg').textContent = msg; };

let project = null;          // {id, name, model, spec, fromDrawing, overlay, meta}
let sources = null, cands = null;
let editor = null, studio = null, optionsUI = null;
let undo = [];

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
function setStep(step) {
  $$('#steps button').forEach(b => b.classList.toggle('active', b.dataset.step === step));
  const screen = step === 'design' || step === 'walk' ? 'studio' : step;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + screen));
  if (step === 'review') { ensureEditor(); editor.load(project.model, project.overlay); editor.resize(); refreshSummary(); }
  if (step === 'design' || step === 'walk') ensureStudio().then(() => {
    if (studio.model !== project.model) studio.load(project.model, project.spec, { overlay: project.overlay });
    if (step === 'design') { showPanel('options'); renderOpts(true); if (studio.mode === 'walk') setMode('exterior'); }
    else { renderOpts(false); setMode('walk'); }
  });
  enableSteps();
}
function enableSteps() {
  const has = !!project?.model;
  $$('#steps button').forEach(b => { b.disabled = b.dataset.step !== 'upload' && !has; });
  $('#exportBtn').disabled = !has;
}
$$('#steps button').forEach(b => b.onclick = () => setStep(b.dataset.step));

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
const drop = $('#drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); handleFiles([...e.dataTransfer.files]); });
$('#fileIn').onchange = e => handleFiles([...e.target.files]);

async function handleFiles(files) {
  if (!files.length) return;
  $('#upStatus').hidden = false;
  const log = $('#upLog'); log.textContent = '';
  const L = m => { log.textContent += m + '\n'; log.scrollTop = 1e9; };
  $('#upCands').innerHTML = '';
  busy('Reading drawings…');
  try {
    sources = await readSources(files, m => { L(m); $('#busyMsg').textContent = m; });
    cands = candidates(sources);
    if (!cands.length) { L('No floor plan was found. Make sure the files contain a floor plan with room names.'); busy(null); return; }
    renderCands();
    const name = files.map(f => f.name.replace(/\.(dwg|dxf|pdf)$/i, '')).sort((a, b) => a.length - b.length)[0];
    await runAnalysis(cands[0], name);
  } catch (e) {
    console.error(e); L('Error: ' + (e.message || e)); toast('Could not read the file: ' + (e.message || e), 5000);
  } finally { busy(null); }
}

function renderCands() {
  const el = $('#upCands');
  el.innerHTML = '<h3>Plan views found</h3>' + cands.map((c, i) => `<div class="cand"><span class="tag">${c.kind.toUpperCase()}${c.page ? ' · p' + c.page : ''}</span><b>${esc(c.title || 'Untitled view')} <span class="muted">– ${esc(c.source)}</span></b><span class="tag">${esc(c.role)}</span><span class="muted">${c.labels.length} room names</span><button class="btn ${i === 0 ? 'primary' : ''}" data-cand="${i}">${i === 0 ? 'Using this' : 'Use this'}</button></div>`).join('');
  el.querySelectorAll('[data-cand]').forEach(b => b.onclick = () => runAnalysis(cands[+b.dataset.cand], project?.name));
}

async function runAnalysis(cand, name, opts = {}) {
  busy('Recognising walls, doors, windows and rooms…');
  await new Promise(r => setTimeout(r, 30));
  try {
    const r = await analyse(sources, cand, opts);
    if (r.error) { toast(r.error, 5000); return; }
    const spec = project?.spec && opts.keepSpec ? project.spec : defaultSpec();
    const fromDrawing = opts.keepSpec ? project.fromDrawing : applyHints(spec, r.model.hints, r.model.location);
    project = { id: project?.id && opts.keepSpec ? project.id : newId(), name: name || 'New house', model: r.model, spec, fromDrawing, overlay: r.overlay, meta: { ...r.meta, cand } };
    $('#projName').value = project.name;
    undo = []; markClean();
    const m = r.model;
    const n = t => m.walls.reduce((s, w) => s + w.openings.filter(o => o.type === t).length, 0);
    $('#upLog').textContent += `\nFound ${m.walls.length} walls, ${n('door')} doors, ${n('win')} windows, ${n('slider')} sliding doors, ${n('garage')} garage door(s), ${m.rooms.length} rooms${m.electrical.length ? `, ${m.electrical.length} electrical points` : ''}.\n`;
    save();
    setStep('review');
    toast('Plan recognised – check it, fix anything that is off, then choose your options.');
  } catch (e) { console.error(e); toast('Analysis failed: ' + (e.message || e), 5000); }
  finally { busy(null); }
}

// ---------------------------------------------------------------------------
// Review (2D)
// ---------------------------------------------------------------------------
function ensureEditor() {
  if (editor) return;
  editor = new PlanEditor($('#plan'), {
    onSelect: sel => renderInspector($('#insp2d'), sel, { model: project.model, spec: project.spec, onChange: changed, onDelete: () => editor.select(null), onClose: s => { if (s && s.kind) editor.select(s); } }),
    onChange: () => changed(),
    onCalibrate: d => calibrate(d),
  });
  editor.onToolChange = t => $$('#tools [data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  $$('#tools [data-tool]').forEach(b => b.onclick = () => { if (b.dataset.tool === 'calibrate' && project.meta.kind !== 'pdf') { toast('CAD files are already in real units – no calibration needed.'); } editor.setTool(b.dataset.tool); if (b.dataset.tool === 'calibrate') toast('Click two points a known distance apart (e.g. the ends of a dimension line).', 4000); });
  $('#fitBtn').onclick = () => { editor.fit(); editor.draw(); };
  $('#undoBtn').onclick = doUndo;
  $('#ovT').onchange = e => { editor.showOverlay = e.target.checked; editor.draw(); };
  $('#ovA').oninput = e => { editor.overlayAlpha = +e.target.value; editor.draw(); };
  $('#wallT').onchange = e => { editor.wallT = +e.target.value; };
  $('#toDesign').onclick = () => setStep('design');
  renderInspector($('#insp2d'), null, {});
}
// Undo keeps the model as it was before each burst of edits
let lastJSON = null, lastSnap = 0;
function markClean() { lastJSON = project ? JSON.stringify(project.model) : null; }
function doUndo() {
  if (!undo.length) { toast('Nothing to undo'); return; }
  const prev = undo.pop();
  const m = JSON.parse(prev);
  for (const k of Object.keys(project.model)) delete project.model[k];
  Object.assign(project.model, m);
  lastJSON = prev; lastSnap = 0;
  editor && editor.select(null); editor && editor.draw();
  if (studio && studio.model) { studio.select(null); studio.rebuild(); }
  refreshSummary(); save();
}
function changed(kind) {
  if (lastJSON && Date.now() - lastSnap > 800) { undo.push(lastJSON); if (undo.length > 60) undo.shift(); }
  lastSnap = Date.now();
  lastJSON = JSON.stringify(project.model);
  editor && editor.draw();
  refreshSummary();
  scheduleRebuild();
  save();
  void kind;
}
async function calibrate(drawnMm) {
  const real = prompt(`That distance measures ${Math.round(drawnMm)} mm at the current scale.\nWhat is the real distance in mm?`);
  const v = +real;
  if (!(v > 0)) return;
  const cur = project.meta.scale || 100;
  const denom = Math.round(cur * v / drawnMm);
  if (!sources) { toast('Re-open the original files to change the scale.'); return; }
  toast(`New scale 1:${denom} – recognising again…`);
  await runAnalysis(project.meta.cand, project.name, { denom, keepSpec: true });
}
function refreshSummary() {
  if (!project) return;
  const m = project.model;
  const cnt = t => m.walls.reduce((s, w) => s + w.openings.filter(o => o.type === t).length, 0);
  const area = m.rooms.filter(r => r.type !== 'outdoor').reduce((s, r) => s + (r.area || 0), 0);
  const inferred = m.walls.filter(w => w.inferred).length;
  const guessed = m.rooms.filter(r => r.guessed).length;
  $('#summary').innerHTML = `<h4>Recognised from ${esc(project.meta.source || 'drawing')}${project.meta.page ? ' · page ' + project.meta.page : ''}</h4>
    <div class="kv"><span>Scale</span><b>${project.meta.scale ? '1:' + project.meta.scale : 'mm (CAD)'}</b></div>
    <div class="kv"><span>Walls</span><b>${m.walls.length} (${m.walls.filter(w => w.kind === 'ext').length} external)</b></div>
    <div class="kv"><span>Doors · windows · sliders</span><b>${cnt('door')} · ${cnt('win')} · ${cnt('slider')}</b></div>
    <div class="kv"><span>Garage doors · openings</span><b>${cnt('garage')} · ${cnt('arch') + cnt('void')}</b></div>
    <div class="kv"><span>Rooms</span><b>${m.rooms.length} · ${area.toFixed(1)} m² internal</b></div>
    <div class="kv"><span>Robes · columns</span><b>${m.robes.length} · ${m.columns.length}</b></div>
    <div class="kv"><span>Electrical points</span><b>${m.electrical.length || 'none – auto layout'}</b></div>
    ${inferred ? `<div class="warnbox">${inferred} wall section(s) (brown) were added to close the building outline – check them.</div>` : ''}
    ${guessed ? `<div class="warnbox">${guessed} room(s) had no name on the drawing – click them to name them.</div>` : ''}
    <p class="muted small">Tip: click any element to edit it. Use the tools on the left to add walls, doors and windows. Everything can also be edited later in 3D.</p>`;
}

// ---------------------------------------------------------------------------
// Studio (3D)
// ---------------------------------------------------------------------------
async function ensureStudio() {
  if (studio) return;
  busy('Starting the 3D engine…');
  const { Studio, WEATHER } = await import('./viewer/viewer.js');
  studio = new Studio($('#stage'), {
    onSelect: sel => { if (sel) showPanel('inspect'); renderInsp3d(sel); },
    onFps: f => { $('#fps').textContent = f + ' fps'; },
  });
  studio.WEATHER = WEATHER;
  studio.on('rebuilt', ms => { $('#buildMs').textContent = `rebuilt in ${Math.round(ms)} ms`; });
  studio.on('mode', m => { $$('#modes button').forEach(b => b.classList.toggle('active', b.dataset.mode === m)); renderViews(); $('#hud').classList.toggle('walking', m === 'walk'); $('#playOverlay').hidden = m !== 'walk' || studio.walker.controls.isLocked; });
  studio.on('lock', locked => { $('#playOverlay').hidden = locked || studio.mode !== 'walk'; });
  studio.on('hud', ({ room, focus }) => {
    const html = room ? `${esc(room.name)}<span>${room.area ? room.area.toFixed(1) + ' m²' : ''}</span>` : 'Outside';
    if (html !== studio._hudRoom) { $('#roomName').innerHTML = html; studio._hudRoom = html; }
    const hint = focus ? `<kbd>E</kbd> ${esc(focus.hint)}` : '';
    if (hint !== studio._hudHint) { $('#hint').innerHTML = hint; $('#hint').hidden = !focus; studio._hudHint = hint; }
  });
  studio.on('minimap', () => $('#minimap').classList.toggle('hide'));
  studio.on('sun', () => { if (!$('#panel-sun').hidden) updateSunReadout(); });
  studio.on('measure', items => renderMeasureList(items));
  $('#playOverlay').onclick = () => studio.walker.controls.lock();
  $$('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('#hqBtn').onclick = () => { studio.setHQ(!studio.HQ); $('#hqBtn').classList.toggle('active', studio.HQ); };
  $$('#ptabs button').forEach(b => b.onclick = () => showPanel(b.dataset.panel));
  $('#inspT').onchange = e => { studio.inspect = e.target.checked; };
  studio.inspect = true;
  busy(null);
}
function setMode(m, opts) {
  if (m === 'walk') { $$('#steps button').forEach(b => b.classList.toggle('active', b.dataset.step === 'walk')); }
  studio.setMode(m, opts);
}
function renderViews() {
  const v = $('#views'); v.innerHTML = '';
  const chip = (label, active, fn, title = '') => { const b = document.createElement('button'); b.className = 'chip' + (active ? ' active' : ''); b.textContent = label; b.title = title; b.onclick = fn; v.appendChild(b); };
  const m = studio.mode;
  if (m === 'exterior') {
    const V = studio.views();
    for (const key of ['F', 'R', 'L', 'Rt', 'O']) chip(V[key].label, studio.view === key, () => { studio.setMode('exterior', { view: key, ortho: studio.orthoElev && key !== 'O' }); });
    chip('Orthographic', !!studio.orthoElev, () => { studio.orthoElev = !studio.orthoElev; studio.setMode('exterior', { view: studio.view === 'O' ? 'F' : studio.view, ortho: studio.orthoElev }); }, 'True elevations');
  } else if (m === 'plan') {
    chip('2D plan', studio.camera === studio.ortho, () => studio.setMode('plan'));
    chip('Dollhouse 3D', studio.camera === studio.persp, () => studio.setMode('plan', { dollhouse: true }));
    chip('Original drawing', !!studio.overlayOn, () => { studio.showOverlay(!studio.overlayOn); renderViews(); });
    chip('Furniture', studio.furnVisible !== false, () => { studio.furnVisible = studio.furnVisible === false; studio.applyVisibility(); renderViews(); });
  } else if (m === 'roof') {
    chip('2D', studio.camera === studio.ortho, () => studio.setMode('roof'));
    chip('3D', studio.camera === studio.persp, () => studio.setMode('roof', { threeD: true }));
  } else if (m === 'electrical') {
    chip('3D', studio.camera === studio.persp, () => studio.setMode('electrical'));
    chip('Top', studio.camera === studio.ortho, () => studio.setMode('electrical', { top: true }));
    const anyOn = [...studio.elec.lights.rooms.values()].some(r => r.on);
    chip(anyOn ? 'Lights on' : 'Lights off', anyOn, () => { studio.elec.lights.setAll(!anyOn); renderViews(); });
    chip('Original drawing', !!studio.overlayOn, () => { studio.showOverlay(!studio.overlayOn); renderViews(); });
  } else if (m === 'walk') {
    for (const name of Object.keys(studio.spots())) chip(name, false, () => studio.teleport(name));
  }
}
function showPanel(p) {
  $$('#ptabs button').forEach(b => b.classList.toggle('active', b.dataset.panel === p));
  for (const id of ['options', 'inspect', 'sun', 'measure']) $('#panel-' + id).hidden = id !== p;
  studio.setMeasuring(p === 'measure');
  if (p === 'sun') renderSun();
  if (p === 'measure') renderMeasure();
  if (p === 'inspect') renderInsp3d(studio.selection);
}
function renderOpts(wizard) {
  optionsUI = renderOptions($('#panel-options'), {
    spec: project.spec, fromDrawing: project.fromDrawing, wizard,
    onChange: (g, k, v) => {
      if (g === '__finish') { setStep('walk'); return; }
      if (g === '__nav') { focusGroup(k); return; }
      scheduleRebuild(); save();
      if (g === 'site' && (k === 'north' || k === 'state' || k === 'lat' || k === 'lon')) renderSun();
      void v;
    },
  });
  if (wizard) $('#panel-options').insertAdjacentHTML('afterbegin', '<div class="wizmode"><button class="btn" id="allOpts">Show all options at once</button></div>');
  const b = $('#allOpts'); if (b) b.onclick = () => renderOpts(false);
}
// Point the camera at what the current options group is about
function focusGroup(id) {
  if (!studio) return;
  const room = t => project.model.rooms.find(r => r.type === t);
  const look = r => { if (!r) return; studio.setMode('plan', { dollhouse: true }); const q = r.rects[0]; const cx = (q[0] + q[2]) / 2000, cy = (q[1] + q[3]) / 2000; studio.flyTo([cx + 3.5, 7.5, cy + 6.5], [cx, 0.6, cy]); };
  if (['site', 'roof', 'exterior', 'windows', 'garage'].includes(id)) setMode('exterior', { view: id === 'roof' ? 'O' : 'F' });
  else if (id === 'kitchen') look(room('kitchen'));
  else if (id === 'bathroom') look(room('bath') || room('ensuite'));
  else if (id === 'laundry') look(room('laundry') || room('pantry'));
  else if (id === 'joinery') look(room('bedroom'));
  else if (['floors', 'paint', 'doors', 'furniture', 'structure', 'lighting'].includes(id)) setMode('plan', { dollhouse: true });
}
function renderInsp3d(sel) {
  renderInspector($('#insp3d'), sel, {
    model: project.model, spec: project.spec,
    onChange: () => { changed(); renderInsp3d(studio.selection); },
    onDelete: () => studio.select(null),
    onClose: s => { if (s === 'roof-options') { showPanel('options'); optionsUI.goto('roof'); } else if (s && s.kind) studio.select(s); },
  });
}
let rbTimer = null;
function scheduleRebuild() {
  if (!studio || !studio.model) return;
  clearTimeout(rbTimer);
  rbTimer = setTimeout(() => { studio.rebuild(); if (studio.mode === 'walk') renderViews(); }, 40);
}
// sun panel
function renderSun() {
  const env = studio.env, d = env.date, pad = n => String(n).padStart(2, '0');
  const hh = Math.floor(env.hours), mm = Math.round((env.hours - hh) * 60);
  $('#panel-sun').innerHTML = `
    <label class="row col">Date <input type="date" id="sDate" value="${d.y}-${pad(d.m + 1)}-${pad(d.d)}"></label>
    <label class="row col">Time <b id="sTime">${pad(hh)}:${pad(mm % 60)}</b><input type="range" id="sHour" min="4" max="22" step="0.0833" value="${env.hours}"></label>
    <div class="btnrow"><button class="btn" id="sPlay">${studio.sunPlaying ? 'Pause' : 'Play day'}</button><button class="btn" id="sNow">Now</button><button class="btn" data-pre="11">Summer solstice</button><button class="btn" data-pre="5">Winter solstice</button></div>
    <h4>Weather</h4><div class="btnrow">${Object.entries(studio.WEATHER).map(([k, w]) => `<button class="btn ${env.weather === k ? 'primary' : ''}" data-w="${k}">${w.label}</button>`).join('')}</div>
    <div class="kv"><span>Sun azimuth</span><b id="sAz">${env.pos.azimuth.toFixed(1)}°</b></div>
    <div class="kv"><span>Sun elevation</span><b id="sEl">${env.pos.elevation.toFixed(1)}°</b></div>
    <div class="kv"><span>North</span><b>${project.spec.site.north}° (Options → Site)</b></div>
    <div class="kv"><span>Location</span><b>${(+project.spec.site.lat).toFixed(3)}, ${(+project.spec.site.lon).toFixed(3)}</b></div>
    <p class="muted small">Lights switch on automatically after dark. In the walkthrough use wall switches or L.</p>`;
  $('#sHour').oninput = e => { env.setHours(+e.target.value); updateSunReadout(); };
  $('#sDate').onchange = e => { const [y, m, dd] = e.target.value.split('-').map(Number); env.setDate(y, m - 1, dd); renderSun(); };
  $('#sPlay').onclick = () => { studio.sunPlaying = !studio.sunPlaying; renderSun(); };
  $('#sNow').onclick = () => { const n = new Date(); env.date = { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }; env.setHours(n.getHours() + n.getMinutes() / 60); renderSun(); };
  $$('#panel-sun [data-pre]').forEach(b => b.onclick = () => { env.setDate(env.date.y, +b.dataset.pre, 21); renderSun(); });
  $$('#panel-sun [data-w]').forEach(b => b.onclick = () => { env.setWeather(b.dataset.w); renderSun(); });
}
function updateSunReadout() {
  const env = studio.env, el = $('#sTime'); if (!el) return;
  const hh = Math.floor(env.hours), mm = Math.floor((env.hours - hh) * 60), pad = n => String(n).padStart(2, '0');
  el.textContent = `${pad(hh)}:${pad(mm)}`; $('#sAz').textContent = env.pos.azimuth.toFixed(1) + '°'; $('#sEl').textContent = env.pos.elevation.toFixed(1) + '°';
  const r = $('#sHour'); if (r && document.activeElement !== r) r.value = env.hours;
}
function renderMeasure() {
  $('#panel-measure').innerHTML = `<p class="muted">Click two points on any surface. Results in millimetres. <kbd>Esc</kbd> cancels.</p><label class="row"><input type="checkbox" id="snapT" checked> Snap to 10 mm</label><div id="mlist"></div><button class="btn" id="mclear">Clear all</button><p class="muted small">Tip: Floor plan → 2D plan for plan dimensions; Exterior → Orthographic for heights.</p>`;
  $('#snapT').onchange = e => { studio.measure.snap = e.target.checked; };
  $('#mclear').onclick = () => studio.measure.clear();
  renderMeasureList(studio.measure.items);
}
function renderMeasureList(items) { const el = $('#mlist'); if (!el) return; el.innerHTML = items.length ? items.map((it, i) => `<div class="kv"><span>#${i + 1}</span><b>${it.mm.toLocaleString()} mm</b></div>`).join('') : '<p class="muted">No measurements yet.</p>'; }

// ---------------------------------------------------------------------------
// Projects & export
// ---------------------------------------------------------------------------
let saveTimer = null;
function save() {
  if (!project) return;
  clearTimeout(saveTimer);
  $('#saveState').textContent = 'saving…';
  saveTimer = setTimeout(async () => { const ok = await saveProject({ ...project, meta: { ...project.meta, cand: project.meta.cand ? { ...project.meta.cand } : null } }); $('#saveState').textContent = ok ? 'saved in this browser' : 'not saved'; renderRecent(); }, 600);
}
$('#projName').oninput = e => { if (project) { project.name = e.target.value; save(); } };
async function openProject(id) {
  const p = await loadProject(id);
  if (!p) return;
  const def = defaultSpec();
  for (const g of Object.keys(def)) p.spec[g] = { ...def[g], ...(p.spec[g] || {}) };
  project = p; sources = null; undo = []; markClean();
  $('#projName').value = p.name;
  enableSteps();
  if (studio) studio.model = null;
  setStep('design');
}
async function renderRecent() {
  const list = await listProjects();
  const el = $('#recent');
  el.innerHTML = list.length ? '<h3>Your projects</h3>' + list.map(p => `<div class="cand"><b>${esc(p.name)}</b><span class="muted">${new Date(p.updated).toLocaleString()}</span><button class="btn" data-open="${p.id}">Open</button></div>`).join('') : '';
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openProject(b.dataset.open));
  const menu = $('#projMenu');
  menu.innerHTML = `<button id="pmNew">+ New project (upload plans)</button><button id="pmOpenFile">Open project file…</button>` + list.map(p => `<button class="proj" data-open="${p.id}"><b>${esc(p.name)}</b><span>${new Date(p.updated).toLocaleDateString()}</span></button>`).join('') + (project ? `<button id="pmDel" class="danger">Delete this project from the browser</button>` : '');
  menu.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { menu.hidden = true; openProject(b.dataset.open); });
  $('#pmNew').onclick = () => { menu.hidden = true; setStep('upload'); };
  $('#pmOpenFile').onclick = () => { menu.hidden = true; const i = document.createElement('input'); i.type = 'file'; i.accept = '.json'; i.onchange = async () => { try { const d = JSON.parse(await i.files[0].text()); project = { id: newId(), name: d.name, model: d.model, spec: { ...defaultSpec(), ...d.spec }, fromDrawing: d.fromDrawing || {}, overlay: null, meta: d.meta || {} }; markClean(); $('#projName').value = project.name; enableSteps(); if (studio) studio.model = null; save(); setStep('design'); } catch (e) { toast('That file is not a Plan Studio project.'); } }; i.click(); };
  const del = $('#pmDel'); if (del) del.onclick = async () => { if (!confirm(`Delete "${project.name}" from this browser? This cannot be undone.`)) return; await deleteProject(project.id); project = null; menu.hidden = true; enableSteps(); setStep('upload'); renderRecent(); };
}
$('#projBtn').onclick = () => { $('#projMenu').hidden = !$('#projMenu').hidden; $('#exportMenu').hidden = true; };
$('#exportBtn').onclick = () => { $('#exportMenu').hidden = !$('#exportMenu').hidden; $('#projMenu').hidden = true; };
document.addEventListener('click', e => { if (!e.target.closest('.menu')) { $('#projMenu').hidden = true; $('#exportMenu').hidden = true; } });
$$('#exportMenu [data-exp]').forEach(b => b.onclick = async () => {
  $('#exportMenu').hidden = true;
  const ex = await import('./export.js');
  const t = b.dataset.exp;
  if (t === 'schedule') ex.openSchedule(project);
  if (t === 'json') ex.exportProjectFile(project);
  if (t === 'glb') { await ensureStudio(); if (studio.model !== project.model) studio.load(project.model, project.spec, { overlay: project.overlay }); busy('Exporting 3D model…'); try { await ex.exportGLB(studio, project.name); } finally { busy(null); } }
  if (t === 'shot') { await ensureStudio(); studio.screenshot(project.name); }
});

// ---------------------------------------------------------------------------
// Start (?load=url1,url2 opens files from the same server – handy for testing)
// ---------------------------------------------------------------------------
renderRecent();
enableSteps();
window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'z' && project && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { doUndo(); e.preventDefault(); } });
const qs = new URLSearchParams(location.search);
if (qs.get('open') === 'latest') listProjects().then(l => { if (l.length) openProject(l[0].id).then(() => { if (qs.get('mode')) setTimeout(() => setMode(qs.get('mode')), 800); }); });
if (qs.get('load')) {
  (async () => {
    const urls = qs.get('load').split(',');
    const files = [];
    for (const u of urls) { const r = await fetch(u); const b = await r.blob(); files.push(new File([b], decodeURIComponent(u.split('/').pop()))); }
    await handleFiles(files);
    if (qs.get('step')) setStep(qs.get('step'));
  })();
}
window.__ps = { get project() { return project; }, get studio() { return studio; }, get editor() { return editor; }, setStep, GROUPS };
