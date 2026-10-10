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

async function json(url: string) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`)
  return r.json()
}

export const SKY = 'https://huggingface.co/buckets/alreadyopen/world-skylines/resolve'
export const TRANSIT = 'https://huggingface.co/buckets/alreadyopen/hk-transit/resolve'

// Overture deletes releases about 60 days after publishing: always ask STAC for the newest (same as world-buildings/index.html).
export const overtureBuildings = () => once('overture', async () => {
  const cat = await json('https://stac.overturemaps.org/catalog.json')
  const rel = cat.links.filter((l: any) => l.rel === 'child').map((l: any) => l.href).sort().at(-1)
  const b = await json(rel.replace(/catalog\.json$/, 'buildings/catalog.json'))
  return { url: b.links.find((l: any) => l.rel === 'pmtiles').href as string, release: rel.split('/').at(-2) as string }
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
    f.properties = { NAME_ENGL: p.NAME, ISO3_CODE: a3 === 'KOS' ? 'XKX' : a3 }
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
  const by: Record<string, { v: number; year: string }> = {}
  for (const r of rows || []) if (r.value != null && r.countryiso3code) by[r.countryiso3code] = { v: r.value, year: r.date }
  // The World Bank publishes nothing for Taiwan; use Taiwan's own household registration figures (urban share: none published there).
  const tw = (await taiwan()).data                                    // once() returns {data, error}; error = no Taiwan figures
  const twv = tw && { population: tw.people, aged: tw.aged, density: tw.people / TW_KM2 }[ind as string]
  if (tw && twv != null) by.TWN = { v: twv, year: tw.month }
  return { by, updated: meta.lastupdated as string }
})

// Taiwan, Ministry of the Interior, Department of Household Registration open data (CORS *): the latest month's population
// and share aged 65+, summed over every village (ODRP014). Land area 36,197 km² (Ministry of the Interior).
export const TW_KM2 = 36197
export const TW_SOURCE = { name: 'Taiwan Ministry of the Interior, household registration', href: 'https://www.ris.gov.tw/app/portal/346' }
export const taiwan = () => once('taiwan', async () => {
  const now = new Date()
  for (let back = 0; back < 6; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1)
    const ym = `${d.getFullYear() - 1911}${String(d.getMonth() + 1).padStart(2, '0')}`
    const url = (pg: number) => `https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/${ym}?page=${pg}`
    const first = await json(url(1))
    if (!first.responseData) continue                                   // that month is not out yet
    const pages = [first, ...await Promise.all(Array.from({ length: +first.totalPage - 1 }, (_, i) => json(url(i + 2))))]
    let people = 0, old = 0
    for (const r of pages.flatMap((p: any) => p.responseData)) {
      people += +r.people_total
      for (const [k, v] of Object.entries(r)) { const a = /^people_age_(\d+)/.exec(k); if (a && +a[1] >= 65) old += +(v as string) }
    }
    return { people, aged: 100 * old / people, month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
  }
  throw new Error('Taiwan household registration: no month in the last six')
})

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

// Point in (multi)polygon, even-odd. ponytail: linear scan over ~260 countries per lookup; fine at one lookup per camera stop.
export function placeAt(fc: any, [x, y]: number[]) {
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
