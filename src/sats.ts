// Satellites: CelesTrak GP elements (OMM JSON), propagated in the browser with satellite.js (SGP4). CelesTrak's usage policy
// (celestrak.org/usage-policy.php): download a group at most once per update (every 2 hours), and stop asking after any
// non-200 answer. So each group is cached in memory and in localStorage with its time, and a failure is cached too.
import { json2satrec, propagate, gstime, eciToGeodetic, eciToEcf, ecfToLookAngles, degreesLat, degreesLong, degreesToRadians, type SatRec } from 'satellite.js'
import { once } from './data'

export const SAT_GROUPS: Record<string, string> = { stations: 'Space stations', visual: 'Brightest', gnss: 'Navigation (GNSS)', weather: 'Weather', starlink: 'Starlink' }
const TTL = 2 * 3600e3
export type Sat = { name: string; id: number; epoch: string; rec: SatRec }

export const gp = (group: string) => once('gp-' + group, async () => {
  const key = 'celestrak-gp-' + group
  let c: any = null
  try { c = JSON.parse(localStorage.getItem(key) || 'null') } catch { c = null }
  if (!c || Date.now() - c.at >= TTL) {
    const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`)
    c = r.ok ? { at: Date.now(), rows: await r.json() } : { at: Date.now(), error: `celestrak.org answered ${r.status}, not asking again for 2 hours` }
    try { localStorage.setItem(key, JSON.stringify(c)) } catch { /* quota or private mode: the memory copy still holds for this visit */ }
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
