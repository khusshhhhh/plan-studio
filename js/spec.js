// Specification catalogue: every question the app asks, its options and defaults.
// A "spec" is a plain object {group: {key: value}}; hints read from the drawing pre-fill it.

export const COLORBOND = {
  Monument: '#323233', Basalt: '#6D6C6E', 'Woodland Grey': '#4B4C46', 'Night Sky': '#1D1D1F', Surfmist: '#E4E2D5',
  'Shale Grey': '#BDBFBA', Windspray: '#888B8A', Dune: '#B1ADA3', Jasper: '#6C6153', Ironstone: '#3E434C',
  Wallaby: '#7F7C78', 'Evening Haze': '#C5C2AA', 'Classic Cream': '#E9DCB8', Paperbark: '#CABFA4',
  'Deep Ocean': '#364152', 'Cottage Green': '#304C3C', 'Manor Red': '#5E1D0E', Terrain: '#67432E',
  'Pale Eucalypt': '#7C846A', Gully: '#857E71', Bluegum: '#969799', Cove: '#A59F8A', Southerly: '#D2D1CB', Mangrove: '#737562',
};
export const PAINT = {
  'Lexicon Quarter': '#F1F1EC', 'Natural White': '#F5F0E3', 'Vivid White': '#F7F7F5', 'Whisper White': '#EFEDE6', 'Hog Bristle': '#E4DCC6',
  'Grey Pail': '#D5D4CF', 'Timeless Grey': '#C9C7C0', 'Charmed White': '#ECE9E1', 'Dover White': '#EFEEE5', 'Western Myall': '#8C8676',
  'Wayward Grey': '#5D5B57', 'Tranquil Retreat': '#C7CEC6', 'Terrace White': '#E8E3D6', Domino: '#39393A', 'Monument (paint)': '#323233',
  'Sage Green': '#9CA792', 'Dusty Blue': '#8F9FAE', 'Warm Clay': '#B58D73', 'Black': '#1B1B1B',
};
export const TIMBER = { 'Spotted Gum': '#9a6a43', Blackbutt: '#c29a6b', Merbau: '#6e3b24', 'Natural Oak': '#b48a5e', 'Light Oak': '#cfae85', 'Smoked Oak': '#7d634b', Walnut: '#5b3f2c', 'Charcoal stain': '#3a3531' };
export const STONE = { 'Pure White': '#f2f1ec', 'Calacatta look': '#eeece6', 'Soft Concrete': '#b9b6ae', 'Warm Beige': '#d8cdb9', 'Oyster Grey': '#cfccc4', 'Jet Black': '#1e1e1f', 'Terrazzo': '#ddd8cc' };
export const METAL = {
  Chrome: { c: '#e6e6e6', m: 1, r: 0.08 }, 'Matte black': { c: '#171717', m: 0.3, r: 0.5 }, 'Brushed nickel': { c: '#c0bcb3', m: 1, r: 0.32 },
  'Brushed brass': { c: '#c5a263', m: 1, r: 0.3 }, 'Polished brass': { c: '#d8b56a', m: 1, r: 0.1 }, Gunmetal: { c: '#4b4b4e', m: 1, r: 0.35 },
  'Brushed copper': { c: '#b87352', m: 1, r: 0.32 }, 'Stainless steel': { c: '#c9ccce', m: 0.9, r: 0.28 }, White: { c: '#f4f4f2', m: 0, r: 0.4 },
};
export const TILE = { 'White matt': '#eeede9', 'White gloss': '#f4f4f2', 'Light grey': '#d4d2cc', 'Warm grey': '#cfc8bd', 'Mid grey': '#9d9a94', Charcoal: '#57554f', 'Sand': '#d9ccb4', 'Sage': '#a7b19c', 'Terracotta': '#b86a4b', 'Navy': '#2f3d55', 'Black': '#222222' };
export const CARPET = { 'Pebble Grey': '#8d8a85', Oatmeal: '#b3a58f', 'Silver Mist': '#a9a8a4', Charcoal: '#555451', Mushroom: '#9a8b7c', 'Ocean Blue': '#5f6f7d' };
export const BRICK = { 'Red blend': '#8e4a36', 'Cream': '#d9c7a4', 'Charcoal': '#4a4745', 'Mixed grey': '#8a8783', 'Sandstock': '#c49d74', 'Painted white': '#ecebe6', 'Chocolate': '#5a3a2c' };
export const ROOFTILE = { Charcoal: '#3b3b3c', 'Slate grey': '#5b5f63', Terracotta: '#9b4a2c', Sandstone: '#b8a483', 'Barramundi': '#7f7f78', Black: '#1f1f20' };

const pal = (o) => Object.keys(o);
const opt = (value, label, extra = {}) => ({ value, label, ...extra });

// type: 'select' | 'number' | 'color' | 'toggle' | 'text'
// palette: name of a colour palette → options are the palette's names (swatches)
export const GROUPS = [
  {
    id: 'site', title: 'Site & location', icon: '📍', questions: [
      { key: 'address', label: 'Site address', type: 'text', def: '' },
      { key: 'state', label: 'State / region (sets sun position & time zone)', type: 'select', def: 'SA', options: ['SA', 'NSW', 'VIC', 'QLD', 'WA', 'TAS', 'NT', 'ACT', 'Other'].map(v => opt(v, v)) },
      { key: 'lat', label: 'Latitude', type: 'number', def: -34.93, step: 0.001, adv: true },
      { key: 'lon', label: 'Longitude', type: 'number', def: 138.6, step: 0.001, adv: true },
      { key: 'north', label: 'North direction (degrees clockwise from "up" on the plan)', type: 'number', def: 0, min: -180, max: 180, step: 0.5, unit: '°' },
      { key: 'streetSide', label: 'Street side', type: 'select', def: 'auto', options: [opt('auto', 'Automatic (garage door / entry side)'), opt('S', 'Bottom of plan'), opt('N', 'Top of plan'), opt('E', 'Right of plan'), opt('W', 'Left of plan')] },
      { key: 'frontSetback', label: 'Front setback to boundary', type: 'number', def: 6000, min: 1000, max: 20000, step: 100, unit: 'mm' },
      { key: 'driveway', label: 'Driveway & paths', type: 'select', def: 'concrete', options: [opt('concrete', 'Plain concrete'), opt('exposed', 'Exposed aggregate'), opt('pavers', 'Brick pavers'), opt('charcoal', 'Charcoal coloured concrete')] },
      { key: 'fence', label: 'Boundary fence', type: 'select', def: 'colorbond', options: [opt('none', 'None'), opt('colorbond', 'Colorbond 1.8 m'), opt('timber', 'Timber paling 1.8 m'), opt('slat', 'Horizontal slat 1.5 m')] },
      { key: 'fenceColour', label: 'Fence colour', type: 'color', palette: 'COLORBOND', def: 'Woodland Grey', show: s => s.site.fence === 'colorbond' },
      { key: 'landscape', label: 'Landscaping', type: 'select', def: 'lawn', options: [opt('lawn', 'Lawn with garden beds & trees'), opt('lawnOnly', 'Lawn only'), opt('gravel', 'Gravel & native planting')] },
      { key: 'neighbours', label: 'Neighbouring houses (context)', type: 'toggle', def: true },
    ],
  },
  {
    id: 'structure', title: 'Structure & heights', icon: '📐', questions: [
      { key: 'ceiling', label: 'Ceiling height', type: 'select', def: 2700, options: [2400, 2550, 2590, 2700, 2850, 3000, 3300].map(v => opt(v, v + ' mm')), custom: true, unit: 'mm' },
      { key: 'raised', label: 'Raised ceiling height (where marked on the plan)', type: 'number', def: 3000, min: 2400, max: 4500, step: 50, unit: 'mm' },
      { key: 'slab', label: 'Floor level above ground', type: 'number', def: 150, min: 0, max: 1200, step: 10, unit: 'mm' },
      { key: 'garageStep', label: 'Garage floor step down', type: 'number', def: 100, min: 0, max: 400, step: 10, unit: 'mm' },
      { key: 'outdoorStep', label: 'Alfresco / porch step down', type: 'number', def: 50, min: 0, max: 400, step: 10, unit: 'mm' },
      { key: 'columnSize', label: 'Porch / alfresco column size', type: 'number', def: 350, min: 90, max: 600, step: 10, unit: 'mm' },
      { key: 'beams', label: 'Bulkhead beams around alfresco & porch', type: 'toggle', def: true },
    ],
  },
  {
    id: 'roof', title: 'Roof', icon: '🏠', questions: [
      { key: 'type', label: 'Roof type', type: 'select', def: 'hip', options: [opt('hip', 'Hip'), opt('gable', 'Gable'), opt('skillion', 'Skillion (mono-pitch)'), opt('flat', 'Flat with parapet')] },
      { key: 'pitch', label: 'Roof pitch', type: 'select', def: 22.5, options: [5, 10, 15, 20, 22.5, 25, 27.5, 30, 35, 40].map(v => opt(v, v + '°')), custom: true, unit: '°', show: s => s.roof.type !== 'flat' },
      { key: 'eave', label: 'Eave width', type: 'select', def: 450, options: [0, 300, 450, 600, 750, 900].map(v => opt(v, v ? v + ' mm' : 'No eaves')), custom: true, unit: 'mm', show: s => s.roof.type !== 'flat' },
      { key: 'material', label: 'Roof material', type: 'select', def: 'colorbond', options: [opt('colorbond', 'Colorbond – Custom Orb (corrugated)'), opt('kliplok', 'Colorbond – Klip-Lok (trimdeck)'), opt('tile', 'Concrete tile'), opt('terracotta', 'Terracotta tile')], show: s => s.roof.type !== 'flat' },
      { key: 'colour', label: 'Roof colour', type: 'color', palette: s => (s.roof.material === 'tile' || s.roof.material === 'terracotta') ? 'ROOFTILE' : 'COLORBOND', def: 'Monument' },
      { key: 'gutterProfile', label: 'Gutter profile', type: 'select', def: 'D', options: [opt('D', "'D' profile"), opt('quad', 'Quad'), opt('square', 'Square line'), opt('half', 'Half round'), opt('box', 'Box / concealed')], show: s => s.roof.type !== 'flat' },
      { key: 'gutterColour', label: 'Gutter & fascia colour', type: 'color', palette: 'COLORBOND', def: 'Monument' },
      { key: 'downpipe', label: 'Downpipes', type: 'select', def: 'round', options: [opt('round', '90 mm round'), opt('square', '100×50 rectangular'), opt('none', 'Hidden / none')] },
      { key: 'downpipeColour', label: 'Downpipe colour', type: 'color', palette: 'COLORBOND', def: 'Monument' },
      { key: 'soffit', label: 'Eave lining (soffit) colour', type: 'color', palette: 'PAINT', def: 'Lexicon Quarter' },
    ],
  },
  {
    id: 'exterior', title: 'External walls', icon: '🧱', questions: [
      { key: 'wallMaterial', label: 'Main wall finish', type: 'select', def: 'render', options: [opt('render', 'Render / Hebel (painted)'), opt('brick', 'Face brick'), opt('weatherboard', 'Weatherboard'), opt('vertical', 'Vertical cladding (Axon/Linea)'), opt('stone', 'Stacked stone'), opt('panel', 'Fibre-cement panels')] },
      { key: 'wallColour', label: 'Main wall colour', type: 'color', palette: s => s.exterior.wallMaterial === 'brick' ? 'BRICK' : s.exterior.wallMaterial === 'stone' ? 'STONE' : 'PAINT', def: 'Charmed White' },
      { key: 'mortar', label: 'Mortar joints', type: 'select', def: 'light', options: [opt('light', 'Off-white'), opt('grey', 'Grey'), opt('dark', 'Charcoal')], show: s => s.exterior.wallMaterial === 'brick' },
      { key: 'featureMaterial', label: 'Feature finish (piers, columns & entry porch walls)', type: 'select', def: 'render', options: [opt('render', 'Render (painted)'), opt('brick', 'Face brick'), opt('stone', 'Stacked stone'), opt('timber', 'Timber-look cladding'), opt('vertical', 'Vertical cladding'), opt('same', 'Same as main walls')] },
      { key: 'featureColour', label: 'Feature colour', type: 'color', palette: s => ({ brick: 'BRICK', stone: 'STONE', timber: 'TIMBER' })[s.exterior.featureMaterial] || 'PAINT', def: 'Wayward Grey', show: s => s.exterior.featureMaterial !== 'same' },
      { key: 'beamFinish', label: 'Bulkhead / beam finish', type: 'select', def: 'timber', options: [opt('timber', 'Timber look'), opt('paint', 'Painted (wall colour)'), opt('feature', 'Feature colour')] },
      { key: 'beamTimber', label: 'Timber colour', type: 'color', palette: 'TIMBER', def: 'Spotted Gum', show: s => s.exterior.beamFinish === 'timber' },
    ],
  },
  {
    id: 'windows', title: 'Windows & sliding doors', icon: '🪟', questions: [
      { key: 'frameColour', label: 'Frame colour', type: 'color', palette: 'COLORBOND', def: 'Monument' },
      { key: 'style', label: 'Window style (where the plan does not say)', type: 'select', def: 'AAW', options: [opt('AAW', 'Awning'), opt('ASW', 'Sliding'), opt('AFW', 'Fixed'), opt('ADH', 'Double hung'), opt('ACW', 'Casement'), opt('LOUVRE', 'Louvre')] },
      { key: 'head', label: 'Window head height', type: 'select', def: 2400, options: [2100, 2340, 2400, 2550, 2700].map(v => opt(v, v + ' mm')), custom: true, unit: 'mm' },
      { key: 'height', label: 'Window height (where the plan does not say)', type: 'number', def: 1500, min: 300, max: 2700, step: 10, unit: 'mm' },
      { key: 'wetHeight', label: 'Bathroom window height', type: 'number', def: 900, min: 300, max: 2100, step: 10, unit: 'mm' },
      { key: 'glass', label: 'Glass', type: 'select', def: 'clear', options: [opt('clear', 'Clear'), opt('grey', 'Grey tint'), opt('bronze', 'Bronze tint'), opt('lowe', 'Low-E (blue-green)')] },
      { key: 'obscureWet', label: 'Obscure glass in bathrooms, ensuite & WC', type: 'toggle', def: true },
      { key: 'coverings', label: 'Window coverings', type: 'select', def: 'none', options: [opt('none', 'None'), opt('roller', 'Roller blinds'), opt('sheer', 'Sheer curtains'), opt('shutters', 'Plantation shutters')] },
      { key: 'sliderPanels', label: 'Sliding door panels', type: 'select', def: 2, options: [opt(2, '2 panels (1 slides)'), opt(3, '3-panel stacker'), opt(4, '4-panel stacker')] },
    ],
  },
  {
    id: 'doors', title: 'Doors', icon: '🚪', questions: [
      { key: 'entryStyle', label: 'Entry door style', type: 'select', def: 'glassStrip', options: [opt('flush', 'Flush'), opt('grooves', 'Horizontal grooves'), opt('vgroove', 'Vertical V-groove'), opt('glassStrip', 'Timber with glass strip'), opt('pivot', 'Wide timber pivot'), opt('glassPanel', 'Framed glass panel'), opt('farmhouse', 'Farmhouse / shaker')] },
      { key: 'entryColour', label: 'Entry door colour / timber', type: 'color', palette: s => ['glassStrip', 'pivot', 'vgroove'].includes(s.doors.entryStyle) ? 'TIMBER' : 'PAINT', def: 'Spotted Gum' },
      { key: 'entryWidth', label: 'Entry door leaf width', type: 'select', def: 1020, options: [820, 870, 920, 1020, 1200, 1500].map(v => opt(v, v + ' mm')), custom: true, unit: 'mm' },
      { key: 'extHeight', label: 'External door height', type: 'select', def: 2400, options: [2040, 2100, 2340, 2400, 2700].map(v => opt(v, v + ' mm')), custom: true, unit: 'mm' },
      { key: 'entryHandle', label: 'Entry door handle', type: 'select', def: 'pull', options: [opt('pull', 'Long pull handle'), opt('lever', 'Lever'), opt('knob', 'Knob')] },
      { key: 'extDoorStyle', label: 'Other external hinged doors', type: 'select', def: 'flush', options: [opt('flush', 'Flush'), opt('halfGlass', 'Half glazed'), opt('glass', 'Full glass (framed)')] },
      { key: 'extDoorColour', label: 'External door colour', type: 'color', palette: 'PAINT', def: 'Dover White' },
      { key: 'intStyle', label: 'Internal door style', type: 'select', def: 'flush', options: [opt('flush', 'Flush'), opt('shaker', 'Shaker (1 panel)'), opt('twoPanel', 'Two panel'), opt('grooves', '3 horizontal grooves'), opt('vgroove', 'Vertical V-groove'), opt('glass', 'Glass (black frame)'), opt('barn', 'Barn slider')] },
      { key: 'intColour', label: 'Internal door colour', type: 'color', palette: 'PAINT', def: 'Vivid White' },
      { key: 'intHeight', label: 'Internal door height', type: 'select', def: 2100, options: [2040, 2100, 2340, 2400, 2700].map(v => opt(v, v + ' mm')), custom: true, unit: 'mm' },
      { key: 'archHeight', label: 'Flat arch opening height', type: 'select', def: 2100, options: [2100, 2340, 2400, 2700].map(v => opt(v, v + ' mm')), custom: true, unit: 'mm' },
      { key: 'handle', label: 'Door handles', type: 'select', def: 'lever', options: [opt('lever', 'Lever'), opt('knob', 'Round knob'), opt('pull', 'Pull (flush / barn)')] },
      { key: 'hardware', label: 'Door hardware finish', type: 'color', palette: 'METAL', def: 'Matte black' },
      { key: 'architrave', label: 'Architraves', type: 'select', def: 66, options: [opt(0, 'None (square set)'), opt(42, '42 mm'), opt(66, '66 mm'), opt(92, '92 mm')] },
      { key: 'skirting', label: 'Skirting height', type: 'select', def: 92, options: [opt(0, 'None / shadowline'), opt(68, '68 mm'), opt(92, '92 mm'), opt(135, '135 mm')] },
      { key: 'openInternal', label: 'Show internal doors open', type: 'toggle', def: true },
    ],
  },
  {
    id: 'garage', title: 'Garage door', icon: '🚗', questions: [
      { key: 'doorType', label: 'Door type', type: 'select', def: 'panel', options: [opt('panel', 'Panel lift (sectional)'), opt('roller', 'Roller door'), opt('tilt', 'Tilt door'), opt('timberPanel', 'Timber-look sectional')] },
      { key: 'colour', label: 'Garage door colour', type: 'color', palette: 'COLORBOND', def: 'Basalt' },
      { key: 'height', label: 'Garage door height', type: 'select', def: 2400, options: [2100, 2400, 2700].map(v => opt(v, v + ' mm')), custom: true, unit: 'mm' },
      { key: 'cars', label: 'Show cars', type: 'toggle', def: true },
    ],
  },
  {
    id: 'kitchen', title: 'Kitchen', icon: '🍳', questions: [
      { key: 'island', label: 'Island bench', type: 'select', def: 'auto', options: [opt('auto', 'Automatic (from plan)'), opt('yes', 'Yes'), opt('no', 'No')] },
      { key: 'waterfall', label: 'Waterfall island ends', type: 'toggle', def: true },
      { key: 'benchtop', label: 'Benchtop', type: 'color', palette: 'STONE', def: 'Calacatta look' },
      { key: 'benchThickness', label: 'Benchtop thickness', type: 'select', def: 40, options: [20, 40, 60, 80].map(v => opt(v, v + ' mm')) },
      { key: 'cabinetStyle', label: 'Cabinet doors', type: 'select', def: 'flat', options: [opt('flat', 'Flat (2-pac / laminate)'), opt('shaker', 'Shaker'), opt('vgroove', 'V-groove'), opt('fluted', 'Fluted / ribbed')] },
      { key: 'baseColour', label: 'Base cabinet colour', type: 'color', palette: 'PAINT', def: 'Vivid White', allowTimber: true },
      { key: 'islandColour', label: 'Island cabinet colour', type: 'color', palette: 'PAINT', def: 'Natural Oak', allowTimber: true },
      { key: 'overheads', label: 'Overhead cabinets', type: 'select', def: 'yes', options: [opt('yes', 'Overhead cupboards'), opt('shelf', 'Open shelving'), opt('none', 'None')] },
      { key: 'overheadColour', label: 'Overhead colour', type: 'color', palette: 'PAINT', def: 'Vivid White', allowTimber: true },
      { key: 'handles', label: 'Handles', type: 'select', def: 'finger', options: [opt('finger', 'Finger pull / handleless'), opt('bar', 'Bar handles'), opt('knob', 'Knobs'), opt('lip', 'Edge pull')] },
      { key: 'handleFinish', label: 'Handle finish', type: 'color', palette: 'METAL', def: 'Matte black' },
      { key: 'splashback', label: 'Splashback', type: 'select', def: 'subway', options: [opt('subway', 'Subway tile'), opt('finger', 'Finger / kit-kat tile'), opt('glass', 'Glass'), opt('stone', 'Same stone as benchtop'), opt('mirror', 'Mirror')] },
      { key: 'splashColour', label: 'Splashback colour', type: 'color', palette: 'TILE', def: 'White gloss', show: s => ['subway', 'finger', 'glass'].includes(s.kitchen.splashback) },
      { key: 'appliances', label: 'Appliances', type: 'select', def: 'steel', options: [opt('steel', 'Stainless steel'), opt('black', 'Black'), opt('integrated', 'Integrated (panelled)')] },
      { key: 'cooktop', label: 'Cooktop', type: 'select', def: 'gas', options: [opt('gas', 'Gas'), opt('induction', 'Induction')] },
      { key: 'rangehood', label: 'Rangehood', type: 'select', def: 'integrated', options: [opt('integrated', 'Integrated (in cabinet)'), opt('canopy', 'Canopy'), opt('island', 'Ceiling / island')] },
      { key: 'sink', label: 'Sink', type: 'select', def: 'double', options: [opt('double', 'Double bowl undermount'), opt('single', 'Single bowl'), opt('butler', 'Butler (farmhouse)')] },
      { key: 'tapware', label: 'Kitchen mixer finish', type: 'color', palette: 'METAL', def: 'Chrome' },
      { key: 'pendants', label: 'Pendant lights over island', type: 'select', def: 'dome', options: [opt('dome', 'Dome'), opt('globe', 'Glass globe'), opt('linear', 'Linear'), opt('none', 'None')] },
    ],
  },
  {
    id: 'bathroom', title: 'Bathrooms, ensuite & WC', icon: '🛁', questions: [
      { key: 'vanity', label: 'Vanity style', type: 'select', def: 'wall', options: [opt('wall', 'Wall hung'), opt('floor', 'Floor standing'), opt('open', 'Open shelf')] },
      { key: 'vanityColour', label: 'Vanity colour / timber', type: 'color', palette: 'TIMBER', def: 'Natural Oak', allowPaint: true },
      { key: 'vanityTop', label: 'Vanity top', type: 'color', palette: 'STONE', def: 'Pure White' },
      { key: 'basin', label: 'Basin', type: 'select', def: 'above', options: [opt('above', 'Above counter (oval)'), opt('rect', 'Above counter (rectangle)'), opt('under', 'Undermount')] },
      { key: 'tapware', label: 'Tapware finish', type: 'color', palette: 'METAL', def: 'Matte black' },
      { key: 'screen', label: 'Shower screen', type: 'select', def: 'frameless', options: [opt('frameless', 'Frameless'), opt('semi', 'Semi-frameless'), opt('black', 'Black framed'), opt('fluted', 'Fluted glass'), opt('walkin', 'Walk-in panel')] },
      { key: 'floorTile', label: 'Floor tiles', type: 'color', palette: 'TILE', def: 'Light grey' },
      { key: 'wallTile', label: 'Wall tiles', type: 'color', palette: 'TILE', def: 'White matt' },
      { key: 'tileSize', label: 'Wall tile size', type: 'select', def: '300x600', options: ['300x600', '600x600', '75x300 subway', '100x100'].map(v => opt(v, v)) },
      { key: 'tileHeight', label: 'Wall tile height', type: 'select', def: 'shower', options: [opt('full', 'Floor to ceiling'), opt('1200', '1200 mm'), opt('shower', 'Shower full height, skirting elsewhere'), opt('splash', 'Splashback only')] },
      { key: 'featureTile', label: 'Shower feature tile', type: 'color', palette: 'TILE', def: 'Mid grey', allowNone: true },
      { key: 'niche', label: 'Shower niche', type: 'toggle', def: true },
      { key: 'bath', label: 'Bath', type: 'select', def: 'auto', options: [opt('auto', 'Automatic (from plan / room size)'), opt('freestanding', 'Freestanding'), opt('inset', 'Inset'), opt('none', 'None')] },
      { key: 'toilet', label: 'Toilet', type: 'select', def: 'btw', options: [opt('btw', 'Back to wall'), opt('wallFaced', 'Wall faced with cistern'), opt('wallHung', 'Wall hung (in-wall cistern)')] },
      { key: 'mirror', label: 'Mirror', type: 'select', def: 'frameless', options: [opt('frameless', 'Frameless rectangle'), opt('round', 'Round'), opt('arch', 'Arch'), opt('cabinet', 'Shaving cabinet')] },
    ],
  },
  {
    id: 'laundry', title: 'Laundry & pantry', icon: '🧺', questions: [
      { key: 'colour', label: 'Laundry cabinetry colour', type: 'color', palette: 'PAINT', def: 'Vivid White', allowTimber: true },
      { key: 'tub', label: 'Laundry tub', type: 'select', def: 'steel', options: [opt('steel', 'Stainless steel'), opt('ceramic', 'Ceramic')] },
      { key: 'overheads', label: 'Laundry overheads', type: 'toggle', def: true },
      { key: 'pantryShelves', label: 'Walk-in pantry shelving', type: 'color', palette: 'PAINT', def: 'Vivid White', allowTimber: true },
    ],
  },
  {
    id: 'joinery', title: 'Robes & joinery', icon: '👔', questions: [
      { key: 'robeDoors', label: 'Built-in robe doors', type: 'select', def: 'mirror', options: [opt('mirror', 'Mirror sliding'), opt('white', 'White sliding'), opt('timber', 'Timber-look sliding'), opt('blackGlass', 'Black-framed glass sliding'), opt('hinged', 'Hinged (shaker)')] },
      { key: 'robeColour', label: 'Robe door colour', type: 'color', palette: 'PAINT', def: 'Vivid White', allowTimber: true, show: s => ['white', 'hinged'].includes(s.joinery.robeDoors) },
      { key: 'wirFitout', label: 'Walk-in robe fit-out', type: 'select', def: 'shelves', options: [opt('shelves', 'Shelves & hanging'), opt('drawers', 'Shelves, hanging & drawer island'), opt('basic', 'Single shelf & rail')] },
      { key: 'shelfColour', label: 'Shelving colour', type: 'color', palette: 'PAINT', def: 'Vivid White', allowTimber: true },
    ],
  },
  {
    id: 'floors', title: 'Floor coverings', icon: '🟫', questions: [
      { key: 'living', label: 'Living, kitchen, dining, halls', type: 'select', def: 'oak', options: [opt('oak', 'Hybrid timber – Natural Oak'), opt('lightOak', 'Hybrid timber – Light Oak'), opt('greyOak', 'Hybrid timber – Grey Oak'), opt('spotted', 'Engineered – Spotted Gum'), opt('tile', 'Porcelain 600×600'), opt('tileLarge', 'Porcelain 600×1200'), opt('concrete', 'Polished concrete'), opt('carpet', 'Carpet')] },
      { key: 'livingTile', label: 'Living tile colour', type: 'color', palette: 'TILE', def: 'Warm grey', show: s => ['tile', 'tileLarge'].includes(s.floors.living) },
      { key: 'bedroom', label: 'Bedrooms & robes', type: 'select', def: 'carpet', options: [opt('carpet', 'Carpet'), opt('oak', 'Hybrid timber – Natural Oak'), opt('lightOak', 'Hybrid timber – Light Oak'), opt('same', 'Same as living')] },
      { key: 'carpet', label: 'Carpet colour', type: 'color', palette: 'CARPET', def: 'Pebble Grey' },
      { key: 'garage', label: 'Garage floor', type: 'select', def: 'concrete', options: [opt('concrete', 'Plain concrete'), opt('epoxy', 'Epoxy flake'), opt('tile', 'Porcelain tile')] },
      { key: 'outdoor', label: 'Alfresco & porch', type: 'select', def: 'tile', options: [opt('tile', 'Outdoor porcelain tile'), opt('concrete', 'Coloured concrete'), opt('decking', 'Timber decking'), opt('pavers', 'Pavers')] },
      { key: 'outdoorColour', label: 'Outdoor tile colour', type: 'color', palette: 'TILE', def: 'Charcoal', show: s => s.floors.outdoor === 'tile' },
    ],
  },
  {
    id: 'paint', title: 'Interior paint', icon: '🎨', questions: [
      { key: 'walls', label: 'Walls', type: 'color', palette: 'PAINT', def: 'Lexicon Quarter' },
      { key: 'ceiling', label: 'Ceilings', type: 'color', palette: 'PAINT', def: 'Vivid White' },
      { key: 'trim', label: 'Skirtings, architraves & door frames', type: 'color', palette: 'PAINT', def: 'Vivid White' },
      { key: 'feature', label: 'Feature wall behind beds', type: 'color', palette: 'PAINT', def: 'None', allowNone: true },
    ],
  },
  {
    id: 'lighting', title: 'Lighting & electrical', icon: '💡', questions: [
      { key: 'source', label: 'Light & power points', type: 'select', def: 'auto', options: [opt('auto', 'From the drawing if found, otherwise automatic layout'), opt('drawing', 'From the drawing only'), opt('generate', 'Automatic layout'), opt('none', 'None')] },
      { key: 'downlight', label: 'Downlight trim', type: 'select', def: 'white', options: [opt('white', 'White'), opt('black', 'Black'), opt('brass', 'Brass')] },
      { key: 'plates', label: 'Switch & power point plates', type: 'select', def: 'white', options: [opt('white', 'White'), opt('black', 'Matte black'), opt('brushed', 'Brushed steel')] },
      { key: 'warmth', label: 'Light colour', type: 'select', def: 'warm', options: [opt('warm', 'Warm white (3000K)'), opt('neutral', 'Neutral (4000K)'), opt('cool', 'Cool white (5000K)')] },
      { key: 'fans', label: 'Ceiling fans in bedrooms & living', type: 'toggle', def: false },
    ],
  },
  {
    id: 'furniture', title: 'Furniture & styling', icon: '🛋️', questions: [
      { key: 'show', label: 'Furnish the house', type: 'toggle', def: true },
      { key: 'style', label: 'Style', type: 'select', def: 'modern', options: [opt('modern', 'Modern neutral'), opt('scandi', 'Scandinavian'), opt('hamptons', 'Hamptons / coastal'), opt('industrial', 'Industrial dark')] },
    ],
  },
];

export const PALETTES = { COLORBOND, PAINT, TIMBER, STONE, METAL, TILE, CARPET, BRICK, ROOFTILE };

export function paletteOf(q, spec) {
  const name = typeof q.palette === 'function' ? q.palette(spec) : q.palette;
  let p = { ...PALETTES[name] };
  if (q.allowTimber) p = { ...p, ...TIMBER };
  if (q.allowPaint) p = { ...PAINT, ...p };
  if (q.allowNone) p = { None: null, ...p };
  return { name, colours: p };
}

export function colourHex(spec, group, key) {
  const q = GROUPS.find(g => g.id === group).questions.find(x => x.key === key);
  const v = spec[group][key];
  if (typeof v === 'string' && v.startsWith('#')) return v;
  const { colours } = paletteOf(q, spec);
  if (v in colours) { const c = colours[v]; return c && typeof c === 'object' ? c.c : c; }
  for (const p of Object.values(PALETTES)) if (v in p) { const c = p[v]; return c && typeof c === 'object' ? c.c : c; }
  return null;
}
export function metal(name) { return METAL[name] || METAL.Chrome; }

export function defaultSpec() {
  const s = {};
  for (const g of GROUPS) { s[g.id] = {}; for (const q of g.questions) s[g.id][q.key] = q.def; }
  return s;
}

// Apply hints read from the drawing; returns the list of keys that came from the drawing.
export function applyHints(spec, hints = {}, location = null) {
  const from = {};
  const map = {
    'roof.pitch': ['roof', 'pitch'], 'roof.eave': ['roof', 'eave'], 'roof.material': ['roof', 'material'], 'roof.type': ['roof', 'type'],
    'roof.colour': ['roof', 'colour'], 'roof.gutterColour': ['roof', 'gutterColour'], 'structure.ceiling': ['structure', 'ceiling'],
    'structure.raised': ['structure', 'raised'], 'doors.intHeight': ['doors', 'intHeight'], 'doors.extHeight': ['doors', 'extHeight'],
    'windows.head': ['windows', 'head'], 'windows.frameColour': ['windows', 'frameColour'], 'exterior.wallMaterial': ['exterior', 'wallMaterial'],
    'garage.doorType': ['garage', 'doorType'], 'garage.colour': ['garage', 'colour'], 'site.address': ['site', 'address'], 'site.state': ['site', 'state'],
  };
  for (const [k, h] of Object.entries(hints)) {
    const m = map[k]; if (!m) continue;
    spec[m[0]][m[1]] = h.value;
    from[m.join('.')] = h.why;
  }
  if (location) { spec.site.lat = location.lat; spec.site.lon = location.lon; from['site.lat'] = from['site.lon'] = `${location.city} (${location.from})`; }
  if (hints['roof.colour']) { spec.roof.downpipeColour = hints['roof.colour'].value; }
  if (hints['roof.gutterColour']) spec.roof.downpipeColour = hints['roof.gutterColour'].value;
  return from;
}

export const TZ = { SA: [9.5, true], NSW: [10, true], VIC: [10, true], QLD: [10, false], WA: [8, false], TAS: [10, true], NT: [9.5, false], ACT: [10, true] };
