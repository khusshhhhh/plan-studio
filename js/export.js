// Exports: GLB model, printable selections & door/window schedule, project file.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GROUPS, colourHex, paletteOf } from './spec.js';
import { resolveOpening, heightsOf } from './viewer/build.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

export async function exportGLB(studio, name) {
  const root = new THREE.Group();
  for (const g of studio.groups) if (g.visible !== false) root.add(g.clone(true));
  const ex = new GLTFExporter();
  const glb = await ex.parseAsync(root, { binary: true, onlyVisible: true, maxTextureSize: 1024 });
  download(new Blob([glb], { type: 'model/gltf-binary' }), `${name}.glb`);
}

export function exportProjectFile(project) {
  const data = { app: 'plan-studio', version: 1, name: project.name, model: project.model, spec: project.spec, meta: project.meta, fromDrawing: project.fromDrawing };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${project.name || 'house'}.plan-studio.json`);
}

export function openSchedule(project) {
  const { model, spec, meta = {} } = project;
  const H = heightsOf(spec);
  const optRows = GROUPS.map(g => {
    const rows = g.questions.filter(q => !q.show || q.show(spec)).map(q => {
      let v = spec[g.id][q.key];
      let sw = '';
      if (q.type === 'color') { const hex = colourHex(spec, g.id, q.key); if (hex) sw = `<i class="sw" style="background:${hex}"></i>`; }
      else if (q.type === 'select') { const o = q.options.find(o => String(o.value) === String(v)); v = o ? o.label : `${v}${q.unit ? ' ' + q.unit : ''}`; }
      else if (q.type === 'toggle') v = v ? 'Yes' : 'No';
      else if (q.type === 'number') v = `${v}${q.unit ? ' ' + q.unit : ''}`;
      const from = project.fromDrawing?.[`${g.id}.${q.key}`] ? ' <em>(from drawing)</em>' : '';
      return `<tr><td>${esc(q.label)}</td><td>${sw}${esc(v)}${from}</td></tr>`;
    }).join('');
    void paletteOf;
    return `<h3>${g.icon} ${esc(g.title)}</h3><table>${rows}</table>`;
  }).join('');
  const typeName = { door: 'Hinged door', slider: 'Sliding door', win: 'Window', garage: 'Garage door', arch: 'Flat arch', void: 'Opening' };
  const ops = [];
  for (const w of model.walls) for (const op of w.openings) {
    const o = resolveOpening(model, spec, H, w, op);
    ops.push({ id: op.id, type: typeName[op.type] || op.type, style: o.style || '', w: op.b - op.a, h: o.head - o.sill, sill: o.sill, head: o.head, rooms: o.rooms.filter(Boolean).map(r => r.name).join(' / ') || '—', ext: w.kind === 'ext', obscure: o.obscure });
  }
  ops.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const opRows = ops.map(o => `<tr><td>${esc(o.id)}</td><td>${esc(o.type)}${o.style ? ' · ' + esc(o.style) : ''}${o.obscure ? ' · obscure' : ''}</td><td>${o.w}</td><td>${o.h}</td><td>${o.type === 'Window' ? o.sill : '—'}</td><td>${o.head}</td><td>${o.ext ? 'External' : 'Internal'}</td><td>${esc(o.rooms)}</td></tr>`).join('');
  const roomRows = model.rooms.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.type)}</td><td>${r.area ? r.area.toFixed(2) : ''}</td><td>${r.ceiling || H.ceiling}</td></tr>`).join('');
  const total = model.rooms.filter(r => r.type !== 'outdoor').reduce((s, r) => s + (r.area || 0), 0);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} – selections schedule</title>
<style>body{font:13px/1.45 Inter,Arial,sans-serif;color:#1b1f24;max-width:1000px;margin:24px auto;padding:0 16px}h1{margin:0 0 4px}h2{margin:28px 0 8px;border-bottom:2px solid #1b1f24;padding-bottom:4px}h3{margin:18px 0 6px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left;vertical-align:top}th{background:#f3f4f6}.sw{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid #0003;vertical-align:-2px;margin-right:6px}em{color:#0a7d35;font-style:normal;font-size:11px}.muted{color:#667}@media print{h2{break-before:page}h2:first-of-type{break-before:auto}}</style></head><body>
<h1>${esc(project.name)}</h1><div class="muted">${esc(spec.site.address || '')} · Generated ${new Date().toLocaleString()} · Source: ${esc(meta.source || '')}${meta.page ? ' (page ' + meta.page + ')' : ''}</div>
<h2>Rooms</h2><table><tr><th>Room</th><th>Type</th><th>Area (m²)</th><th>Ceiling (mm)</th></tr>${roomRows}<tr><th colspan="2">Total internal area</th><th>${total.toFixed(2)}</th><th></th></tr></table>
<h2>Door & window schedule</h2><table><tr><th>Ref</th><th>Type</th><th>Width</th><th>Height</th><th>Sill</th><th>Head</th><th></th><th>Rooms</th></tr>${opRows}</table>
<h2>Selections</h2>${optRows}
<p class="muted">Areas and sizes were measured automatically from the uploaded drawing and should be checked against the drawings before ordering.</p>
<script>setTimeout(()=>print(),400)</script></body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
  else download(new Blob([html], { type: 'text/html' }), `${project.name}-schedule.html`);
}
