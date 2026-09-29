// Options panel: every question from spec.js, grouped, with colour swatches, custom values
// and "from drawing" badges. Changes apply immediately (the 3D model rebuilds live).
import { GROUPS, paletteOf, colourHex, METAL } from './spec.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function renderOptions(el, { spec, fromDrawing = {}, onChange, open = null, wizard = false }) {
  const state = { open: open || (wizard ? GROUPS[0].id : null) };
  const draw = () => {
    let html = '';
    if (wizard) {
      const idx = GROUPS.findIndex(g => g.id === state.open);
      html += `<div class="wiz-steps">${GROUPS.map((g, i) => `<button class="wiz-dot ${g.id === state.open ? 'on' : i < idx ? 'done' : ''}" data-go="${g.id}" title="${esc(g.title)}">${g.icon}</button>`).join('')}</div>`;
    }
    for (const g of GROUPS) {
      const isOpen = state.open === g.id;
      if (wizard && !isOpen) continue;
      const nFrom = g.questions.filter(q => fromDrawing[`${g.id}.${q.key}`]).length;
      html += `<section class="og ${isOpen ? 'open' : ''}" data-g="${g.id}"><button class="oghead" data-toggle="${g.id}"><span>${g.icon}</span><b>${esc(g.title)}</b>${nFrom ? `<em class="badge ok">${nFrom} from drawing</em>` : ''}<i>${isOpen ? '−' : '+'}</i></button>`;
      if (isOpen) {
        html += '<div class="ogbody">';
        for (const q of g.questions) {
          if (q.show && !q.show(spec)) continue;
          const v = spec[g.id][q.key];
          const id = `q-${g.id}-${q.key}`;
          const why = fromDrawing[`${g.id}.${q.key}`];
          const badge = why ? `<em class="badge ok" title="${esc(why)}">from drawing</em>` : '';
          html += `<div class="q ${q.adv ? 'adv' : ''}"><label for="${id}">${esc(q.label)} ${badge}</label>`;
          if (q.type === 'select') {
            const known = q.options.some(o => String(o.value) === String(v));
            html += `<select id="${id}" data-g="${g.id}" data-k="${q.key}">${q.options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}${q.custom ? `<option value="__custom" ${known ? '' : 'selected'}>Custom…</option>` : ''}</select>`;
            if (q.custom) html += `<span class="inrow custom ${known ? 'hide' : ''}"><input type="number" data-g="${g.id}" data-k="${q.key}" data-custom="1" value="${known ? '' : esc(v)}" step="${q.unit === '°' ? 0.5 : 10}"><em>${q.unit || ''}</em></span>`;
          } else if (q.type === 'number') {
            html += `<span class="inrow"><input type="number" id="${id}" data-g="${g.id}" data-k="${q.key}" value="${esc(v)}" ${q.min !== undefined ? `min="${q.min}"` : ''} ${q.max !== undefined ? `max="${q.max}"` : ''} step="${q.step || 1}"><em>${q.unit || ''}</em></span>`;
          } else if (q.type === 'toggle') {
            html += `<label class="switch"><input type="checkbox" id="${id}" data-g="${g.id}" data-k="${q.key}" ${v ? 'checked' : ''}><span></span></label>`;
          } else if (q.type === 'text') {
            html += `<input type="text" id="${id}" data-g="${g.id}" data-k="${q.key}" value="${esc(v)}">`;
          } else if (q.type === 'color') {
            const { colours } = paletteOf(q, spec);
            const cur = colourHex(spec, g.id, q.key);
            html += `<div class="sw-cur"><i style="background:${cur || 'transparent'}"></i><span>${esc(v)}</span></div><div class="swatches">`;
            for (const [name, c] of Object.entries(colours)) {
              const hex = c && typeof c === 'object' ? c.c : c;
              html += `<button class="sw ${name === v ? 'on' : ''} ${hex ? '' : 'none'}" data-g="${g.id}" data-k="${q.key}" data-v="${esc(name)}" title="${esc(name)}" style="background:${hex || 'transparent'}"></button>`;
            }
            html += `<label class="sw pick" title="Any colour"><input type="color" data-g="${g.id}" data-k="${q.key}" data-free="1" value="${cur && cur.startsWith('#') ? cur : '#888888'}"></label></div>`;
          }
          if (why) html += `<small class="why">Read from the drawing: ${esc(why)}</small>`;
          html += '</div>';
        }
        if (wizard) {
          const idx = GROUPS.findIndex(x => x.id === g.id);
          html += `<div class="btnrow wiznav">${idx > 0 ? `<button class="btn" data-go="${GROUPS[idx - 1].id}">← ${esc(GROUPS[idx - 1].title)}</button>` : '<span></span>'}${idx < GROUPS.length - 1 ? `<button class="btn primary" data-go="${GROUPS[idx + 1].id}">${esc(GROUPS[idx + 1].title)} →</button>` : '<button class="btn primary" data-finish="1">Finish – walk through →</button>'}</div>`;
        }
        html += '</div>';
      }
      html += '</section>';
    }
    el.innerHTML = html;
    bind();
  };
  const set = (g, key, value, redraw = false) => {
    spec[g][key] = value;
    delete fromDrawing[`${g}.${key}`];
    onChange(g, key, value);
    if (redraw) draw();
  };
  const bind = () => {
    el.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => { state.open = state.open === b.dataset.toggle ? null : b.dataset.toggle; draw(); if (state.open) el.querySelector(`[data-g="${state.open}"]`)?.scrollIntoView({ block: 'nearest' }); });
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { state.open = b.dataset.go; draw(); el.scrollTop = 0; onChange('__nav', state.open); });
    el.querySelectorAll('[data-finish]').forEach(b => b.onclick = () => onChange('__finish'));
    el.querySelectorAll('select[data-k]').forEach(s => s.onchange = () => {
      const q = findQ(s.dataset.g, s.dataset.k);
      if (s.value === '__custom') { s.parentElement.querySelector('.custom')?.classList.remove('hide'); return; }
      const val = typeof q.def === 'number' ? +s.value : s.value;
      set(s.dataset.g, s.dataset.k, val, true);
    });
    el.querySelectorAll('input[data-k]').forEach(i => {
      const g = i.dataset.g, key = i.dataset.k;
      if (i.type === 'checkbox') i.onchange = () => set(g, key, i.checked, true);
      else if (i.type === 'color') i.oninput = () => set(g, key, i.value, false);
      else if (i.type === 'number') i.oninput = () => { if (i.value !== '' && isFinite(+i.value)) set(g, key, +i.value, false); };
      else i.oninput = () => set(g, key, i.value, false);
      if (i.type === 'color') i.onchange = () => draw();
    });
    el.querySelectorAll('button.sw[data-v]').forEach(b => b.onclick = () => set(b.dataset.g, b.dataset.k, b.dataset.v, true));
  };
  draw();
  return { goto: id => { state.open = id; draw(); }, redraw: draw };
}

function findQ(g, k) { return GROUPS.find(x => x.id === g).questions.find(q => q.key === k); }
export { METAL };
