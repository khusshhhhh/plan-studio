// Projects are kept in the browser (IndexedDB): model, options, overlay image and metadata.
const DB = 'plan-studio', STORE = 'projects';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(STORE, mode); const s = t.objectStore(STORE); const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
export async function saveProject(p) { try { p.updated = Date.now(); await tx('readwrite', s => s.put(p)); return true; } catch (e) { console.warn('save failed', e); return false; } }
export async function listProjects() { try { const all = await tx('readonly', s => s.getAll()); return (all || []).map(p => ({ id: p.id, name: p.name, updated: p.updated, meta: p.meta })).sort((a, b) => b.updated - a.updated); } catch (e) { return []; } }
export async function loadProject(id) { try { return await tx('readonly', s => s.get(id)); } catch (e) { return null; } }
export async function deleteProject(id) { try { await tx('readwrite', s => s.delete(id)); } catch (e) { /* ignore */ } }
export const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
