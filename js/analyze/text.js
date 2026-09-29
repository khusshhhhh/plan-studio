// Text understanding: room names, opening labels, fixture abbreviations and specification
// hints (roof pitch, ceiling heights, colours…) read from the drawing's notes and schedules.

export const ROOM_TYPES = [
  // [type, regex, default name]
  ['wir', /\bW\.?\s*I\.?\s*R\b|WALK[-\s]*IN[-\s]*ROBE/i, 'W.I.R'],
  ['robe', /\bB\.?\s*I\.?\s*R\b|\bROBE\b|WARDROBE/i, 'Robe'],
  ['pantry', /\bW\.?\s*I\.?\s*P\b|PANTRY|BUTLER|SCULLERY/i, 'Pantry'],
  ['ensuite', /\bENS\b|\bENS\.|ENSUITE/i, 'Ensuite'],
  ['wc', /\bW\.?C\b|TOILET|POWDER|\bPWD\b/i, 'WC'],
  ['bath', /\bBATH(ROOM)?\b/i, 'Bathroom'],
  ['laundry', /L'?\s*DRY|LAUNDRY|\bLDY\b|MUD\s*ROOM/i, 'Laundry'],
  ['kitchen', /KITCHEN|\bKIT\b/i, 'Kitchen'],
  ['dining', /DINING|\bMEALS\b|\bDINE\b/i, 'Dining'],
  ['living', /FAMILY|LIVING|LOUNGE|THEATRE|RUMPUS|MEDIA|ACTIVITY|GAMES|RETREAT/i, 'Living'],
  ['study', /STUDY|OFFICE|\bDEN\b|LIBRARY/i, 'Study'],
  ['bedroom', /BED\s*(ROOM)?\s*\d*|MASTER|GUEST|\bSUITE\b/i, 'Bedroom'],
  ['garage', /GARAGE|CARPORT|CAR\s*PARK/i, 'Garage'],
  ['outdoor', /ALFRESCO|PORCH|VERANDAH|VERANDA|DECK|PATIO|BALCONY|COURTYARD|PERGOLA|OUTDOOR/i, 'Alfresco'],
  ['hall', /ENTRY|FOYER|HALL|PASSAGE|GALLERY|CORRIDOR|LOBBY/i, 'Hall'],
  ['store', /LINEN|STORE|STORAGE|\bSTR\b|CUPBOARD|\bCPD\b|UTILITY/i, 'Store'],
];

export const WET = new Set(['ensuite', 'bath', 'wc', 'laundry']);

export function roomTypeOf(text) {
  const t = String(text || '').toUpperCase();
  if (t.length > 40) return null;
  if (/BULKHEAD|NICHE|OPENING|WINDOW|DOOR|WALL|CEILING|CL[:\s]|SCALE|PLAN|LAYOUT|ELEVATION|DENOTES|LEGEND/.test(t)) return null;
  for (const [type, re] of ROOM_TYPES) if (re.test(t)) return type;
  return null;
}

// Pretty room name from the drawing label ("BEDROOM 04" → "Bedroom 04", "ENS." → "Ensuite")
export function prettyRoomName(label, type) {
  const t = String(label).replace(/\s+/g, ' ').trim();
  const abbr = { 'ENS.': 'Ensuite', ENS: 'Ensuite', 'W.I.R': 'W.I.R (walk-in robe)', 'W.I.P': 'W.I.P (walk-in pantry)', "L'DRY": 'Laundry', 'B.I.R.': 'Robe', 'B.I.R': 'Robe', WC: 'WC' };
  if (abbr[t.toUpperCase()]) return abbr[t.toUpperCase()];
  return t.toLowerCase().replace(/(^|[\s(/&-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bWir\b/, 'W.I.R').replace(/\bWip\b/, 'W.I.P');
}

// Opening labels such as "2.4X3.048W (ASD)", "0.6X2.05W AFW", "2.1X0.9W FLAT ARCH OPENING",
// "2.4x4.8W PANEL LIFT DOOR", "2100 x 820" …  Returns {h, w, kind, style} in mm.
export function parseOpeningLabel(text) {
  const t = String(text || '').toUpperCase().replace(/\s+/g, ' ');
  const m = t.match(/(\d{1,4}(?:\.\d+)?)\s*[X×]\s*(\d{1,4}(?:\.\d+)?)\s*(W|WIDE)?/);
  let h = null, w = null;
  if (m) {
    let a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (a < 10) a *= 1000; if (b < 10) b *= 1000;
    // Australian convention is height x width
    h = a; w = b;
    if (!m[3] && h > 2800 && w <= 2800) [h, w] = [w, h];
  }
  let kind = null, style = null;
  if (/\bASD\b|SLIDING DOOR|STACKER|\bSD\b/.test(t)) { kind = 'slider'; style = 'ASD'; }
  else if (/PANEL LIFT|\bPLD\b|SECTIONAL|ROLLER|TILT DOOR|GARAGE DOOR/.test(t)) { kind = 'garage'; style = /ROLLER/.test(t) ? 'roller' : /TILT/.test(t) ? 'tilt' : 'panel'; }
  else if (/ARCH|OPENING|\bVOID\b/.test(t) && !/WINDOW/.test(t)) { kind = 'arch'; }
  else if (/\bASW\b|SLIDING WINDOW/.test(t)) { kind = 'win'; style = 'ASW'; }
  else if (/\bAAW\b|AWNING/.test(t)) { kind = 'win'; style = 'AAW'; }
  else if (/\bAFW\b|FIXED|FIX WINDOW/.test(t)) { kind = 'win'; style = 'AFW'; }
  else if (/\bADH\b|DOUBLE HUNG/.test(t)) { kind = 'win'; style = 'ADH'; }
  else if (/CASEMENT|\bACW\b/.test(t)) { kind = 'win'; style = 'ACW'; }
  else if (/LOUVRE/.test(t)) { kind = 'win'; style = 'LOUVRE'; }
  else if (/\bWINDOW\b/.test(t)) kind = 'win';
  else if (/CAVITY/.test(t)) { kind = 'door'; style = 'cavity'; }
  else if (/\bDOOR\b|\bHD\b|\bED\b/.test(t)) kind = 'door';
  const obscure = /OBSC|FROST|TRANSLUC/.test(t);
  if (!h && !w && !kind) return null;
  return { h, w, kind, style, obscure, text: String(text) };
}

// Fixture abbreviations commonly written on Australian plans
export const FIXTURE_ABBR = [
  ['wc', /^W\.?C\.?$/],
  ['shower', /^SH(R)?\.?$/],
  ['bath', /^B\.?T\.?$|^BATH TUB$/],
  ['vanity', /^V\.?$|^VAN(ITY)?$|^B(ASIN)?$/],
  ['sink', /^S\.?$|^SINK$/],
  ['tub', /^L\.?T\.?$|^TUB$|^TROUGH$/],
  ['washer', /^W\.?\/?M\.?$/],
  ['dryer', /^D\.?R\.?$/],
  ['fridge', /^F\.?$|^FR(IDGE)?$|^REF$/],
  ['dishwasher', /^D\.?\/?W\.?$/],
  ['cooktop', /^C\.?T\.?\b|CT\/OV|^OV\.?$|^R\.?H\.?D?\.?$|COOK/],
  ['microwave', /^M\.?\/?W\.?$/],
  ['hws', /^H\.?W\.?S\.?$/],
  ['tap', /^T\.?$/],
  ['downpipe', /^D\.?P\.?$/],
];

export function fixtureOf(text) {
  const t = String(text || '').toUpperCase().trim();
  if (t.length > 12) return null;
  for (const [type, re] of FIXTURE_ABBR) if (re.test(t)) return type;
  return null;
}

// Symbol (block) names → fixture / electrical types
const SYMBOL_TYPES = [
  // electrical
  ['elec', 'smoke', /SMOKE/i],
  ['elec', 'downlight', /DOWN\s*-?\s*LIGHT|\bDL\b|DOWNLIGHT/i],
  ['elec', 'pendant', /PEND[AE]NT|PENDENT|PENDANT/i],
  ['elec', 'walllight', /WALL\s*LIGHT|OUTDOOR\s*LIGHT|EXTERNAL\s*LIGHT|SPOT\s*LIGHT|FLOOD/i],
  ['elec', 'batten', /BATTEN|FLUORO|STRIP\s*LIGHT/i],
  ['elec', 'hle', /EXHAUST|HEAT\s*LIGHT|3\s*IN\s*1|HLE/i],
  ['elec', 'fan', /CEILING\s*FAN/i],
  ['elec', 'gpo', /GPO|POWER\s*POINT|SOCKET|OUTLET(?!.*(TV|N\.?B\.?N|TEL|DATA))/i],
  ['elec', 'switch2', /2\s*WAY/i],
  ['elec', 'switch', /SWITCH|GANG/i],
  ['elec', 'tv', /\bTV\b|TELEVISION|ANTENNA/i],
  ['elec', 'phone', /TELEPHONE|PHONE|\bTEL\b/i],
  ['elec', 'nbnOutlet', /N\.?B\.?N\.?\s*OUTLET|DATA|CAT\s*6|\bLAN\b/i],
  ['elec', 'nbnBox', /N\.?B\.?N|NBN/i],
  ['elec', 'security', /SECURITY|SENSOR|\bPIR\b|ALARM/i],
  ['elec', 'acPanel', /AC\s*INDOOR|CONTROL\s*PANEL|THERMOSTAT|A\/C\s*PANEL/i],
  ['elec', 'hws', /HOT\s*WATER|\bHWS\b/i],
  ['elec', 'acUnit', /COMPRESSOR|CONDENSER/i],
  // fixtures
  ['fix', 'wc', /\bWC\b|TOILET|\bPAN\b|W\.C/i],
  ['fix', 'bath', /\bBATH\b|BATHTUB/i],
  ['fix', 'shower', /SHOWER/i],
  ['fix', 'vanity', /BASIN|VANITY/i],
  ['fix', 'sink', /SINK|SS\d{3,}/i],
  ['fix', 'tub', /TROUGH|LAUNDRY\s*TUB/i],
  ['fix', 'cooktop', /COOK\s*TOP|HOB|OVEN|STOVE/i],
  ['fix', 'fridge', /FRIDGE|REFRIG/i],
  ['fix', 'washer', /WASH(ING)?\s*MACH/i],
  ['fix', 'bed', /\bBED\b|BED-|QUEEN|KING/i],
  ['fix', 'car', /\bCARS?\b|VEHIC/i],
  ['fix', 'tap', /^TAP$|GARDEN\s*TAP/i],
  ['fix', 'downpipe', /DOWN\s*PIPE|^DP$/i],
  ['fix', 'drain', /FLOOR\s*DRAIN|\bFW\b/i],
  ['door', 'door', /DOOR/i],
  ['win', 'window', /WINDOW/i],
];

export function symbolTypeOf(name) {
  for (const [cat, type, re] of SYMBOL_TYPES) if (re.test(name)) {
    if (cat === 'elec' && type === 'switch') {
      const g = String(name).match(/(\d)\s*GANG/i);
      return { cat, type, gang: g ? +g[1] : 1 };
    }
    return { cat, type };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Specification hints from notes & schedules anywhere in the drawing set.
// ---------------------------------------------------------------------------
export const COLORBOND_NAMES = ['Monument', 'Basalt', 'Woodland Grey', 'Night Sky', 'Surfmist', 'Shale Grey', 'Windspray', 'Dune', 'Jasper', 'Ironstone', 'Wallaby', 'Evening Haze', 'Classic Cream', 'Paperbark', 'Deep Ocean', 'Cottage Green', 'Manor Red', 'Terrain', 'Pale Eucalypt', 'Gully', 'Bluegum', 'Cove', 'Southerly', 'Mangrove', 'Dover White'];

export function specHints(texts) {
  const all = texts.map(t => (typeof t === 'string' ? t : t.t)).join('\n');
  const U = all.toUpperCase();
  const H = {};
  const set = (path, value, why) => { H[path] = { value, why }; };

  let m = U.match(/(\d{1,2}(?:\.\d)?)\s*°\s*(?:ROOF\s*)?PITCH|PITCH\s*[@:]?\s*(\d{1,2}(?:\.\d)?)\s*°|ROOF\s*[@A-Z\s]*?(\d{1,2}(?:\.\d)?)\s*°|@\s*(\d{1,2}(?:\.\d)?)\s*°/);
  if (m) { const v = parseFloat(m[1] || m[2] || m[3] || m[4]); if (v >= 2 && v <= 50) set('roof.pitch', v, `"${m[0].trim()}"`); }
  m = U.match(/(\d{3})\s*(?:MM)?\s*(?:WIDE\s*)?EAVES?/);
  if (m) { const v = +m[1]; if (v >= 0 && v <= 1200) set('roof.eave', v, `"${m[0].trim()}"`); }
  if (/COLORBOND\s*(ROOF|STEEL ROOF)|ROOF[^\n]{0,30}COLORBOND|METAL\s*ROOF|CUSTOM\s*ORB|KLIP-?LOK/.test(U)) set('roof.material', 'colorbond', 'Colorbond roof noted');
  else if (/ROOF\s*TILE|TILED\s*ROOF|CONCRETE\s*TILE|TERRACOTTA/.test(U)) set('roof.material', 'tile', 'Roof tiles noted');
  if (/SKILLION/.test(U)) set('roof.type', 'skillion', 'Skillion roof noted');
  else if (/GABLE/.test(U)) set('roof.type', 'gable', 'Gable noted');
  else if (/\bHIP\b|HIPPED/.test(U)) set('roof.type', 'hip', 'Hip roof noted');
  else if (/FLAT\s*ROOF|PARAPET/.test(U)) set('roof.type', 'flat', 'Flat roof/parapet noted');

  // Ceiling heights: most common "CL 2700"
  const cls = [...U.matchAll(/C\.?L\.?\s*[:=]?\s*(\d{4})/g)].map(x => +x[1]).filter(v => v >= 2100 && v <= 4500);
  if (cls.length) {
    // the lowest CL is the general ceiling; higher ones are raised areas
    const best = Math.min(...cls);
    set('structure.ceiling', best, `CL ${best} on the plan`);
    const hi = Math.max(...cls);
    if (hi > best) set('structure.raised', hi, `CL ${hi} raised ceiling on the plan`);
  }
  m = U.match(/INTERNAL\s*DOOR\s*HEIGHTS?\s*[-–:=]*\s*(\d{4})/);
  if (m) set('doors.intHeight', +m[1], `"${m[0].trim()}"`);
  m = U.match(/EXTERNAL\s*DOOR\s*HEIGHTS?\s*[-–:=]*\s*(\d{4})/);
  if (m) set('doors.extHeight', +m[1], `"${m[0].trim()}"`);
  m = U.match(/(?:WINDOW\s*HEAD|LINTEL)\s*(?:HEIGHTS?)?\s*[-–:=@]*\s*(\d{4})/);
  if (m) set('windows.head', +m[1], `"${m[0].trim()}"`);

  // External finishes
  if (/HEBEL/.test(U)) set('exterior.wallMaterial', 'render', 'Hebel panel (rendered) noted');
  else if (/FACE\s*BRICK|BRICK\s*VENEER|\bBRICKWORK\b/.test(U)) set('exterior.wallMaterial', 'brick', 'Brickwork noted');
  else if (/WEATHERBOARD|LINEA|SCYON/.test(U)) set('exterior.wallMaterial', 'weatherboard', 'Weatherboard noted');
  else if (/RENDER/.test(U)) set('exterior.wallMaterial', 'render', 'Render noted');
  if (/PANEL\s*LIFT/.test(U)) set('garage.doorType', 'panel', 'Panel lift door noted');
  else if (/ROLLER\s*DOOR/.test(U)) set('garage.doorType', 'roller', 'Roller door noted');

  // Colours next to keywords (schedule lines)
  const lines = all.split(/\n/);
  const findColour = (kw) => {
    for (const ln of lines) {
      if (!kw.test(ln)) continue;
      for (const c of COLORBOND_NAMES) if (new RegExp('\\b' + c + '\\b', 'i').test(ln)) return c;
    }
    return null;
  };
  const rc = findColour(/ROOF/i); if (rc) set('roof.colour', rc, `Roof colour ${rc} in the schedule`);
  const gc = findColour(/GUTTER|FASCIA/i); if (gc) set('roof.gutterColour', gc, `Gutter colour ${gc} in the schedule`);
  const wc = findColour(/WINDOW|FRAME|ALUMIN/i); if (wc) set('windows.frameColour', wc, `Window frames ${wc} in the schedule`);
  const pc = findColour(/PANEL[-\s]*LIFT|GARAGE/i); if (pc) set('garage.colour', pc, `Garage door ${pc} in the schedule`);

  // Site / address
  // Site address – the one written after "at" in the title block beats the designer's office
  const flat = all.replace(/\s*\n\s*/g, ' ');
  const addrRe = /\b(\d+[A-Z]?\s+[A-Z][A-Za-z]+(?:\s+[A-Za-z]+)*\s+(?:ST|STREET|RD|ROAD|CR|CRES|CRESCENT|AVE|AVENUE|CT|COURT|DR|DRIVE|PL|PLACE|WAY|TCE|TERRACE|LANE|LN|BVD|BOULEVARD|PDE|PARADE|CL|CLOSE|GR|GROVE)\b[^|]{0,40}?\b(SA|NSW|VIC|QLD|WA|TAS|NT|ACT)\b(?:\s*\d{4})?)/gi;
  const cands = [...flat.matchAll(addrRe)].map(x => {
    const before = flat.slice(Math.max(0, x.index - 14), x.index);
    return { s: x[1], st: x[2], at: /\bat\s*$/i.test(before) ? 1 : 0, office: /No\s*:|Tel|Office|Unit\s*$/i.test(before) ? 1 : 0 };
  });
  cands.sort((a, b) => (b.at - a.at) || (a.office - b.office));
  m = cands.length ? [null, cands[0].s, cands[0].st] : null;
  if (m) set('site.address', m[1].replace(/\s+/g, ' ').trim(), 'Address in the title block');
  const st = (m && m[2]) || (U.match(/\b(SA|NSW|VIC|QLD|WA|TAS|NT|ACT)\s+\d{4}\b/) || [])[1];
  if (st) set('site.state', st.toUpperCase(), `State ${st.toUpperCase()} from the title block`);
  return H;
}

export const STATE_LOC = {
  SA: { lat: -34.93, lon: 138.60, tz: 9.5, dst: true, city: 'Adelaide' },
  NSW: { lat: -33.87, lon: 151.21, tz: 10, dst: true, city: 'Sydney' },
  VIC: { lat: -37.81, lon: 144.96, tz: 10, dst: true, city: 'Melbourne' },
  QLD: { lat: -27.47, lon: 153.03, tz: 10, dst: false, city: 'Brisbane' },
  WA: { lat: -31.95, lon: 115.86, tz: 8, dst: false, city: 'Perth' },
  TAS: { lat: -42.88, lon: 147.33, tz: 10, dst: true, city: 'Hobart' },
  NT: { lat: -12.46, lon: 130.84, tz: 9.5, dst: false, city: 'Darwin' },
  ACT: { lat: -35.28, lon: 149.13, tz: 10, dst: true, city: 'Canberra' },
};

// Plot scale printed on a sheet, e.g. "SCALE 1:100", "1 : 200 @ A3"
export function scalesInText(texts) {
  const out = [];
  for (const t of texts) {
    const s = typeof t === 'string' ? t : t.t;
    for (const m of String(s).matchAll(/\b1\s*:\s*(\d{2,4})\b/g)) {
      const v = +m[1];
      if ([20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 1000].includes(v)) out.push({ denom: v, t });
    }
  }
  return out;
}
