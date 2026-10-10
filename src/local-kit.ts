// Shared kit for the country layers (local-*.ts): the layer type, ArcGIS/zip readers, MapLibre layer helpers, grid cells.
import { json } from './data'
import { RAMPS, MAG_STOPS, type ViewId } from './views'

export type Bbox = [number, number, number, number]
type Row = [string, string]
export type Local = {
  id: string; view: ViewId; cat?: string           // cat: the sub-map it belongs to (hazards: quakes/fire/storms; traffic: volume/crashes)
  area: Bbox; minzoom: number; cell?: number        // cell: load per grid cell of this many degrees (big services)
  name: string; href: string; licence: string; what: string   // what: one counted thing, plural, for the answer
  load: (cell?: Bbox) => Promise<any[]>             // GeoJSON features with flat, scalar properties
  layers: (dark: boolean) => any[]                  // MapLibre layers (source and visibility added by the engine)
  legend?: (dark: boolean) => { label: string; color: string; shape: 'line' | 'dot' | 'ring' }[]
  pick: (p: any) => { title: string; rows: Row[]; href?: string }
  dedupe?: boolean                                  // heights: drop buildings Overture already has a height for
  summary?: (all: any[]) => string                  // the answer's line, in place of a count
}

export const fmt = (t: any) => (t == null || t === '' ? 'Not published' : new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))
export const nf = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
export const has = (k: string, v: any): Row[] => (v == null || v === '' || v === ' ' ? [] : [[k, String(v)]])
export const flat = (p: any) => Object.fromEntries(Object.entries(p || {}).map(([k, v]) => [k, v != null && typeof v === 'object' ? JSON.stringify(v) : v]))
export const fc = (fs: any[]) => fs.map(f => ({ type: 'Feature', geometry: f.geometry, properties: flat(f.properties) })).filter(f => f.geometry)
export const env = (b: Bbox) => `geometry=${b.join(',')}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326`
// ArcGIS REST as GeoJSON, following pages when the server caps a reply (exceededTransferLimit).
export async function arcgis(url: string, q: string) {
  const out: any[] = []
  for (let off = 0; off < 20000; ) {   // first page plain (some MapServers refuse paging without orderBy), then pages
    const d = await json(`${url}/query?${q}${off ? `&resultOffset=${off}` : ''}&f=geojson`)
    if (d.error) { if (off) break; throw new Error(`${new URL(url).host}: ${d.error.message || 'query failed'}`) }
    out.push(...d.features)
    off = out.length
    if (!d.features.length || (!d.exceededTransferLimit && !d.properties?.exceededTransferLimit)) break
  }
  return fc(out)
}
export const circle = (id: string, color: any, radius: any, dark: boolean, extra: any = {}) => ({ id, type: 'circle', ...extra,
  paint: { 'circle-color': color, 'circle-radius': radius, 'circle-opacity': 0.9, 'circle-stroke-color': dark ? '#151918' : '#fbfcfa', 'circle-stroke-width': 1 } })
export const icon = (id: string, image: any, size: number, color = '#fff', extra: any = {}) => ({ id, type: 'symbol', ...extra,
  layout: { 'icon-image': image, 'icon-size': size, 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-color': color } })
export const fill = (id: string, color: any, opacity = 0.28, extra: any = {}) => ({ id, type: 'fill', ...extra, paint: { 'fill-color': color, 'fill-opacity': opacity } })
export const line = (id: string, color: any, width: any = 2, extra: any = {}) => ({ id, type: 'line', ...extra, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': width } })
export const ramp = (input: any, stops: number[], colors: string[]) => ['interpolate', ['linear'], input, ...stops.flatMap((s, i) => [s, colors[i]])]
export const I = (dark: boolean) => RAMPS.inferno[dark ? 'dark' : 'light']
export const magColor = (dark: boolean) => ramp(['get', 'mag'], MAG_STOPS, I(dark))
export const magRadius = ['interpolate', ['exponential', 1.6], ['get', 'mag'], 1, 2.5, 5, 7, 8, 22]
// Okabe-Ito, colour-blind safe, for categories
export const OI = { blue: '#0072B2', green: '#009E73', orange: '#E69F00', pink: '#CC79A7', sky: '#56B4E9', yellow: '#F0E442', red: '#D55E00' }

// --- zip, read in the browser (data.sa.gov.au and CWA ship zips): central directory, then inflate with DecompressionStream.
export async function unzip(buf: ArrayBuffer, want: (name: string) => boolean) {
  const v = new DataView(buf), u8 = new Uint8Array(buf), out: { name: string; text: string }[] = []
  let e = buf.byteLength - 22
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--
  if (e < 0) throw new Error('not a zip file')
  for (let p = v.getUint32(e + 16, true), n = v.getUint16(e + 10, true); n--; ) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true)
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)), local = v.getUint32(p + 42, true)
    p += 46 + nl + v.getUint16(p + 30, true) + v.getUint16(p + 32, true)
    if (!want(name)) continue
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true), raw = u8.subarray(start, start + size)
    const body = method === 0 ? new Response(raw) : new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')))
    out.push({ name, text: (await body.text()).replace(/^﻿/, '') })
  }
  return out
}
export const zipFrom = async (url: string, want: (n: string) => boolean) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`)
  return unzip(await r.arrayBuffer(), want)
}

// EPSG:3107 GDA94 / SA Lambert to lon/lat (Snyder, LCC 2SP on GRS80). Matches pyproj to 1e-12° (checked 2026-10-11).

export function heights(id: string, dark: boolean) {
  const V = RAMPS.viridis[dark ? 'dark' : 'light']
  return { id, type: 'fill-extrusion', paint: { 'fill-extrusion-color': ramp(['get', 'height'], [0, 30, 80, 150, 300], V), 'fill-extrusion-height': ['get', 'height'],
    'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0], 'fill-extrusion-opacity': 0.92 } }
}
// Grid cells of `size` degrees covering the view inside the area. Too many cells = zoom in first.
export function cellsFor(b: Bbox, area: Bbox, size: number) {
  const w = Math.max(b[0], area[0]), s = Math.max(b[1], area[1]), e = Math.min(b[2], area[2]), n = Math.min(b[3], area[3]), out: Bbox[] = []
  if (w > e || s > n) return out
  for (let i = Math.floor(w / size); i <= Math.floor(e / size); i++) for (let j = Math.floor(s / size); j <= Math.floor(n / size); j++) {
    out.push([i * size, j * size, (i + 1) * size, (j + 1) * size].map(v => Math.round(v * 1e6) / 1e6) as Bbox)
    if (out.length > 40) return null
  }
  return out
}
export const meets = (b: Bbox, a: Bbox) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])
// A representative point of any geometry (its first position): enough to count what is in view.
export const firstXY = (g: any): number[] | null => { let c = g?.coordinates; while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]; return Array.isArray(c) ? c : null }
export const inBox = ([x, y]: number[], b: Bbox) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]