// Drive or ride on /sim (Helen 2026-10-14, after Taipei GTA: reference only). A car or a scooter moves along the real road
// network in view (Hong Kong: the Transport Department's Road Network via AlreadyOpen hk-roads, its own one-way rules and street
// names; elsewhere OpenStreetMap roads from the OpenFreeMap tiles, one-way rules included) with the camera chasing at street
// level; every layer of the map stays on. Arcade rules: no traffic and no collisions. At a junction it takes the road
// nearest to where you steer; it never drives the wrong way down a one-way road.
import type maplibregl from 'maplibre-gl'

export type Vehicle = 'car' | 'scooter'
const SPEC: Record<Vehicle, { max: number; acc: number; len: number; wid: number; h: number; color: string }> = {
  car: { max: 70 / 3.6, acc: 3.2, len: 4.5, wid: 1.8, h: 1.5, color: '#D55E00' },
  scooter: { max: 55 / 3.6, acc: 4, len: 1.9, wid: 0.75, h: 1.3, color: '#0072B2' },
}
const DRIVABLE: Record<string, boolean> = { motorway: true, trunk: true, primary: true, secondary: true, tertiary: true, minor: true, service: true, busway: false }
const SCOOTER_NOT = new Set(['motorway'])   // scooters stay off motorways (OSM class; TD's network in Hong Kong has no road class)
const HK_BOX = [113.8, 22.13, 114.45, 22.57]
type Node = { x: number; y: number; out: Edge[] }
type Edge = { a: Node; b: Node; len: number; cls: string; name: string; one?: boolean }   // one: a one-way line (its middle is the carriageway's)
const K = (p: number[]) => `${Math.round(p[0] * 2e5)},${Math.round(p[1] * 2e5)}`   // ~0.5 m: joins lines cut at tile edges

export class Driver {
  vehicle: Vehicle
  speed = 0
  heading = 0
  road = ''
  cls = ''
  stuck = ''
  private nodes = new Map<string, Node>()
  private edge: Edge | null = null
  private t = 0
  private keys = { up: false, down: false, left: false, right: false }
  private raf = 0
  private last = 0
  private lon0 = 0; private lat0 = 0; private kx = 1; private ky = 110540
  private built = 0
  hk = false   // in Hong Kong: TD's network and rules
  onTick?: () => void

  constructor(private map: maplibregl.Map, vehicle: Vehicle) { this.vehicle = vehicle }

  private xy(p: number[]) { return [(p[0] - this.lon0) * this.kx, (p[1] - this.lat0) * this.ky] }
  private ll(x: number, y: number): [number, number] { return [this.lon0 + x / this.kx, this.lat0 + y / this.ky] }

  // The road graph from the tiles loaded now (re-read as the camera moves on)
  private build() {
    const m = this.map
    if (!this.built) { const c = m.getCenter(); this.lon0 = c.lng; this.lat0 = c.lat; this.kx = 111320 * Math.cos(c.lat * Math.PI / 180) }
    this.built = performance.now()
    const node = (p: number[]) => { const k = K(p); let n = this.nodes.get(k); if (!n) { const [x, y] = this.xy(p); n = { x, y, out: [] }; this.nodes.set(k, n) } return n }
    if (this.hk) {   // TRAVEL_DIRECTION: 1 both ways, 3 one way in the drawn direction (the only codes TD uses)
      for (const f of m.querySourceFeatures('hkr', { sourceLayer: 'centerline' })) {
        const p = f.properties as any, g: any = f.geometry, lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
        const one = String(p.TRAVEL_DIRECTION) === '3', name = (p.STREET_ENAME || '').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())
        for (const l of lines) for (let i = 1; i < l.length; i++) {
          const a = node(l[i - 1]), b = node(l[i]); if (a === b) continue
          const len = Math.hypot(b.x - a.x, b.y - a.y), add = (u: Node, v: Node) => { if (!u.out.some(e => e.b === v)) u.out.push({ a: u, b: v, len, cls: one ? 'one-way' : 'two-way', name, one }) }
          add(a, b); if (!one) add(b, a)
        }
      }
      return
    }
    for (const f of m.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' })) {
      const p = f.properties as any
      if (!DRIVABLE[p.class] || p.brunnel === 'tunnel' && p.class === 'service' || (this.vehicle === 'scooter' && SCOOTER_NOT.has(p.class))) continue
      const g: any = f.geometry, lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
      const one = +p.oneway || 0
      for (const l of lines) for (let i = 1; i < l.length; i++) {
        const a = node(l[i - 1]), b = node(l[i]); if (a === b) continue
        const len = Math.hypot(b.x - a.x, b.y - a.y), add = (u: Node, v: Node) => { if (!u.out.some(e => e.b === v)) u.out.push({ a: u, b: v, len, cls: p.class, name: '', one: one !== 0 }) }
        if (one >= 0) add(a, b)
        if (one <= 0) add(b, a)
      }
    }
  }

  // Start on the drivable road nearest the map centre
  start() {
    const c0 = this.map.getCenter()
    this.hk = c0.lng > HK_BOX[0] && c0.lng < HK_BOX[2] && c0.lat > HK_BOX[1] && c0.lat < HK_BOX[3]
    if (this.hk) this.map.setLayoutProperty('v-hkr', 'visibility', 'visible')   // loads TD's centreline tiles (drawn invisible)
    this.build()
    const c = this.xy(this.map.getCenter().toArray())
    let best: Edge | null = null, bd = Infinity, bt = 0
    for (const n of this.nodes.values()) for (const e of n.out) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, t = Math.max(0, Math.min(1, ((c[0] - e.a.x) * dx + (c[1] - e.a.y) * dy) / (e.len * e.len)))
      const d = Math.hypot(e.a.x + dx * t - c[0], e.a.y + dy * t - c[1]); if (d < bd) { bd = d; best = e; bt = t }
    }
    if (!best) { this.stuck = this.hk ? 'TD\'s road network is still loading: press Drive again in a moment.' : 'No drivable road loaded here: zoom in on a city street, then press Drive again.'; return false }
    this.edge = best; this.t = bt * best.len; this.speed = 0; this.stuck = ''
    this.map.dragPan.disable(); this.map.scrollZoom.disable(); this.map.keyboard.disable(); (this.map as any).__driving = true   // engine: lighter work per move
    this.see(true)
    addEventListener('keydown', this.down); addEventListener('keyup', this.up)
    this.last = performance.now(); this.raf = requestAnimationFrame(this.frame)
    return true
  }
  stop() {
    cancelAnimationFrame(this.raf); removeEventListener('keydown', this.down); removeEventListener('keyup', this.up)
    this.map.dragPan.enable(); this.map.scrollZoom.enable(); this.map.keyboard.enable(); (this.map as any).__driving = false
    this.see(false)
    ;(this.map.getSource('drive') as any)?.setData({ type: 'FeatureCollection', features: [] })
    if (this.map.getLayer('v-hkr')) this.map.setLayoutProperty('v-hkr', 'visibility', 'none')
    this.map.easeTo({ pitch: 50, zoom: 16, duration: 600 })
  }
  press(k: keyof Driver['keys'], on: boolean) { this.keys[k] = on }
  // Buildings see-through while driving, so tall blocks never hide the vehicle; back to normal after
  private opac = new Map<string, any>()
  private see(on: boolean) {
    for (const l of this.map.getStyle().layers) if (l.type === 'fill-extrusion' && l.id !== 'v-drive' && l.id !== 'h-gen') {   // generated keep their own lighter look
      if (on) { this.opac.set(l.id, this.map.getPaintProperty(l.id, 'fill-extrusion-opacity')); this.map.setPaintProperty(l.id, 'fill-extrusion-opacity', 0.45) }
      else if (this.opac.has(l.id)) this.map.setPaintProperty(l.id, 'fill-extrusion-opacity', this.opac.get(l.id))
    }
  }
  private down = (e: KeyboardEvent) => this.key(e, true)
  private up = (e: KeyboardEvent) => this.key(e, false)
  private key(e: KeyboardEvent, on: boolean) {
    const k = ({ ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' } as const)[e.key]
    if (k && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) { this.keys[k] = on; e.preventDefault() }
  }

  // At the end of an edge: the next one nearest the steering (straight on unless a key says otherwise); never back the way it came
  private next(e: Edge): Edge | null {
    const h = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x), want = h + (this.keys.left ? Math.PI / 2 : this.keys.right ? -Math.PI / 2 : 0)
    let opts = e.b.out.filter(o => o.b !== e.a)
    // tiles cut roads where they meet and the two halves do not share a point: carry on along a road starting just ahead
    if (!opts.length) {
      let best: Node | null = null, bd = 15
      for (const n of this.nodes.values()) { if (n === e.b || n === e.a || !n.out.length) continue
        const dx = n.x - e.b.x, dy = n.y - e.b.y, d = Math.hypot(dx, dy)
        if (d < bd && (dx * Math.cos(h) + dy * Math.sin(h)) > -2) { best = n; bd = d } }
      if (best) opts = [{ a: e.b, b: best, len: Math.max(0.5, bd), cls: e.cls, name: '' }]
    }
    if (!opts.length) return null
    const diff = (o: Edge) => { let d = Math.atan2(o.b.y - o.a.y, o.b.x - o.a.x) - want; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d) }
    return opts.reduce((a, o) => diff(o) < diff(a) ? o : a)
  }

  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000), S = SPEC[this.vehicle]; this.last = now
    if (now - this.built > 1500) this.build()   // new tiles under the camera join the network
    if (this.keys.up) this.speed = Math.min(S.max, this.speed + S.acc * dt)
    else if (this.keys.down) this.speed = Math.max(0, this.speed - S.acc * 2.5 * dt)
    else this.speed = Math.max(0, this.speed - 0.8 * dt)
    let e = this.edge!, t = this.t + this.speed * dt
    while (t > e.len) {
      const n = this.next(e)
      if (!n) { t = e.len; this.speed = 0; this.stuck = 'Road ends here (or the map has not loaded further yet).'; break }
      t -= e.len; e = n; this.stuck = ''
    }
    this.edge = e; this.t = t
    const f = t / e.len, x = e.a.x + (e.b.x - e.a.x) * f, y = e.a.y + (e.b.y - e.a.y) * f
    const target = 90 - Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x) * 180 / Math.PI
    let d = target - this.heading; while (d > 180) d -= 360; while (d < -180) d += 360
    this.heading += d * Math.min(1, dt * 6)   // ease the turn
    this.cls = e.cls; this.road = e.name
    const pos = this.ll(x, y)
    this.draw(pos)
    this.map.jumpTo({ center: this.ll(x + Math.sin(this.heading * Math.PI / 180) * 6, y + Math.cos(this.heading * Math.PI / 180) * 6), bearing: this.heading, pitch: 70, zoom: 19.4 })
    this.onTick?.()
    this.raf = requestAnimationFrame(this.frame)
  }

  // The vehicle: a box on the road (fill-extrusion), pointing along the heading
  private draw(pos: [number, number]) {
    const S = SPEC[this.vehicle], a = this.heading * Math.PI / 180, [cx, cy] = this.xy(pos)
    const fx = Math.sin(a), fy = Math.cos(a), rx = Math.cos(a), ry = -Math.sin(a), off = this.edge?.one ? 0.4 : this.vehicle === 'car' ? 1.6 : 1.2   // metres off the centre line, to the side traffic keeps to
    const lane = this.laneSide() * off
    const c = (u: number, v: number) => this.ll(cx + fx * u + rx * (v + lane), cy + fy * u + ry * (v + lane))
    const ring = [c(-S.len / 2, -S.wid / 2), c(S.len / 2, -S.wid / 2), c(S.len / 2, S.wid / 2), c(-S.len / 2, S.wid / 2), c(-S.len / 2, -S.wid / 2)]
    ;(this.map.getSource('drive') as any)?.setData({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { h: S.h, color: S.color }, geometry: { type: 'Polygon', coordinates: [ring] } },
      { type: 'Feature', properties: { dot: true, color: S.color }, geometry: { type: 'Point', coordinates: c(0, 0) } }] })
  }
  // Which side of the road to drive on: left in places that drive on the left (by longitude/latitude boxes, coarse)
  private laneSide() {
    const [lon, lat] = [this.lon0, this.lat0]
    const left = (lon > 113.8 && lon < 114.5 && lat > 22.1 && lat < 22.6) || (lon > 113.5 && lon < 113.65 && lat > 22.1 && lat < 22.25)   // Hong Kong, Macau
      || (lon > 110 && lon < 155 && lat < -10) || (lon > 165 && lat < -33) || (lon > 128 && lon < 146 && lat > 30 && lat < 46)   // Australia, NZ, Japan
      || (lon > -11 && lon < 2 && lat > 49.8 && lat < 61) || (lon > 68 && lon < 98 && lat > 5 && lat < 36) || (lon > 95 && lon < 120 && lat > -9 && lat < 7) // UK+IE, South Asia, MY/SG/ID
      || (lon > 10 && lon < 41 && lat < -15)   // southern Africa
    return left ? -1 : 1
  }
}
