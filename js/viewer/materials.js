// Spec-driven material library. Geometry uses world-space UVs (1 UV unit = 1 metre), so each
// texture's repeat is 1/size. applySpec() only regenerates what changed.
import * as THREE from 'three';
import { TEX } from './textures.js';
import { colourHex, metal, PAINT, TIMBER, TILE, STONE } from '../spec.js';

const lib = new Map();
const sigs = new Map();

function applyTex(mat, t) {
  const rep = 1 / t.size;
  for (const k of ['map', 'normalMap', 'roughnessMap']) {
    if (mat[k] && mat[k] !== t[k]) { mat[k].dispose?.(); mat[k] = null; }
    if (t[k]) { t[k].repeat.set(rep, rep); mat[k] = t[k]; }
  }
  mat.needsUpdate = true;
}
function mat(key, opts = {}) {
  let m = lib.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial(); m.name = key; lib.set(key, m); }
  return m;
}
// Set a material from a descriptor; tex() only runs when the signature changed
function def(key, sig, props, tex = null) {
  const m = mat(key);
  const s = JSON.stringify(sig);
  if (sigs.get(key) === s) return m;
  sigs.set(key, s);
  if (m.map) { m.map.dispose(); m.map = null; }
  if (m.normalMap) { m.normalMap.dispose(); m.normalMap = null; }
  if (m.roughnessMap) { m.roughnessMap.dispose(); m.roughnessMap = null; }
  m.color.set(props.color ?? '#ffffff');
  m.roughness = props.roughness ?? 0.8; m.metalness = props.metalness ?? 0;
  m.transparent = !!props.transparent; m.opacity = props.opacity ?? 1; m.depthWrite = props.depthWrite ?? true;
  m.envMapIntensity = props.envMapIntensity ?? 1;
  m.emissive.set(props.emissive ?? '#000000'); m.emissiveIntensity = props.emissiveIntensity ?? 1;
  m.side = props.side ?? THREE.FrontSide;
  m.normalScale = props.normalScale || new THREE.Vector2(1, 1);
  if (tex) applyTex(m, tex());
  m.needsUpdate = true;
  return m;
}

export function M(key) {
  const m = lib.get(key);
  if (!m) { console.warn('missing material', key); return lib.get('plaster') || mat('plaster'); }
  return m;
}

const hexOr = (v, fallback) => (v && typeof v === 'string' && v.startsWith('#')) ? v : fallback;
const mortarOf = v => ({ light: '#d9d4c8', grey: '#9d9a94', dark: '#3d3b39' })[v] || '#d9d4c8';

function wallFinish(key, material, hex, spec) {
  switch (material) {
    case 'brick': return def(key, ['brick', hex, spec.exterior.mortar], { roughness: 0.95 }, () => TEX.brick({ base: hex, mortar: mortarOf(spec.exterior.mortar) }));
    case 'weatherboard': return def(key, ['wb', hex], { roughness: 0.75 }, () => TEX.weatherboard(hex));
    case 'vertical': return def(key, ['vc', hex], { roughness: 0.75 }, () => TEX.vcladding(hex));
    case 'stone': return def(key, ['st', hex], { roughness: 0.95 }, () => TEX.stone(hex));
    case 'timber': return def(key, ['tb', hex], { roughness: 0.7 }, () => TEX.battens({ base: hex, w: 0.09, gap: 0.008, sizeM: 1.0 }));
    case 'panel': return def(key, ['pn', hex], { roughness: 0.85 }, () => TEX.tiles({ base: hex, grout: '#6b6a66', tileW: 1.2, tileH: 2.4, sizeM: 2.4, vary: 0.01, px: 512 }));
    default: return def(key, ['render', hex], { roughness: 0.92 }, () => TEX.render(hex));
  }
}

const STYLE = {
  modern: { fabric: '#8c8479', fabricDark: '#4a4c50', throw: '#9c8d77', rug: '#c6bdb0', wood: '#8a6242', linen: '#ecebe6' },
  scandi: { fabric: '#c9c5bd', fabricDark: '#7f8a8c', throw: '#d7c9a8', rug: '#e6e1d6', wood: '#cfae85', linen: '#f3f1ec' },
  hamptons: { fabric: '#e6e3dc', fabricDark: '#3f5570', throw: '#9fb3c8', rug: '#d9d3c4', wood: '#b9a07e', linen: '#f7f6f2' },
  industrial: { fabric: '#5b4a3c', fabricDark: '#2c2d2f', throw: '#8b6d4b', rug: '#6d6760', wood: '#4d3a2a', linen: '#d9d6cf' },
};

function floorTex(kind, spec) {
  const tile = colourHex(spec, 'floors', 'livingTile') || '#cfc8bd';
  switch (kind) {
    case 'oak': return [{ roughness: 0.55 }, () => TEX.planks({ base: '#b48a5e' })];
    case 'lightOak': return [{ roughness: 0.55 }, () => TEX.planks({ base: '#cfae85' })];
    case 'greyOak': return [{ roughness: 0.55 }, () => TEX.planks({ base: '#9c9285' })];
    case 'spotted': return [{ roughness: 0.5 }, () => TEX.planks({ base: '#9a6a43', plankW: 0.13 })];
    case 'tile': return [{ roughness: 0.35 }, () => TEX.tiles({ base: tile, grout: shadeHex(tile, 0.85), veins: true })];
    case 'tileLarge': return [{ roughness: 0.3 }, () => TEX.tiles({ base: tile, grout: shadeHex(tile, 0.85), tileW: 0.6, tileH: 1.2, veins: true })];
    case 'concrete': return [{ roughness: 0.25 }, () => TEX.concrete('#b5b2ab', { spots: true, size: 4 })];
    case 'carpet': return [{ roughness: 1 }, () => TEX.carpet(colourHex(spec, 'floors', 'carpet') || '#8d8a85')];
    default: return [{ roughness: 0.55 }, () => TEX.planks({ base: '#b48a5e' })];
  }
}
function shadeHex(hex, f) { const c = new THREE.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString(); }

export function applySpec(spec) {
  const C = (g, k, fb = '#cccccc') => colourHex(spec, g, k) || fb;
  const S = STYLE[spec.furniture.style] || STYLE.modern;
  // ---- external
  wallFinish('extWall', spec.exterior.wallMaterial, C('exterior', 'wallColour', '#ECE9E1'), spec);
  const fm = spec.exterior.featureMaterial === 'same' ? spec.exterior.wallMaterial : spec.exterior.featureMaterial;
  wallFinish('feature', fm, spec.exterior.featureMaterial === 'same' ? C('exterior', 'wallColour') : C('exterior', 'featureColour', '#5D5B57'), spec);
  const beamHex = spec.exterior.beamFinish === 'timber' ? C('exterior', 'beamTimber', '#9a6a43') : spec.exterior.beamFinish === 'feature' ? C('exterior', 'featureColour') : C('exterior', 'wallColour');
  if (spec.exterior.beamFinish === 'timber') def('beam', ['timber', beamHex], { roughness: 0.7 }, () => TEX.battens({ base: beamHex }));
  else def('beam', ['render', beamHex], { roughness: 0.9 }, () => TEX.render(beamHex));
  const roofHex = C('roof', 'colour', '#323233');
  const rm = spec.roof.material;
  if (rm === 'tile' || rm === 'terracotta') def('roof', ['tile', roofHex, rm], { roughness: 0.8 }, () => TEX.roofTiles(roofHex, { terracotta: rm === 'terracotta' }));
  else def('roof', ['cb', roofHex, rm], { color: roofHex, roughness: 0.48, metalness: 0.35, normalScale: new THREE.Vector2(1.2, 1.2) }, () => rm === 'kliplok' ? TEX.ribNormal({ ribs: 4, sizeM: 0.7 }) : corrugated());
  def('roofCap', [roofHex], { color: roofHex, roughness: 0.45, metalness: 0.35 });
  const gHex = C('roof', 'gutterColour', '#323233');
  def('gutter', [gHex], { color: gHex, roughness: 0.45, metalness: 0.35 });
  const dpHex = C('roof', 'downpipeColour', '#323233');
  def('dp', [dpHex], { color: dpHex, roughness: 0.6, metalness: 0.1 });
  def('soffit', [C('roof', 'soffit', '#F1F1EC')], { color: C('roof', 'soffit', '#F1F1EC'), roughness: 1 });
  // ---- windows & doors
  const fr = C('windows', 'frameColour', '#323233');
  def('frame', [fr], { color: fr, roughness: 0.4, metalness: 0.5 });
  const tint = { clear: '#a9c4d4', grey: '#6f7a80', bronze: '#8a7560', lowe: '#8fb8b0' }[spec.windows.glass] || '#a9c4d4';
  def('glass', [tint], { color: tint, roughness: 0.03, metalness: 0.1, transparent: true, opacity: spec.windows.glass === 'clear' ? 0.22 : 0.4, envMapIntensity: 1.6, depthWrite: false });
  def('obscure', ['o'], { color: '#e8eef2', roughness: 0.6, transparent: true, opacity: 0.82 }, () => TEX.frosted());
  def('mirror', ['m'], { color: '#dfe7ea', roughness: 0.02, metalness: 1.0, envMapIntensity: 1.4 });
  const entryHex = C('doors', 'entryColour', '#6B5847');
  const es = spec.doors.entryStyle;
  if (['glassStrip', 'pivot', 'vgroove'].includes(es) && TIMBER[spec.doors.entryColour]) def('entry', ['tb', entryHex, es], { roughness: 0.55 }, () => TEX.battens({ base: entryHex, w: es === 'vgroove' ? 0.1 : 0.12, gap: 0.006, sizeM: 1.1 }));
  else def('entry', ['p', entryHex, es], { color: entryHex, roughness: 0.45 });
  def('extDoor', [C('doors', 'extDoorColour', '#EFEEE5')], { color: C('doors', 'extDoorColour', '#EFEEE5'), roughness: 0.5 });
  def('intDoor', [C('doors', 'intColour', '#F7F7F5')], { color: C('doors', 'intColour', '#F7F7F5'), roughness: 0.45 });
  def('trim', [C('paint', 'trim', '#F7F7F4')], { color: C('paint', 'trim', '#F7F7F4'), roughness: 0.4 });
  const hw = metal(spec.doors.hardware);
  def('hardware', [hw], { color: hw.c, metalness: hw.m, roughness: hw.r });
  const gd = C('garage', 'colour', '#6D6C6E');
  if (spec.garage.doorType === 'timberPanel') def('garageDoor', ['t', gd], { roughness: 0.6 }, () => TEX.battens({ base: '#9a6a43', w: 0.1, sizeM: 1.2 }));
  else def('garageDoor', ['c', gd], { color: gd, roughness: 0.45, metalness: 0.3 });
  // ---- interior surfaces
  def('plaster', [C('paint', 'walls', '#F1F1EC')], { roughness: 0.95 }, () => TEX.plaster(C('paint', 'walls', '#F1F1EC')));
  const fw = spec.paint.feature && spec.paint.feature !== 'None' ? C('paint', 'feature', '#8C8676') : C('paint', 'walls', '#F1F1EC');
  def('featurePaint', [fw], { roughness: 0.95 }, () => TEX.plaster(fw));
  def('ceiling', [C('paint', 'ceiling', '#f7f7f3')], { color: C('paint', 'ceiling', '#f7f7f3'), roughness: 1 });
  def('poche', ['p'], { color: '#2b2b2d', roughness: 1 });
  const wt = C('bathroom', 'wallTile', '#eeede9');
  const ts = { '300x600': [0.3, 0.6], '600x600': [0.6, 0.6], '75x300 subway': [0.3, 0.075], '100x100': [0.1, 0.1] }[spec.bathroom.tileSize] || [0.3, 0.6];
  def('wallTile', [wt, ts], { roughness: 0.25 }, () => TEX.tiles({ base: wt, grout: shadeHex(wt, 0.85), tileW: ts[0], tileH: ts[1], sizeM: 1.2, px: 512, gloss: true }));
  const ft = spec.bathroom.featureTile && spec.bathroom.featureTile !== 'None' ? C('bathroom', 'featureTile', '#8f8b84') : wt;
  def('featureTile', [ft], { roughness: 0.35 }, () => TEX.tiles({ base: ft, grout: shadeHex(ft, 0.8), tileW: 0.075, tileH: 0.3, sizeM: 0.6, px: 512 }));
  // floors
  const lv = floorTex(spec.floors.living, spec);
  def('floor_living', [spec.floors.living, spec.floors.livingTile, spec.floors.carpet], lv[0], lv[1]);
  const bk = spec.floors.bedroom === 'same' ? spec.floors.living : spec.floors.bedroom;
  const bd = floorTex(bk, spec);
  def('floor_bedroom', [bk, spec.floors.carpet, spec.floors.livingTile], bd[0], bd[1]);
  const wf = C('bathroom', 'floorTile', '#d4d2cc');
  def('floor_wet', [wf], { roughness: 0.4 }, () => TEX.tiles({ base: wf, grout: shadeHex(wf, 0.82) }));
  const og = C('floors', 'outdoorColour', '#77746f');
  const od = spec.floors.outdoor;
  if (od === 'decking') def('floor_outdoor', ['deck'], { roughness: 0.7 }, () => TEX.planks({ base: '#8a6242', plankW: 0.14, plankL: 5.4 }));
  else if (od === 'pavers') def('floor_outdoor', ['pav'], { roughness: 0.9 }, () => TEX.pavers({ base: '#a79f92' }));
  else if (od === 'concrete') def('floor_outdoor', ['conc'], { roughness: 0.8 }, () => TEX.concrete('#8f8c86', { size: 4 }));
  else def('floor_outdoor', ['tile', og], { roughness: 0.7 }, () => TEX.tiles({ base: og, grout: shadeHex(og, 0.8) }));
  const gf = spec.floors.garage;
  if (gf === 'epoxy') def('floor_garage', ['e'], { roughness: 0.35 }, () => TEX.concrete('#8e9194', { spots: true, size: 2 }));
  else if (gf === 'tile') def('floor_garage', ['t'], { roughness: 0.5 }, () => TEX.tiles({ base: '#a19d96', grout: '#85817a' }));
  else def('floor_garage', ['c'], { roughness: 0.8 }, () => TEX.concrete('#b3b0a9', { size: 4 }));
  // ---- kitchen
  const bt = C('kitchen', 'benchtop', '#f0eee9');
  const stoneTex = hex => () => TEX.tiles({ base: hex, grout: hex, tileW: 3, tileH: 3, sizeM: 3, veins: hex !== '#1e1e1f', vary: 0 });
  def('benchtop', [bt], { roughness: 0.25 }, stoneTex(bt));
  const cab = (key, g, k) => {
    const v = spec[g][k]; const hex = C(g, k, '#f3f2ee');
    const style = spec.kitchen.cabinetStyle;
    if (TIMBER[v]) def(key, ['t', hex, style], { roughness: 0.6 }, () => style === 'fluted' ? TEX.fluted(hex) : TEX.planks({ base: hex, plankW: 0.6, plankL: 2.4, sizeM: 2.4 }));
    else if (style === 'fluted' || style === 'vgroove') def(key, [style, hex], { roughness: 0.55 }, () => style === 'fluted' ? TEX.fluted(hex) : TEX.vcladding(hex, { pitch: 0.1, sizeM: 1.0 }));
    else def(key, ['p', hex], { color: hex, roughness: 0.55 });
  };
  cab('cabBase', 'kitchen', 'baseColour'); cab('cabIsland', 'kitchen', 'islandColour'); cab('cabOver', 'kitchen', 'overheadColour');
  cab('laundryCab', 'laundry', 'colour'); cab('shelf', 'joinery', 'shelfColour'); cab('pantryShelf', 'laundry', 'pantryShelves');
  def('cabGap', ['g'], { color: '#3b3a38', roughness: 0.6 });
  const sp = spec.kitchen.splashback, sc = C('kitchen', 'splashColour', '#f4f4f2');
  if (sp === 'stone') def('splash', ['s', bt], { roughness: 0.25 }, stoneTex(bt));
  else if (sp === 'mirror') def('splash', ['m'], { color: '#dfe7ea', roughness: 0.03, metalness: 1 });
  else if (sp === 'glass') def('splash', ['g', sc], { color: sc, roughness: 0.06, metalness: 0.1 });
  else def('splash', [sp, sc], { roughness: 0.2 }, () => TEX.tiles({ base: sc, grout: shadeHex(sc, 0.85), tileW: sp === 'finger' ? 0.025 : 0.3, tileH: sp === 'finger' ? 0.3 : 0.075, sizeM: 0.6, px: 512, gloss: true }));
  const ap = spec.kitchen.appliances;
  def('appliance', [ap], ap === 'black' ? { color: '#1d1d1f', roughness: 0.3, metalness: 0.5 } : ap === 'integrated' ? { color: C('kitchen', 'baseColour', '#f3f2ee'), roughness: 0.55 } : { color: '#c9ccce', roughness: 0.28, metalness: 0.9 });
  const kt = metal(spec.kitchen.tapware); def('kTap', [kt], { color: kt.c, metalness: kt.m, roughness: kt.r });
  const kh = metal(spec.kitchen.handleFinish); def('handle', [kh], { color: kh.c, metalness: kh.m, roughness: kh.r });
  // ---- bathroom
  const vc = C('bathroom', 'vanityColour', '#b48a5e');
  if (TIMBER[spec.bathroom.vanityColour]) def('vanity', ['t', vc], { roughness: 0.6 }, () => TEX.planks({ base: vc, plankW: 0.6, plankL: 2.4, sizeM: 2.4 }));
  else def('vanity', ['p', vc], { color: vc, roughness: 0.5 });
  const vt = C('bathroom', 'vanityTop', '#f2f1ec'); def('vanityTop', [vt], { roughness: 0.25 }, stoneTex(vt));
  const bt2 = metal(spec.bathroom.tapware); def('tap', [bt2], { color: bt2.c, metalness: bt2.m, roughness: bt2.r });
  const sf = spec.bathroom.screen === 'black' ? { c: '#171717', m: 0.3, r: 0.5 } : bt2;
  def('screenFrame', [sf], { color: sf.c, metalness: sf.m, roughness: sf.r });
  if (spec.bathroom.screen === 'fluted') def('showerGlass', ['f'], { color: '#e3ecef', roughness: 0.3, transparent: true, opacity: 0.6 }, () => TEX.fluted('#eef3f5', { pitch: 0.02 }));
  else def('showerGlass', ['c'], { color: '#c8dde6', roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false });
  def('ceramic', ['c'], { color: '#fbfbf9', roughness: 0.12 });
  def('tub', [spec.laundry.tub], spec.laundry.tub === 'ceramic' ? { color: '#fbfbf9', roughness: 0.12 } : { color: '#c9ccce', roughness: 0.28, metalness: 0.9 });
  // ---- robes
  const rd = spec.joinery.robeDoors, rc = C('joinery', 'robeColour', '#f3f2ee');
  if (rd === 'mirror') def('robeDoor', ['m'], { color: '#dfe7ea', roughness: 0.02, metalness: 1, envMapIntensity: 1.4 });
  else if (rd === 'timber') def('robeDoor', ['t'], { roughness: 0.6 }, () => TEX.planks({ base: '#b48a5e', plankW: 0.6, plankL: 2.4, sizeM: 2.4 }));
  else if (rd === 'blackGlass') def('robeDoor', ['bg'], { color: '#9aa7ad', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 });
  else def('robeDoor', ['p', rc], { color: rc, roughness: 0.5 });
  // ---- lighting
  const warm = { warm: '#ffe7c4', neutral: '#fff4e6', cool: '#eef4ff' }[spec.lighting.warmth];
  def('lightOff', ['o'], { color: '#e9e9e6', roughness: 0.3 });
  const lo = mat('lightOn'); lo.userData.warm = warm;
  def('lightOn', [warm], { color: '#fffaf0', roughness: 0.3, emissive: warm, emissiveIntensity: 0 });
  def('dlTrim', [spec.lighting.downlight], { color: { white: '#f2f2ef', black: '#161616', brass: '#c5a263' }[spec.lighting.downlight], roughness: 0.4, metalness: spec.lighting.downlight === 'brass' ? 1 : 0 });
  def('plate', [spec.lighting.plates], { color: { white: '#f2f2ef', black: '#1a1a1a', brushed: '#b9bcbe' }[spec.lighting.plates], roughness: 0.4, metalness: spec.lighting.plates === 'brushed' ? 0.8 : 0 });
  // ---- furniture & misc
  def('fabric', [S.fabric], { color: S.fabric, roughness: 1 });
  def('fabricDark', [S.fabricDark], { color: S.fabricDark, roughness: 1 });
  def('linen', [S.linen], { color: S.linen, roughness: 1 });
  def('throw', [S.throw], { color: S.throw, roughness: 1 });
  def('rug', [S.rug], { roughness: 1 }, () => TEX.carpet(S.rug));
  def('wood', [S.wood], { roughness: 0.55 }, () => TEX.planks({ base: S.wood, plankW: 0.3, plankL: 2, sizeM: 2 }));
  def('woodVeneer', ['v'], { roughness: 0.6 }, () => TEX.planks({ base: '#a67a52', plankW: 0.6, plankL: 2.4, sizeM: 2.4 }));
  def('steel', ['s'], { color: '#c9ccce', roughness: 0.28, metalness: 0.9 });
  def('blackGlass', ['b'], { color: '#0e0e10', roughness: 0.08, metalness: 0.2 });
  def('chrome', ['c'], { color: '#e8e8e8', roughness: 0.1, metalness: 1 });
  def('black', ['b'], { color: '#141414', roughness: 0.5, metalness: 0.2 });
  def('screen', ['s'], { color: '#050608', roughness: 0.15, metalness: 0.5 });
  def('plastic', ['p'], { color: '#f2f2ef', roughness: 0.4 });
  def('ac', ['a'], { color: '#e4e4e0', roughness: 0.5 });
  def('blind', ['b'], { color: '#e9e6df', roughness: 0.9 });
  def('curtain', ['c'], { color: '#f4f2ec', roughness: 1, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  def('shutter', ['s'], { color: '#f4f4f1', roughness: 0.5 });
  def('carBody', ['c'], { color: '#9aa3ab', roughness: 0.25, metalness: 0.7 });
  def('carBody2', ['c2'], { color: '#2d3440', roughness: 0.25, metalness: 0.7 });
  def('carGlass', ['g'], { color: '#141a20', roughness: 0.05, metalness: 0.4 });
  def('tyre', ['t'], { color: '#1a1a1a', roughness: 0.9 });
  // ---- site
  const dw = spec.site.driveway;
  if (dw === 'pavers') def('paving', ['p'], { roughness: 0.9 }, () => TEX.pavers({ base: '#a4553c' }));
  else if (dw === 'exposed') def('paving', ['e'], { roughness: 0.95 }, () => TEX.concrete('#a29c90', { spots: true, size: 2 }));
  else if (dw === 'charcoal') def('paving', ['ch'], { roughness: 0.85 }, () => TEX.concrete('#6a6a68', { size: 4 }));
  else def('paving', ['c'], { roughness: 0.9 }, () => TEX.concrete('#b9b6ae', { size: 5 }));
  def('slabEdge', ['s'], { roughness: 0.9 }, () => TEX.concrete('#b9b6ae', { size: 5 }));
  def('grass', ['g'], { roughness: 1 }, () => TEX.grass());
  def('gravel', ['g'], { roughness: 1 }, () => TEX.concrete('#b5aa98', { spots: true, size: 1.5 }));
  def('asphalt', ['a'], { roughness: 0.95 }, () => TEX.asphalt());
  def('kerb', ['k'], { color: '#b8b5ad', roughness: 0.9 });
  const fc = C('site', 'fenceColour', '#4B4C46');
  if (spec.site.fence === 'timber') def('fence', ['t'], { roughness: 0.85 }, () => TEX.boardFence());
  else if (spec.site.fence === 'slat') def('fence', ['s'], { roughness: 0.7 }, () => TEX.weatherboard('#6b4f38', { board: 0.09 }));
  else def('fence', ['c', fc], { roughness: 0.5, metalness: 0.3 }, () => TEX.corrugatedFence(fc));
  def('neighbourWall', ['n'], { roughness: 0.95 }, () => TEX.render('#d8cfc2'));
  def('neighbourRoof', ['n'], { roughness: 0.8 }, () => TEX.roofTiles('#6e6b66'));
  def('trunk', ['t'], { color: '#6d5a48', roughness: 1 });
  def('leaves', ['l'], { color: '#4f6b35', roughness: 0.9 });
  def('leavesDark', ['l'], { color: '#35502c', roughness: 0.9 });
  def('shrub', ['s'], { color: '#51703b', roughness: 0.95 });
  def('flower', ['f'], { color: '#b77ab0', roughness: 0.9 });
  def('mulch', ['m'], { color: '#4f3b2a', roughness: 1 });
  def('roadLine', ['r'], { color: '#f2f2f2', roughness: 0.8 });
  def('letterbox', ['l'], { color: '#2d2d2e', roughness: 0.5, metalness: 0.4 });
  def('pick', ['p'], { color: '#4aa3ff', roughness: 0.5, emissive: '#1a66cc', emissiveIntensity: 0.6, transparent: true, opacity: 0.55, depthWrite: false });
  return lib;
}

function corrugated() {
  // Custom Orb: sinusoidal 76 mm pitch normal map
  const w = 256, h = 4, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), img = x.createImageData(w, h);
  const waves = 8;
  for (let i = 0; i < w; i++) {
    const s = Math.cos(i / w * waves * Math.PI * 2) * 0.7, l = Math.hypot(s, 1);
    for (let j = 0; j < h; j++) { const k = (j * w + i) * 4; img.data[k] = (s / l * 0.5 + 0.5) * 255; img.data[k + 1] = 128; img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255; }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { normalMap: t, size: 0.608 };
}

export { PAINT, TILE, STONE };
