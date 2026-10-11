// Public, keyless, CORS-open sources. Each fetch is cached per session; a failure is kept (not retried silently) so the
// panel can say which source is down. Probed 2026-10-10 (world-open-data-probe-2026-10-10.md).
export type Feed<T> = { data?: T; error?: string; at?: number }

const cache = new Map<string, Promise<any>>()
const done = new Map<string, Feed<any>>()
export function once<T>(key: string, f: () => Promise<T>): Promise<Feed<T>> {
  if (!cache.has(key)) cache.set(key, f().then(data => ({ data, at: Date.now() }), e => ({ error: String(e?.message || e), at: Date.now() }))
    .then(r => (done.set(key, r), r)))
  return cache.get(key)!
}
// What a feed has delivered so far, without waiting (GDACS takes 10 to 15 s per event type).
export const peek = <T>(key: string): Feed<T> | undefined => done.get(key)
export const retry = (key: string) => cache.delete(key)

export async function json(url: string) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`)
  return r.json()
}

export const TRANSIT = 'https://huggingface.co/buckets/alreadyopen/hk-transit/resolve'

// Buildings: AlreadyOpen world-buildings, one PMTiles file per region (Overture Maps, and the official CSDI data for Hong Kong),
// layer `buildings`, from z6 (tallest first) to about z15. The index lists the regions; nothing about them is hard-coded.
export type Region = { id: string; source: string; bbox: number[]; rows: number; checked: number; tiles: string; layer?: string }
// The Netherlands: 3DBAG (CC BY 4.0) drawn alongside Overture (Helen, 2026-10-11). Until world-buildings lists a 3DBAG region,
// the 30 m+ 3DBAG tiles of world-skylines stand in (layer `skylines`); once the index has one, this fallback is not used.
const NL_3DBAG: Region = { id: 'nl-3dbag', source: '3dbag', bbox: [3.3845, 50.7617, 7.0391, 53.4869], rows: 0, checked: 0,
  tiles: 'https://huggingface.co/buckets/alreadyopen/world-skylines/resolve/nl.pmtiles', layer: 'skylines' }
export const buildingRegions = () => once('world-buildings', async () => {
  const idx = (await json('https://huggingface.co/buckets/alreadyopen/world-buildings/resolve/index.json')) as { release: string; layer: string; regions: Region[] }
  if (!idx.regions.some(r => r.source === '3dbag')) idx.regions.push(NL_3DBAG)
  return idx
})

// USGS: day feed for live and the day slider (T2), month feed for history (T3). Public domain.
export const quakes = (span: 'day' | 'month') => once('usgs-' + span, () =>
  json(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_${span}.geojson`))

// GDACS needs one request per event type; only the current point of each event is drawn.
export const gdacs = () => once('gdacs', async () => {
  const types = ['TC', 'FL', 'VO', 'DR', 'WF']
  const all = await Promise.all(types.map(t => json(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=${t}`)))
  return { type: 'FeatureCollection', features: all.flatMap(fc => fc.features.filter((f: any) =>
    f.geometry.type === 'Point' && f.properties.iscurrent === 'true')) }
})

export const eonet = () => once('eonet', async () => {
  const fc = await json('https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=30')
  // A moving event (a storm) comes as one point per report: keep only its latest position.
  const last = new Map<string, any>()
  for (const f of fc.features) if (f.geometry.type === 'Point' && !(last.get(f.properties.id)?.properties.date > f.properties.date)) last.set(f.properties.id, f)
  return { type: 'FeatureCollection', features: [...last.values()] }
})

// Natural Earth 1:50m countries (public domain): the people view and "which place is this". Not GISCO: GISCO folds Taiwan
// into China, while Natural Earth draws Taiwan, Hong Kong and Macau as their own places. Properties are mapped to the names
// the rest of the app uses (NAME_ENGL, ISO3_CODE); ISO3 falls back to the admin code, with Kosovo as the World Bank's XKX.
export const countries = () => once('countries', async () => {
  const d = await json('https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_50m_admin_0_countries.geojson')
  for (const f of d.features) {
    const p = f.properties, a3 = p.ISO_A3_EH !== '-99' ? p.ISO_A3_EH : p.ADM0_A3
    f.properties = { NAME_ENGL: p.NAME, ISO3_CODE: a3 === 'KOS' ? 'XKX' : a3, POP_EST: p.POP_EST, POP_YEAR: p.POP_YEAR }
  }
  return d
})

export const INDICATORS = {
  density: { id: 'EN.POP.DNST', unit: 'people per km²', label: 'Population density' },
  population: { id: 'SP.POP.TOTL', unit: 'people', label: 'Population' },
  aged: { id: 'SP.POP.65UP.TO.ZS', unit: '% aged 65+', label: 'Aged 65 and over' },
  urban: { id: 'SP.URB.TOTL.IN.ZS', unit: '% urban', label: 'Living in towns and cities' },
} as const
export type Indicator = keyof typeof INDICATORS

// World Bank: the latest value of one indicator for every country, keyed by ISO3.
export const worldBank = (ind: Indicator) => once('wb-' + ind, async () => {
  const [meta, rows] = await json(`https://api.worldbank.org/v2/country/all/indicator/${INDICATORS[ind].id}?format=json&mrnev=1&per_page=400`)
  // src: who published a figure that is not the World Bank's (shown next to it)
  const by: Record<string, { v: number; year: string; src?: string }> = {}
  for (const r of rows || []) if (r.value != null && r.countryiso3code) by[r.countryiso3code] = { v: r.value, year: r.date }
  // Places the World Bank leaves out, from their own official statistics (once() returns {data, error}; error = skipped)
  const own = (await smallPlaces()).data || []
  for (const o of own) if (!by[o.iso3] && (o as any)[ind] != null) by[o.iso3] = { v: (o as any)[ind], year: o.year, src: o.src }
  // Last resort, population only: Natural Earth's estimate, labelled, so no place is blank (official sources
  // come first, then this). Places with no residents (estimate 0) stay without a figure.
  if (ind === 'population') {
    const cs = (await countries()).data
    for (const f of cs?.features || []) {
      const p = f.properties
      if (!by[p.ISO3_CODE] && p.POP_EST > 0) by[p.ISO3_CODE] = { v: p.POP_EST, year: String(p.POP_YEAR), src: 'Natural Earth estimate' }
    }
  }
  return { by, updated: meta.lastupdated as string }
})

// Official figures for places the World Bank leaves out, from AlreadyOpen/world-places (weekly pipeline: each place's own
// statistics office; some cannot be read from a browser, e.g. Åland's and Jersey's). One JSON per source, listed in index.json.
export const PLACES = 'https://huggingface.co/buckets/alreadyopen/world-places/resolve'
// Two sites from one codebase: WorldViews Libre uses open-licence sources only; WorldViews also reads
// sources with no open licence (the nc places dataset). Chosen at build time (PUBLIC_EDITION=libre|full); in the libre build the
// nc branch is dead code and its URL is not in the bundle.
export const EDITION = import.meta.env.PUBLIC_EDITION === 'full' ? 'full' : 'libre'
export const SITE = EDITION === 'full' ? 'WorldViews' : 'WorldViews Libre'
type Own = { iso3: string; population?: number; aged?: number; density?: number; year: string; src: string }
const placesFrom = async (base: string) => {
  const idx = await json(`${base}/index.json`)
  const files = await Promise.all(idx.files.map((f: string) => json(`${base}/${f}`)))
  return files.flatMap((f: any) => f.places.map((p: any): Own => ({ iso3: p.iso3, population: p.population, aged: p.aged_65_plus_pct,
    density: p.density_per_km2, year: p.period, src: f.publisher })))
}
export const smallPlaces = () => once('small-places', async () => [
  ...await placesFrom(PLACES),
  ...(import.meta.env.PUBLIC_EDITION === 'full' ? await placesFrom('https://huggingface.co/buckets/alreadyopen/world-places-nc/resolve') : [])])
// Building energy rules (full edition only: noncommercial licence, not open; the libre bundle must not carry the source, its
// URL or its labels, so everything below sits behind the edition check). Shape: {source, url, cite, licence_note,
// indicators: {code: name}, countries: {ISO3: {code: value}}}; '..' = not reported. Status = unified code or not (BEC-INFO-01)
// x enforced in practice (ENF-INFO-01).
export const buildingGreen = () => import.meta.env.PUBLIC_EDITION === 'full'
  ? once('building-green', () => json('https://huggingface.co/buckets/alreadyopen/world-building-green/resolve/building-green.json'))
  : Promise.resolve({ error: 'not in this edition' } as Feed<any>)
export const BG_STATUS: string[] = import.meta.env.PUBLIC_EDITION === 'full' ? ['Unified code, enforced', 'Unified code, enforced in part', 'Unified code, not enforced or not reported', 'Some standards, no unified code'] : []
export const BG_SHORT: string[] = import.meta.env.PUBLIC_EDITION === 'full' ? ['Enforced', 'Enforced in part', 'Not enforced or not reported', 'Some standards only'] : []
export const bgStatus = (c: any) => c['BEC-INFO-01'] !== 'Unified BEC' ? 3 : c['ENF-INFO-01'] === 'Yes' ? 0 : String(c['ENF-INFO-01']).startsWith('Yes') ? 1 : 2
// World Bank RISE (Regulatory Indicators for Sustainable Energy), CC BY 4.0, via Data360: one row per economy and year
// (2010 onwards), score 0 to 100. Paged, up to 1000 rows a page. `by` = latest year per economy, `series` = every year.
export const RISE_LABEL: Record<string, string> = { BEC: 'Building Energy Codes', ELS: 'Energy Labeling Systems',
  MEEP: 'Minimum Energy Efficiency Performance Standards', IMPS: 'Energy Efficiency in Public Sector', FMEE: 'Financing Mechanisms for Energy Efficiency' }
export const rise = (ind: string) => once('rise-' + ind, async () => {
  const rows: any[] = []
  for (let skip = 0; ; skip += 1000) {
    const p = await json(`https://data360api.worldbank.org/data360/data?DATABASE_ID=WB_RISE&INDICATOR=WB_RISE_EE_${ind}&skip=${skip}`)
    rows.push(...p.value)
    if (!p.value.length || rows.length >= p.count) break
  }
  const series: Record<string, [number, number][]> = {}
  for (const r of rows) if (r.OBS_VALUE != null) (series[r.REF_AREA] ||= []).push([+r.TIME_PERIOD, +r.OBS_VALUE])
  const by: Record<string, { v: number; year: string }> = {}
  for (const [k, s] of Object.entries(series)) { s.sort((a, b) => a[0] - b[0]); by[k] = { v: s.at(-1)![1], year: String(s.at(-1)![0]) } }
  return { by, series }
})
// World Bank B-READY (CC BY 4.0): one indicator, latest value per economy, keyed by ISO3. Codes IC.BRE.<topic>.OS (topic
// score) and .P1/.P2/.P3 (its pillars); IC.BRE.P1.RF, P2.PS, P3.OE are the three pillars across all ten topics.
export const BREADY_PILLARS = ['Regulatory framework', 'Public services', 'Operational efficiency']
export const bready = (id: string) => once('bre-' + id, async () => {
  const [meta, rows] = await json(`https://api.worldbank.org/v2/country/all/indicator/${id}?format=json&mrnev=1&per_page=400`)
  const by: Record<string, { v: number; year: string }> = {}
  for (const r of rows || []) if (r.value != null && r.countryiso3code) by[r.countryiso3code] = { v: r.value, year: r.date }
  return { by, updated: meta.lastupdated as string }
})
// "Overall" for the city card: B-READY publishes no single score, so this is the mean of its three cross-topic pillars.
export const breadyOverall = async (iso3: string) => {
  const ps = await Promise.all(['IC.BRE.P1.RF', 'IC.BRE.P2.PS', 'IC.BRE.P3.OE'].map(bready))
  const v = ps.map(p => p.data?.by[iso3]?.v)
  return v.every(x => x != null) ? (v as number[]).reduce((a, b) => a + b) / 3 : null
}
// Airports: OurAirports (public domain) as vector tiles from AlreadyOpen/world-airports. Fields are the OurAirports columns
// (ident, type, name, latitude_deg, longitude_deg, elevation_ft, municipality, icao_code, iata_code, home_link, wikipedia_link...).
export const AIRPORTS = 'https://huggingface.co/buckets/alreadyopen/world-airports/resolve'
export type Airport = { id: number; name: string; iata?: string; icao?: string; lon: number; lat: number; props: any }
// Every large airport (about 1,240) from the 16 tiles at z2, where only large airports are drawn: enough to find the nearest
// one to any point without a separate file.
// Only the fields the view shows (a plain copy: MapLibre's worker could not serialise the decoded tile's properties object)
const APT_FIELDS = ['id', 'ident', 'type', 'name', 'icao_code', 'gps_code', 'iata_code', 'elevation_ft', 'municipality', 'home_link', 'wikipedia_link', 'latitude_deg', 'longitude_deg']
export const largeAirports = () => once('large-airports', async () => {
  const [{ PMTiles }, { VectorTile }, { PbfReader }] = await Promise.all([import('pmtiles'), import('@mapbox/vector-tile'), import('pbf')])
  const p = new PMTiles(`${AIRPORTS}/airports.pmtiles`), by = new Map<number, Airport>()
  await Promise.all([...Array(16).keys()].map(async i => {
    const t = await p.getZxy(2, i % 4, i >> 2)
    const l = t && new VectorTile(new PbfReader(new Uint8Array(t.data))).layers.airports
    for (let j = 0; l && j < l.length; j++) {
      const q: any = l.feature(j).properties
      if (q.type === 'large_airport') by.set(q.id, { id: q.id, name: q.name, iata: q.iata_code, icao: q.icao_code, lon: q.longitude_deg, lat: q.latitude_deg,
        props: Object.fromEntries(APT_FIELDS.map(k => [k, q[k] ?? null])) })
    }
  }))
  return [...by.values()]
})
export const kmBetween = ([x1, y1]: number[], [x2, y2]: number[]) => {
  const r = Math.PI / 180, h = Math.sin(((y2 - y1) * r) / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin(((x2 - x1) * r) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}
export const nearestLarge = (all: Airport[], c: number[]) =>
  all.reduce<{ a: Airport; km: number } | null>((best, a) => { const km = kmBetween(c, [a.lon, a.lat]); return !best || km < best.km ? { a, km } : best }, null)

export const mtr = () => once('mtr', () => json(`${TRANSIT}/mtr.json`))
export const busIndex = () => once('bus-index', () => json(`${TRANSIT}/bus/index.json`))

// One 2 km bus tile: route pieces in decimetres from the tile origin, `ll` maps them to lon/lat (hk-transit bus.py:195,208).
export const busTile = (name: string) => once('bus-' + name, async () => {
  const r = await fetch(`${TRANSIT}/bus/${name}.json.gz`)
  if (!r.ok) throw new Error(`bus tile ${name}: ${r.status}`)
  const t = await new Response(r.body!.pipeThrough(new DecompressionStream('gzip'))).json()
  const [a, b, c, d, e, f] = t.ll
  const ll = (x: number, y: number) => [a + b * x + c * y, d + e * x + f * y]
  const lines = t.pieces.map((p: any) => {
    const co: number[][] = []
    for (let i = 0; i < p.p.length; i += 2) co.push(ll(p.p[i], p.p[i + 1]))
    const [op, route, dir] = t.routes[p.k]
    return { type: 'Feature', properties: { k: p.k, op, route, dir }, geometry: { type: 'LineString', coordinates: co } }
  })
  const stops = Object.entries(t.stops).map(([id, s]: any) => ({ type: 'Feature',
    properties: { id, en: s[0], zh: s[1], op: s[4] }, geometry: { type: 'Point', coordinates: ll(s[2], s[3]) } }))
  return { lines, stops }
})

// Which 2 km bus tiles cover a lon/lat box (index.to_hk is the lon/lat -> HK1980 affine).
export function busTilesFor(idx: any, [w, s, e, n]: number[]) {
  const [[x0, xa, xb], [y0, ya, yb]] = idx.to_hk
  const xs = [[w, s], [w, n], [e, s], [e, n]].map(([lo, la]) => x0 + xa * lo + xb * la)
  const ys = [[w, s], [w, n], [e, s], [e, n]].map(([lo, la]) => y0 + ya * lo + yb * la)
  const T = idx.tile_m, [ox, oy] = idx.origin, out: string[] = []
  for (let cx = Math.floor((Math.min(...xs) - ox) / T); cx <= Math.floor((Math.max(...xs) - ox) / T); cx++)
    for (let cy = Math.floor((Math.min(...ys) - oy) / T); cy <= Math.floor((Math.max(...ys) - oy) / T); cy++)
      if (idx.tiles[`${cx}_${cy}`]) out.push(`${cx}_${cy}`)
  return out
}

// The country code a Natural Earth feature stands for, as an expression (tiles) and in JS (same rule as countries()).
export const ISO = ['case', ['!=', ['get', 'ISO_A3_EH'], '-99'], ['get', 'ISO_A3_EH'], ['match', ['get', 'ADM0_A3'], 'KOS', 'XKX', ['get', 'ADM0_A3']]]
export const isoOf = (p: any) => p.ISO_A3_EH !== '-99' ? p.ISO_A3_EH : p.ADM0_A3 === 'KOS' ? 'XKX' : p.ADM0_A3
// The map registers a lookup on the 1:10m country tiles (exact at city zoom); without it, the coarse 1:50m polygons below.
let lookup: ((ll: number[]) => Promise<any>) | null = null
export const setPlaceLookup = (f: typeof lookup) => { lookup = f }

// Point in (multi)polygon, even-odd. ponytail: linear scan over ~260 countries per lookup; fine at one lookup per camera stop.
export async function placeAt(fc: any, [x, y]: number[]) {
  const hit = await lookup?.([x, y])
  if (hit !== undefined) return hit                                    // null = sea, as read from the tiles
  const inRing = (r: number[][]) => {
    let inside = false
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  for (const f of fc.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    if (polys.some((p: number[][][]) => inRing(p[0]) && !p.slice(1).some(inRing))) return f.properties
  }
  return null
}
