# Plan Studio

Upload a house plan (DWG, DXF or PDF) and get an interactive 3D walkthrough, with every finish
selectable and every door, window, wall and room editable – changes rebuild the 3D model instantly.

It runs entirely in the browser: files are read locally and never uploaded to a server.

## How it works

1. **Upload plans** – drop the CAD file and/or the PDF set. The app reads every sheet, finds the
   plan views (floor plan, electrical layout, plumbing…) by their room names and titles, and picks
   the floor plan. PDFs use the printed scale ("1:100"); CAD files use their real units.
2. **Check the plan** – the recognised walls, doors, windows, sliding doors, garage door, openings,
   rooms, robes and columns are drawn over the original drawing. Click anything to edit it, or use
   the tools to draw walls and drop doors/windows onto walls. Walls the app had to add to close the
   building outline are shown in brown so you can check them. A PDF with the wrong scale can be
   fixed with the Scale tool (click two points a known distance apart).
3. **Choose options** – about 120 questions in 15 groups, pre-filled from the drawing where it says
   so (roof pitch, eave width, Colorbond, ceiling heights, Hebel/render, panel-lift door, address…):
   site & location, structure & heights, roof (hip / gable / skillion / flat, pitch, eaves, material,
   colours, gutter profile, downpipes), external walls, windows & sliding doors, doors (entry style,
   size, hardware finish, internal door style & height, architraves, skirtings), garage door,
   kitchen (island, waterfall, benchtop, cabinets, handles, splashback, appliances, sink, tapware,
   pendants), bathrooms (vanity, basin, tapware finish, shower screen, tiles, niche, bath, toilet,
   mirror), laundry & pantry, robes & joinery, floor coverings, interior paint, lighting & electrical,
   furniture & styling. The camera follows the group you are editing.
4. **3D walkthrough** – exterior views (front / rear / sides / aerial, true orthographic
   elevations), floor plan (2D with the original drawing overlaid, or dollhouse), roof, electrical
   layout with working lights, and a first-person walk-through (WASD, run, jump, crouch, open doors,
   flick light switches, torch, minimap, teleport to any room). Sun & weather (real sun position for
   the site, time of day, date, clear / cloudy / overcast / rain / fog), measure tool, HQ rendering.

**Edit element** (3D) and the review screen share the same inspector: a door's width, height,
leaf, hinge side and swing; a window's style, width, head, height, sill and obscure glass; a wall's
type, outside face and thickness (and "add a door/window here"); a room's name, type and ceiling
height. Leaving a height blank uses the value from Options, so changing e.g. *External door height*
updates every door that has not been set individually.

**Export**: a printable selections schedule with the room schedule and a door & window schedule
(print to PDF for the builder), the 3D model as `.glb`, a screenshot, or the project file (`.json`).
Projects are saved automatically in the browser (Projects menu).

## Run it

ES modules need a web server:

```bash
python -m http.server 8000
```

then open <http://localhost:8000> in this folder. Any static host works (GitHub Pages, Netlify…);
there is no build step. three.js, pdf.js and the DWG reader load from the jsDelivr CDN.

## What gets recognised automatically

| From the drawing | How |
|---|---|
| Walls & thickness | Parallel line stacks 70–400 mm apart (layered Hebel/stud walls included), kept if they form the building's wall network |
| Windows | Stretches of a wall whose inner-line pattern differs from the solid wall, or where the wall's hatching / poche stops |
| Doors & swing | Door swing arcs (hinge side and direction), door blocks, wall gaps |
| Window/door sizes & types | Labels like `2.057X2.05W (AAW)`, `2.4X3.048W (ASD)`, `2.4x4.8W PANEL LIFT DOOR`, `FLAT ARCH OPENING` |
| Rooms, names, areas | Flood fill between walls and drawn lines, named from the text (BEDROOM, ENS., W.I.R, L'DRY…); open-plan areas split between their labels |
| Robes, alfresco, porch | B.I.R. labels, outdoor room names; columns and bulkhead beams are added on open sides |
| Raised ceilings | `CL 3000` inside a room |
| Fixtures | Plan abbreviations (WC, SH, BT, V, S, F, D/W, CT/OV/RHD, LT, W/M…) and CAD block names guide the fit-out |
| Electrical | Symbols on the CAD electrical layout, aligned to the floor plan (otherwise an automatic layout) |
| Roof outline | Building footprint incl. alfresco & porch |
| Specification hints | Roof pitch, eaves, roof material & colour, ceiling heights, door heights, wall finish, garage door type, site address & state |

Works best with orthogonal floor plans drawn with double-line walls (typical residential CAD and PDF
exports). Always check the plan in step 2 – recognition is heuristic, and anything it gets wrong can
be fixed there or later in 3D. The site (lot, street, driveway, fences, landscaping) is generated
around the house from the street side and setbacks in Options rather than read from a site plan.

## Project structure

```
index.html, css/app.css      UI shell
js/app.js                    Steps, projects, panels
js/importer.js               Files → views → model, overlay image of the original drawing
js/import/dwg.js | pdf.js    DWG/DXF (LibreDWG WebAssembly) and PDF (pdf.js) readers → neutral drawing
js/analyze/                  Recognition: walls.js, stacks.js, plan.js, rooms.js, raster.js, text.js, index.js
js/spec.js, js/options.js    Option catalogue & options panel
js/inspector.js, editor2d.js Element inspector, 2D review editor
js/viewer/                   3D: viewer.js, build.js (house), roof.js, furnish.js, electric.js, site.js,
                             materials.js, textures.js, sun.js, walk.js, measure.js, batch.js
js/export.js, js/store.js    Exports, browser storage
test/serve.py                Dev server with caching disabled: python test/serve.py 8000 .
```

Third-party code loaded at runtime: three.js (MIT), pdf.js (Apache-2.0) and
@mlightcad/libredwg-web (GPL-3.0, a WebAssembly build of GNU LibreDWG). If you distribute the app,
check the GPL terms for the DWG reader, or offer DXF/PDF import only.
