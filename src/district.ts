// District style and generated buildings (Helen 2026-10-14, after Taipei GTA's per-district styles: reference only, no code
// or assets taken). Everything here is computed in the browser from real data in view:
//   - a 250 m grid of cells, each with a kind (commerce, homes, industry, public, old core) from the real buildings' own use
//     where they carry one (Overture class/subtype, 3DBAG construction year), else from OSM land use and shop/food density
//     (OpenFreeMap tiles), and the real heights seen in and around it;
//   - "District character": real buildings coloured by their own kind, or their cell's when they carry none (feature state);
//   - generated buildings: lots along real roads on free built-up land (not road, rail, water, park, or any real or OSM
//     building), heights drawn from the cell's real heights. Guesses, labelled "generated, not surveyed", off by default.
import type maplibregl from 'maplibre-gl'

export const KINDS = [
  { k: 0, label: 'Unknown use', color: '#6f7673' },
  { k: 1, label: 'Commerce: shops, offices, hotels, food', color: '#CC79A7' },
  { k: 2, label: 'Homes', color: '#56B4E9' },
  { k: 3, label: 'Industry and warehouses', color: '#E69F00' },
  { k: 4, label: 'Public: schools, hospitals, civic, worship, transport', color: '#009E73' },
  { k: 5, label: 'Old core: built before 1945 (where the year is known)', color: '#F0E442' },
] as const
const COMMERCE = ['commercial', 'retail', 'office', 'hotel', 'kiosk', 'supermarket', 'warehouse_retail', 'shop', 'restaurant', 'bank', 'parking']
const HOMES = ['residential', 'apartments', 'house', 'detached', 'semidetached_house', 'terrace', 'dormitory', 'bungalow', 'houseboat', 'static_caravan', 'cabin', 'farm']
const INDUSTRY = ['industrial', 'warehouse', 'factory', 'manufacture', 'storage_tank', 'hangar', 'digester', 'silo', 'service']
const PUBLIC = ['civic', 'public', 'education', 'school', 'university', 'college', 'kindergarten', 'medical', 'hospital', 'clinic', 'religious', 'church', 'mosque',
  'temple', 'chapel', 'cathedral', 'shrine', 'synagogue', 'transportation', 'train_station', 'transportation', 'government', 'fire_station', 'police', 'library',
  'museum', 'sports_hall', 'stadium', 'entertainment', 'military', 'courthouse', 'post_office']
const kindOf = (v: string) => COMMERCE.includes(v) ? 1 : HOMES.includes(v) ? 2 : INDUSTRY.includes(v) ? 3 : PUBLIC.includes(v) ? 4 : 0
const YEAR = ['to-number', ['coalesce', ['get', 'oorspronkelijkbouwjaar'], ['get', 'b3_bouwjaar'], 9999], 9999]
// A real building's own kind, or -1 when its data says nothing (then its cell's kind, through feature state)
export const OWN_KIND: any = ['case', ['<', YEAR, 1945], 5,
  ['match', ['coalesce', ['get', 'class'], ''], ...[COMMERCE, HOMES, INDUSTRY, PUBLIC].flatMap((l, i) => [l.filter((x, j) => l.indexOf(x) === j), i + 1]),
    ['match', ['coalesce', ['get', 'subtype'], ''], ...[COMMERCE, HOMES, INDUSTRY, PUBLIC].flatMap((l, i) => [l.filter((x, j) => l.indexOf(x) === j), i + 1]), -1]]]
export const CHARACTER_COLOR: any = ['match', ['case', ['>=', OWN_KIND, 0], OWN_KIND, ['coalesce', ['feature-state', 'ch'], 0]], ...KINDS.flatMap(k => [k.k, k.color]), KINDS[0].color]
// The same rule in code, for the building card: [kind, what says so] or null
export function ownKind(p: any): [number, string] | null {
  const y = +(p.oorspronkelijkbouwjaar ?? p.b3_bouwjaar ?? 9999)
  if (y < 1945) return [5, `built ${y} (3DBAG)`]
  for (const k of ['class', 'subtype']) { const v = kindOf(p[k] || ''); if (v) return [v, `the building's own ${k}: ${p[k]}`] }
  return null
}
// The feature id each building source promotes, for feature state (hk-buildings, 3DBAG, Overture)
export const PROMOTE: Record<string, string> = { hk: 'BuildingCSUID', '3dbag': 'identificatie' }

const SHOPFOOD = new Set(['shop', 'grocery', 'clothing_store', 'restaurant', 'fast_food', 'cafe', 'bar', 'pub', 'bakery', 'beer', 'ice_cream', 'alcohol_shop',
  'jewelry', 'hairdresser', 'cosmetics', 'mobile_phone', 'electronics', 'optician', 'bank', 'pharmacy', 'convenience', 'hotel', 'fashion', 'shoes', 'toys', 'gift',
  'books', 'florist', 'furniture', 'hardware', 'laundry', 'music', 'nightclub', 'atm', 'car', 'bicycle', 'cinema', 'theatre'])
const LANDUSE: Record<string, number> = { commercial: 1, retail: 1, residential: 2, industrial: 3, railway: 3, quarry: 3, school: 4, university: 4, college: 4,
  hospital: 4, kindergarten: 4, library: 4, military: 4, stadium: 4 }
const BUILT = new Set(['commercial', 'retail', 'residential', 'industrial', 'neighbourhood', 'suburb', 'quarter'])

// Local metres around a centre (equirectangular): enough over a few km
const proj = (lat0: number) => { const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540
  return { to: ([x, y]: number[], lon0: number) => [(x - lon0) * kx, (y - lat0) * ky], back: (x: number, y: number, lon0: number) => [lon0 + x / kx, lat0 + y / ky] } }
const rings = (g: any): number[][][] => g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []
const lines = (g: any): number[][][] => g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
function inRing(p: number[], r: number[][]) { let c = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c
  return c }
const pct = (a: number[], q: number) => a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN
// Stable random per place: a lot keeps its height when the view moves
const rnd = (x: number, y: number) => { let h = Math.imul(Math.round(x * 1e5) ^ Math.imul(Math.round(y * 1e5), 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296 }

export type Cell = { kind: number; why: string; heights: number[]; shops: number; known: number[] }
export type Analysis = { size: number; lon0: number; lat0: number; x0: number; y0: number; nx: number; ny: number; cells: Cell[]; real: any[] }
const CELL = 250

// The district grid for the view, from what the map has loaded
export function analyse(m: maplibregl.Map, buildingLayers: string[]): Analysis {
  const b = m.getBounds(), lon0 = (b.getWest() + b.getEast()) / 2, lat0 = (b.getSouth() + b.getNorth()) / 2, P = proj(lat0)
  const [xa, ya] = P.to([b.getWest(), b.getSouth()], lon0), [xb, yb] = P.to([b.getEast(), b.getNorth()], lon0)
  const x0 = Math.floor(xa / CELL) * CELL, y0 = Math.floor(ya / CELL) * CELL, nx = Math.ceil((xb - x0) / CELL), ny = Math.ceil((yb - y0) / CELL)
  const cells: Cell[] = Array.from({ length: nx * ny }, () => ({ kind: 0, why: '', heights: [], shops: 0, known: [0, 0, 0, 0, 0, 0] }))
  const at = (p: number[]) => { const [x, y] = P.to(p, lon0), i = Math.floor((x - x0) / CELL), j = Math.floor((y - y0) / CELL); return i >= 0 && j >= 0 && i < nx && j < ny ? cells[j * nx + i] : null }
  const real = buildingLayers.length ? m.queryRenderedFeatures({ layers: buildingLayers }) : []
  for (const f of real) {
    const r = rings(f.geometry)[0]; if (!r) continue
    const c = at(r[0]); if (!c) continue
    const p = f.properties, h = +(p.height ?? (p.num_floors ? p.num_floors * 3 : NaN))
    if (h > 0) c.heights.push(h)
    const y = +(p.oorspronkelijkbouwjaar ?? p.b3_bouwjaar ?? 9999), k = y < 1945 ? 5 : kindOf(p.class || '') || kindOf(p.subtype || '')
    if (k) c.known[k]++
  }
  for (const f of m.querySourceFeatures('openmaptiles', { sourceLayer: 'poi' })) {
    if (SHOPFOOD.has(f.properties.class) || SHOPFOOD.has(f.properties.subclass)) { const g: any = f.geometry; const c = g.type === 'Point' && at(g.coordinates); if (c) c.shops++ }
  }
  const lu = m.querySourceFeatures('openmaptiles', { sourceLayer: 'landuse' }).filter(f => LANDUSE[f.properties.class])
  const area = (CELL / 1000) ** 2
  cells.forEach((c, n) => {
    c.heights.sort((a, b2) => a - b2)
    const best = c.known.reduce((bi, v, i) => v > c.known[bi] ? i : bi, 0), total = c.known.reduce((a, v) => a + v, 0)
    if (total >= 3) { c.kind = best; c.why = `${c.known[best]} of ${total} buildings here say so`; return }
    const cx = x0 + (n % nx + 0.5) * CELL, cy = y0 + (Math.floor(n / nx) + 0.5) * CELL, ll = P.back(cx, cy, lon0)
    const hit = lu.find(f => rings(f.geometry).some(r => inRing(ll, r)))
    if (c.shops / area >= 400) { c.kind = 1; c.why = `${c.shops} shops and food places in this 250 m square` }   // 25 a square: a shopping street, not one corner shop
    else if (hit) { c.kind = LANDUSE[hit.properties.class]; c.why = `OSM land use: ${hit.properties.class}` }
    else if (total) { c.kind = best; c.why = `${c.known[best]} of ${total} buildings here say so` }
  })
  return { size: CELL, lon0, lat0, x0, y0, nx, ny, cells, real }
}
export const cellAt = (a: Analysis, p: number[]) => { const P = proj(a.lat0), [x, y] = P.to(p, a.lon0), i = Math.floor((x - a.x0) / a.size), j = Math.floor((y - a.y0) / a.size)
  return i >= 0 && j >= 0 && i < a.nx && j < a.ny ? a.cells[j * a.nx + i] : null }

// Heights for a kind with no real buildings near: storeys x 3.2 m (a guess, said so on the card)
const DEFAULT_FLOORS: Record<number, [number, number]> = { 0: [2, 5], 1: [3, 10], 2: [2, 6], 3: [1, 3], 4: [2, 5], 5: [2, 4] }
const ROAD_W: Record<string, number> = { motorway: 24, trunk: 20, primary: 16, secondary: 13, tertiary: 11, minor: 8, service: 5, raceway: 10, busway: 8, rail: 8, transit: 6 }
const LOTS = new Set(['primary', 'secondary', 'tertiary', 'minor', 'service'])
const G = 4   // mask resolution, metres

// Generated lots for the view: along each real road with a frontage, on free built-up land
export function generate(m: maplibregl.Map, a: Analysis, extraBuildings: any[]) {
  const P = proj(a.lat0), W = Math.ceil(a.nx * a.size / G), H = Math.ceil(a.ny * a.size / G)
  if (W * H > 4e6) return []
  const blocked = new OffscreenCanvas(W, H), bctx = blocked.getContext('2d')!, built = new OffscreenCanvas(W, H), uctx = built.getContext('2d')!
  const px = (p: number[]) => { const [x, y] = P.to(p, a.lon0); return [(x - a.x0) / G, H - (y - a.y0) / G] }
  const poly = (ctx: OffscreenCanvasRenderingContext2D, g: any) => { ctx.beginPath(); for (const r of rings(g)) r.forEach((p, i) => { const [x, y] = px(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }); ctx.fill('evenodd') }
  bctx.fillStyle = bctx.strokeStyle = '#f00'; bctx.lineCap = 'round'
  const q = (l: string) => m.querySourceFeatures('openmaptiles', { sourceLayer: l })
  for (const f of [...q('water'), ...q('park'), ...q('building'), ...q('landcover').filter(f => f.properties.class !== 'farmland'), ...a.real, ...extraBuildings]) poly(bctx, f.geometry)
  // OSM buildings that world-buildings does not draw here are real but invisible: draw them (their own OSM height) instead of
  // leaving a gap. Tiles cut a building at their edges: pieces come back separately, which is fine for drawing.
  const realMask = new OffscreenCanvas(W, H), rctx = realMask.getContext('2d')!; rctx.fillStyle = '#f00'
  for (const f of a.real) poly(rctx, f.geometry)
  const RM = rctx.getImageData(0, 0, W, H).data, osm: any[] = []
  for (const f of q('building')) { const r0 = rings(f.geometry)[0]; if (!r0) continue
    let sx = 0, sy = 0; for (const p of r0) { const [x, y] = px(p); sx += x; sy += y }
    const cx = Math.round(sx / r0.length), cy = Math.round(sy / r0.length), i = (cy * W + cx) * 4
    if (cx < 0 || cy < 0 || cx >= W || cy >= H || RM[i]) continue
    osm.push({ type: 'Feature', properties: { osm: true, height: Math.max(3, +f.properties.render_height || 0), base: +f.properties.render_min_height || 0,
      kind: cellAt(a, r0[0])?.kind ?? 0 }, geometry: f.geometry }) }
  for (const f of q('landuse').filter(f => ['cemetery', 'pitch', 'playground', 'stadium', 'military', 'track', 'garages', 'railway'].includes(f.properties.class))) poly(bctx, f.geometry)
  const roads = q('transportation').filter(f => f.properties.brunnel !== 'tunnel' && ROAD_W[f.properties.class])
  for (const f of roads) { bctx.lineWidth = ROAD_W[f.properties.class] / G; for (const l of lines(f.geometry)) { bctx.beginPath(); l.forEach((p, i) => { const [x, y] = px(p); i ? bctx.lineTo(x, y) : bctx.moveTo(x, y) }); bctx.stroke() } }
  uctx.fillStyle = '#0f0'
  for (const f of q('landuse').filter(f => BUILT.has(f.properties.class))) poly(uctx, f.geometry)
  // OSM land use is patchy (central Taipei: 9 residential areas, 4,269 shops): a district with shops or real buildings around
  // counts as built-up too
  a.cells.forEach((c, n) => { if (c.shops >= 3 || near(a, c).length >= 3) uctx.fillRect((n % a.nx) * a.size / G, H - (Math.floor(n / a.nx) + 1) * a.size / G, a.size / G, a.size / G) })
  const B = bctx.getImageData(0, 0, W, H).data, U = uctx.getImageData(0, 0, W, H).data, taken = new Uint8Array(W * H)
  const free = (x: number, y: number) => { const i = (Math.round(y) * W + Math.round(x)); return x >= 0 && y >= 0 && x < W && y < H && !B[i * 4] && U[i * 4 + 1] && !taken[i] }
  const out: any[] = [...osm]
  for (const f of roads) {
    if (!LOTS.has(f.properties.class)) continue
    for (const l of lines(f.geometry)) for (let s = 1; s < l.length; s++) {
      const [ax, ay] = P.to(l[s - 1], a.lon0), [bx, by] = P.to(l[s], a.lon0), len = Math.hypot(bx - ax, by - ay); if (len < 8) continue
      const ux = (bx - ax) / len, uy = (by - ay) / len
      for (const side of [1, -1]) for (const row of [0, 1]) for (let t = 4; t < len - 4; ) {   // a street-front row, then one behind it
        const r0 = rnd(ax + t * ux * side + row, ay + t * uy), wd = 8 + r0 * 12, dp = 10 + rnd(ay + t + row, ax - t * side) * 14
        const set = ROAD_W[f.properties.class] / 2 + 2 + row * 27
        const cx = ax + ux * (t + wd / 2), cy = ay + uy * (t + wd / 2), nx2 = -uy * side, ny2 = ux * side
        const corners = [[0, 0], [wd, 0], [wd, dp], [0, dp]].map(([u, v]) => [ax + ux * (t + u) + nx2 * (set + v), ay + uy * (t + u) + ny2 * (set + v)])
        const g = (x: number, y: number) => [(x - a.x0) / G, H - (y - a.y0) / G]
        let ok = true
        for (let u = 0; u <= 1 && ok; u += 0.25) for (let v = 0; v <= 1 && ok; v += 0.25) {
          const x = ax + ux * (t + u * wd) + nx2 * (set + v * dp), y = ay + uy * (t + u * wd) + ny2 * (set + v * dp), [gx, gy] = g(x, y)
          if (!free(gx, gy)) ok = false
        }
        if (ok) {
          for (let u = 0; u <= 1; u += 0.1) for (let v = 0; v <= 1; v += 0.1) { const [gx, gy] = g(ax + ux * (t + u * wd) + nx2 * (set + v * dp), ay + uy * (t + u * wd) + ny2 * (set + v * dp))
            const i = Math.round(gy) * W + Math.round(gx); if (i >= 0 && i < taken.length) taken[i] = 1 }
          const c = cellAt(a, P.back(cx + nx2 * (set + dp / 2), cy + ny2 * (set + dp / 2), a.lon0))!, hs = near(a, c)
          const r = rnd(cx, cy), from = hs.length >= 5 ? 'real buildings within about 500 m' : 'a typical range for this kind of district'
          const h = hs.length >= 5 ? Math.max(3, pct(hs, 0.15 + r * 0.7)) : (() => { const [lo, hi] = DEFAULT_FLOORS[c?.kind ?? 0]; return Math.round(lo + r * (hi - lo)) * 3.2 })()
          out.push({ type: 'Feature', properties: { gen: true, height: Math.round(h * 10) / 10, kind: c?.kind ?? 0, from, why: c?.why || 'no land use or buildings recorded nearby' },
            geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]].map(([x, y]) => P.back(x, y, a.lon0))] } })
          t += wd + 1 + rnd(cy, cx) * 2
        } else t += 6
      }
    }
  }
  return out
}
// Real heights in a cell and its eight neighbours
function near(a: Analysis, c: Cell | null) {
  if (!c) return []
  const n = a.cells.indexOf(c), i = n % a.nx, j = Math.floor(n / a.nx), out: number[] = []
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const x = i + di, y = j + dj; if (x >= 0 && y >= 0 && x < a.nx && y < a.ny) out.push(...a.cells[y * a.nx + x].heights) }
  return out.sort((p, q2) => p - q2)
}
