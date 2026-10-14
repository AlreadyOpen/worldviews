// Satellites: CelesTrak GP elements (OMM JSON), propagated in the browser with satellite.js (SGP4). CelesTrak's usage policy
// (celestrak.org/usage-policy.php): download a group at most once per update (every 2 hours), and stop asking after any
// non-200 answer. So each group is cached in memory and in Cache Storage with its time (see gp()), and a failure is cached too.
import { json2satrec, propagate, gstime, eciToGeodetic, eciToEcf, ecfToLookAngles, degreesLat, degreesLong, degreesToRadians, type SatRec } from 'satellite.js'
import { once } from './data'

export const SAT_GROUPS: Record<string, string> = { stations: 'Space stations', visual: 'Brightest', gnss: 'Navigation (GNSS)', weather: 'Weather', starlink: 'Starlink',
  active: 'Every active satellite', debris: 'Debris from four breakups' }
// 'debris' = CelesTrak's tracked fragments of the four best-known breakups: the Fengyun-1C test (2007), the Iridium 33 / Cosmos 2251
// collision (2009) and the Cosmos 1408 test (2021). Each group is still one request at most every 2 hours.
export const DEBRIS = ['fengyun-1c-debris', 'cosmos-2251-debris', 'iridium-33-debris', 'cosmos-1408-debris']
const TTL = 2 * 3600e3
export type Sat = { name: string; id: number; epoch: string; rec: SatRec }

// Every group goes to the browser's Cache Storage ('celestrak'), whose quota is far above localStorage's 5 MB (Starlink is
// ~4.7 MB), so a reload within 2 hours reuses it instead of asking CelesTrak again. The fetch time rides along as a
// header. A failure is cached the same way (stored with its status), so a refused request is not repeated for 2 hours.
// Without Cache Storage (private mode, old browser) it falls back to a plain fetch, still once per page visit (once()).
export const gp = (group: string) => once('gp-' + group, async () => {
  if (group === 'debris') {
    const parts = await Promise.all(DEBRIS.map(g => gp(g)))
    if (parts.every(x => !x.data)) throw new Error(parts.map(x => x.error).filter(Boolean)[0] || 'CelesTrak: no debris group loaded')
    return { sats: parts.flatMap(x => x.data?.sats || []), at: Math.min(...parts.map(x => x.data?.at ?? Date.now())) }
  }
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`
  let store: Cache | null = null, c: any = null
  try {
    store = await caches.open('celestrak')
    const hit = await store.match(url)
    const at = Number(hit?.headers.get('x-fetched-at'))
    if (hit && Date.now() - at < TTL) c = { at, ...(await hit.json()) }
  } catch { c = null }
  if (!c) {
    const r = await fetch(url)
    c = r.ok ? { at: Date.now(), rows: await r.json() } : { at: Date.now(), error: `celestrak.org answered ${r.status}, not asking again for 2 hours` }
    try { await store?.put(url, new Response(JSON.stringify(c.error ? { error: c.error } : { rows: c.rows }), { headers: { 'content-type': 'application/json', 'x-fetched-at': String(c.at) } })) }
    catch { /* quota or no Cache Storage: the memory copy still holds for this visit */ }
  }
  if (c.error) throw new Error(c.error)
  const sats: Sat[] = c.rows.map((o: any) => ({ name: o.OBJECT_NAME, id: o.NORAD_CAT_ID, epoch: o.EPOCH, rec: json2satrec(o) }))
  return { sats, at: c.at as number }
})

export { gstime }
export type Pos = { lon: number; lat: number; alt: number; speed: number; eci: any }
export function where(rec: SatRec, t: Date, gmst = gstime(t)): Pos | null {
  const pv = propagate(rec, t)
  if (!pv || typeof pv.position !== 'object') return null
  const g = eciToGeodetic(pv.position, gmst), v = pv.velocity
  return { lon: degreesLong(g.longitude), lat: degreesLat(g.latitude), alt: g.height, speed: Math.hypot(v.x, v.y, v.z), eci: pv.position }
}

// Elevation in degrees of a satellite seen from a ground point (lon, lat in degrees, at sea level).
export function elevation(eci: any, gmst: number, [lon, lat]: number[]) {
  const look = ecfToLookAngles({ longitude: degreesToRadians(lon), latitude: degreesToRadians(lat), height: 0 }, eciToEcf(eci, gmst))
  return (look.elevation * 180) / Math.PI
}

// Next time within 24 h that a satellite rises above 10 degrees from a point: 30 s steps, about 2,900 propagations.
export function nextPass(rec: SatRec, at: number[], from = new Date()) {
  for (let s = 0; s <= 86400; s += 30) {
    const t = new Date(from.getTime() + s * 1000), g = gstime(t), p = where(rec, t, g)
    if (p && elevation(p.eci, g, at) > 10) return t
  }
  return null
}

// Ground track, -90 to +90 min in 30 s steps, split where it crosses the antimeridian.
export function track(rec: SatRec, now = Date.now()) {
  const part = (a: number, b: number) => {
    const lines: number[][][] = [[]]
    for (let s = a; s <= b; s += 30) {
      const p = where(rec, new Date(now + s * 1000))
      if (!p) continue
      const cur = lines.at(-1)!, prev = cur.at(-1)
      if (prev && Math.abs(p.lon - prev[0]) > 180) lines.push([])
      lines.at(-1)!.push([p.lon, p.lat])
    }
    return lines.filter(l => l.length > 1)
  }
  return { past: part(-5400, 0), next: part(0, 5400) }
}

// One revolution as a closed ring, frozen in space at time t (the orbit itself, not the ground track): 120 points of [lon, lat, alt km]
export function orbit(rec: SatRec, t = new Date(), n = 120) {
  const g = gstime(t), period = 2 * Math.PI / rec.no * 60e3, out: number[][] = []   // rec.no: mean motion, radians per minute
  for (let i = 0; i < n; i++) {
    const pv = propagate(rec, new Date(t.getTime() + period * i / n))
    if (!pv || typeof pv.position !== 'object') continue
    const p = eciToGeodetic(pv.position, g)
    out.push([degreesLong(p.longitude), degreesLat(p.latitude), p.height])
  }
  return out
}
