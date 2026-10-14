// 3D marks (option `marks`; Helen 2026-10-13 chose O2, three.js instanced meshes, after comparing it with O1 MapLibre
// extrusions, kept as `shapes`, and O3 deck.gl, dropped: deck.gl 9.4 cannot draw inside MapLibre 6, so it could not hide behind buildings). At city zoom the
// points of the views on show become 3D objects; further out they stay 2D, as the games do. Aircraft and satellites have a real
// height, so they fly at it at every zoom. Every object reads its colour and size from the 2D marker MapLibre has already
// styled (queryRenderedFeatures returns the evaluated paint), so no layer's styling is written twice. One shape table, three
// renderers: three.js instanced meshes (default) and MapLibre fill-extrusions.
import * as maplibregl from 'maplibre-gl'

export type MarksMode = '2d' | 'shapes' | 'three'
export const MARKS_ZOOM = 12
type Part = { prim: 'cyl' | 'cone' | 'box' | 'sphere'; sides?: number; r?: number; w?: number; l?: number; x?: number; y?: number; z0: number; z1: number; tint?: 'white' | 'dark'
  mat?: 'bus' | 'panel' | 'metal' | 'glow' | 'aurora' }   // mat: a dedicated three.js look (the satellite); without it, plain lit colour
type Mark = { lon: number; lat: number; alt: number; s: number; h: number; c: [number, number, number]; kind: string; yaw: number }

// Unit shapes: r, w, l and y in footprint radii (s metres), z in heights (h metres). 'tint' parts keep a fixed colour.
const SHAPES: Record<string, Part[]> = {
  cone: [{ prim: 'cyl', r: 1.1, z0: 0, z1: 0.08, tint: 'dark' }, { prim: 'cone', r: 0.8, z0: 0.08, z1: 1, sides: 16 }, { prim: 'cyl', r: 0.48, z0: 0.42, z1: 0.56, tint: 'white', sides: 16 }],
  warn: [{ prim: 'cone', sides: 3, r: 1, z0: 0, z1: 1 }],
  flame: [{ prim: 'sphere', r: 0.7, z0: 0, z1: 0.55 }, { prim: 'cone', sides: 8, r: 0.6, z0: 0.3, z1: 1 }],
  pillar: [{ prim: 'cyl', r: 1.3, z0: 0, z1: 0.04, tint: 'dark', sides: 24 }, { prim: 'cyl', r: 0.55, z0: 0, z1: 1, sides: 16 }],
  station: [{ prim: 'cyl', r: 1.3, z0: 0, z1: 0.15, tint: 'white', sides: 24 }, { prim: 'cyl', r: 1.0, z0: 0.15, z1: 0.6, sides: 24 }],   // the line colour on top, seen from above
  tower: [{ prim: 'cyl', r: 0.3, z0: 0, z1: 0.8, tint: 'white' }, { prim: 'cyl', r: 0.75, z0: 0.8, z1: 1, sides: 8 }],
  pin: [{ prim: 'cyl', r: 0.12, z0: 0, z1: 0.7, tint: 'dark' }, { prim: 'sphere', r: 0.55, z0: 0.55, z1: 1 }],
  plane: [{ prim: 'box', w: 0.28, l: 1.8, z0: 0, z1: 0.28 }, { prim: 'box', w: 1.9, l: 0.4, y: 0.1, z0: 0.08, z1: 0.18 }, { prim: 'box', w: 0.7, l: 0.25, y: -0.75, z0: 0.1, z1: 0.18 }],
  // A flat-panel satellite (Helen 2026-10-14, after a Starlink reference: black bus, long gridded solar wings, booms, dishes),
  // our own simple geometry. Span about 6 s; the light on top keeps the 2D legend's altitude colour.
  // Large groups (Starlink, every active satellite, debris): a small glowing point each, so thousands stay readable
  satdot: [{ prim: 'sphere', r: 0.5, z0: 0, z1: 1, mat: 'glow' }],
  // Aurora: a thin vertical curtain per 1-degree forecast cell, 100 to 300 km up, additive green fading upwards (real size, not screen size)
  aurora: [{ prim: 'box', w: 2, l: 0.02, z0: 0, z1: 1, mat: 'aurora' }],
  sat: [
    { prim: 'box', w: 0.8, l: 0.6, z0: 0.4, z1: 0.48, mat: 'bus', tint: 'dark' },
    { prim: 'box', w: 2.4, l: 0.7, x: 1.85, z0: 0.435, z1: 0.445, mat: 'panel', tint: 'white' },
    { prim: 'box', w: 2.4, l: 0.7, x: -1.85, z0: 0.435, z1: 0.445, mat: 'panel', tint: 'white' },
    { prim: 'box', w: 0.27, l: 0.03, x: 0.53, z0: 0.43, z1: 0.45, mat: 'metal', tint: 'white' },
    { prim: 'box', w: 0.27, l: 0.03, x: -0.53, z0: 0.43, z1: 0.45, mat: 'metal', tint: 'white' },
    ...[[0.32, 0.22], [-0.32, 0.22], [0.32, -0.22], [-0.32, -0.22]].map(([x, y]) => ({ prim: 'sphere' as const, r: 0.075, x, y, z0: 0.34, z1: 0.42, mat: 'metal' as const, tint: 'white' as const })),
    { prim: 'sphere', r: 0.06, z0: 0.48, z1: 0.56, mat: 'glow' },
  ],
}
const TINT = { white: [236, 240, 238] as [number, number, number], dark: [42, 47, 45] as [number, number, number] }
const AIR = new Set(['plane', 'sat', 'satdot', 'aurora'])

function kindOf(id: string) {
  if (/works/.test(id)) return 'cone'
  if (/inc|rfs|gdacs|warn|closed|outback|crash/.test(id)) return 'warn'
  if (/hot|fire|nifc|bushfire/.test(id)) return 'flame'
  if (/quake|school|tw-age/.test(id)) return 'pillar'   // sized by their data: the height carries it
  if (/mtr-st|stop/.test(id)) return 'station'
  if (/^a-/.test(id)) return 'tower'
  if (/flights/.test(id)) return 'plane'
  if (/^s-dot/.test(id)) return 'sat'
  return 'pin'
}
// Our point layers (circles) and their icons; labels stay 2D.
const isMarkCircle = (l: any) => l.type === 'circle' && l.id !== 'L-aurora' && /^(z-|t-mtr-st|a-dot|a-world|s-dot|L-|f-.*-pt$)/.test(l.id)   // the aurora glow stays 2D under its curtains
const isMarkIcon = (l: any) => l.type === 'symbol' && /-icon$/.test(l.id)

export class Marks {
  mode: MarksMode = '2d'
  private faded = new Map<string, any>()
  private key = ''
  private three?: { layer: any; set: (marks: Mark[], origin: [number, number]) => void; hit: (pt: { x: number; y: number }) => Mark | null }
  private loading: Partial<Record<'three', Promise<void>>> = {}   // one load each, however often draw runs meanwhile
  private last: Mark[] = []
  orbits: { i: number; pts: number[][] }[] = []   // set by the engine: one ring per satellite, [lon, lat, alt km]
  private rings: { pts: number[][]; c: [number, number, number] }[] = []

  constructor(private m: maplibregl.Map, private visible: () => string[]) {
    m.on('idle', () => { if (this.mode !== '2d') this.update() })
    // while zooming or tilting too, so objects keep their screen size instead of growing until the map stops
    let t = 0
    m.on('move', () => { if (this.mode !== '2d' && !t) t = window.setTimeout(() => { t = 0; this.update() }, 150) })
    m.on('style.load', () => { this.faded.clear(); this.key = ''; this.three = undefined; delete this.loading.three; this.mode = '2d' })   // the engine re-applies the mode after install
  }

  setMode(mode: MarksMode) {
    if (mode === this.mode) return
    this.mode = mode; this.key = ''
    this.fade(mode !== '2d')
    this.draw([])
    if (mode !== '2d') this.update()
  }

  // 2D markers fade out where their 3D object takes over (city zoom; every zoom for things in the air)
  private fade(on: boolean) {
    const m = this.m
    for (const l of m.getStyle().layers) {
      if (!isMarkCircle(l) && !isMarkIcon(l)) continue
      const from = AIR.has(kindOf(l.id === 's-icon' ? 's-dot' : l.id.replace(/-icon$/, ''))) ? 0 : MARKS_ZOOM   // s-icon sits on s-dot
      for (const p of l.type === 'circle' ? ['circle-opacity', 'circle-stroke-opacity'] : ['icon-opacity']) {
        const k = `${l.id}|${p}`
        if (!this.faded.has(k)) this.faded.set(k, m.getPaintProperty(l.id, p) ?? 1)
        try { m.setPaintProperty(l.id, p, on ? ['step', ['zoom'], this.faded.get(k), from, 0] : this.faded.get(k)) } catch (e) { console.warn('marks: cannot fade', l.id, e) }
      }
    }
  }

  private collect(): Mark[] {
    const m = this.m, z = m.getZoom(), vis = new Set(this.visible())
    const ids = m.getStyle().layers.filter(l => isMarkCircle(l) && vis.has(l.id) && m.getLayoutProperty(l.id, 'visibility') !== 'none').map(l => l.id)
    const cam = camera(m), satC = new Map<number, [number, number, number]>()
    const out: Mark[] = [], seen = new Set<string>(), rendered = m.queryRenderedFeatures({ layers: ids })
    // queryRenderedFeatures returns nothing on the zoomed-out globe (seen 2026-10-14, MapLibre 6.13, even for the country layer at
    // the screen centre). Things in the air live there, so for them read the source and evaluate the layer's paint ourselves.
    // ponytail: style._layers[..].paint is MapLibre internal; if it changes, satellites fall back to grey dots of radius 5.
    for (const id of ids) {
      if (!AIR.has(kindOf(id)) || rendered.some(f => f.layer.id === id)) continue
      const L: any = (m as any).style?._layers?.[id], st: any = m.getStyle().layers.find(l => l.id === id)
      const ev = (k: string, f: any) => { try { return L.paint.get(k).evaluate(f, {}) } catch { return undefined } }
      for (const f of m.querySourceFeatures(st.source, st['source-layer'] ? { sourceLayer: st['source-layer'] } : undefined))
        (rendered as any).push({ ...f, geometry: f.geometry, properties: f.properties,
          layer: { id, paint: { 'circle-color': ev('circle-color', f), 'circle-radius': ev('circle-radius', f), 'circle-stroke-color': ev('circle-stroke-color', f), 'circle-stroke-width': ev('circle-stroke-width', f) } } })
    }
    for (const f of rendered) {
      if (f.geometry.type !== 'Point' || out.length >= 15000) continue
      const paint0: any = (f.layer as any).paint || {}
      let kind = kindOf(f.layer.id)
      if (kind === 'sat' && (paint0['circle-radius'] ?? 5) < 4) kind = 'satdot'   // the 2D layer draws big groups as small dots
      const air = AIR.has(kind)
      if (z < MARKS_ZOOM && !air) continue
      const [lon, lat] = (f.geometry as any).coordinates as number[], k = `${f.layer.id}|${lon}|${lat}`
      if (seen.has(k)) continue
      seen.add(k)
      const paint: any = (f.layer as any).paint || {}
      const fill = paint['circle-color'], ring = (paint['circle-stroke-width'] ?? 0) >= 2 || (fill && fill.a === 0)   // ring or hollow marker: its colour is the stroke
      const col = (ring && paint['circle-stroke-color']) || fill || { r: 0.5, g: 0.5, b: 0.5 }
      const alt = kind === 'plane' ? +(f.properties as any)?.alt_m || 0 : kind === 'sat' || kind === 'satdot' ? (+(f.properties as any)?.alt || 0) * 1000 : 0
      const mpp = cam.mpp([lon, lat], alt)   // metres per screen pixel at the object itself: its distance from the camera, not the ground's
      const s = Math.max(paint['circle-radius'] ?? 5, 3.5) * mpp * (kind === 'station' ? 1.6 : kind === 'satdot' ? 1.6 : air ? 3.5 : 1.1), p: any = f.properties || {}
      if (kind === 'sat' || kind === 'satdot') satC.set(+p.i, [Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255)])
      out.push({ lon, lat, kind, s, h: air ? s : s * 3.5, yaw: kind === 'sat' ? ((+p.i || 0) * 47) % 360 : +p.track || 0,   // satellites: a fixed heading each, so they do not all line up
        alt,
        c: [Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255)] })
    }
    // Aurora curtains, from the forecast layer's own source (queries return nothing on the zoomed-out globe)
    if (vis.has('L-aurora') && m.getLayer('L-aurora') && m.getLayoutProperty('L-aurora', 'visibility') !== 'none') {
      const got = new Set<string>()
      for (const f of m.querySourceFeatures('L-aurora')) {
        const [lon, lat] = (f.geometry as any).coordinates as number[], k = `${lon}|${lat}`, pc = +(f.properties as any)?.p || 0
        if (got.has(k)) continue
        got.add(k)
        const g = Math.min(1, 0.25 + pc / 60)
        out.push({ lon, lat, kind: 'aurora', s: 111320 * Math.cos(lat * Math.PI / 180) * 0.5, h: 200e3, alt: 100e3, yaw: 0, c: [Math.round(60 * g), Math.round(255 * g), Math.round(130 * g)] })
      }
    }
    // each ring in its satellite's altitude colour, lifted towards white so the low (dark blue) orbits show on the night globe;
    // satellites behind the globe have no 2D colour to read, so their rings are light grey
    const lift = (c: number[]) => c.map(v => Math.round(v + (255 - v) * 0.45)) as [number, number, number]
    this.rings = vis.has('s-dot') ? this.orbits.map(o => ({ pts: o.pts, c: lift(satC.get(o.i) || [200, 205, 210]) })) : []
    return out
  }

  // The 3D object under a click, as the screen point of its base, where the (transparent) 2D marker is: the engine's pick reads that
  hit(pt: { x: number; y: number }) {
    const d = this.mode === 'three' ? this.three?.hit(pt) : null
    return d ? this.m.project([d.lon, d.lat]) : null
  }

  update() {
    const marks = this.collect()
    const c = this.m.getCenter(), key = `${this.mode}|${marks.length}|${this.m.getZoom().toFixed(2)}|${c.lng.toFixed(4)}|${c.lat.toFixed(4)}`
    if (key === this.key) return
    this.key = key
    this.draw(marks)
  }

  private draw(marks: Mark[]) {
    const m = this.m
    this.last = marks
    // O1 shapes
    const src = m.getSource('m3') as maplibregl.GeoJSONSource | undefined
    if (this.mode === 'shapes') {
      const fc = shapes(marks) as any
      if (src) src.setData(fc)
      else {
        m.addSource('m3', { type: 'geojson', data: fc })
        m.addLayer({ id: 'm3-shapes', type: 'fill-extrusion', source: 'm3', paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true } }, m.getLayer('countries-hit') ? 'countries-hit' : undefined)
      }
    } else if (src) src.setData({ type: 'FeatureCollection', features: [] })
    // O2 three.js
    if (this.mode === 'three') { if (!this.three) (this.loading.three ||= this.loadThree()).then(() => this.mode === 'three' && this.three?.set(this.last, m.getCenter().toArray() as [number, number])); else this.three.set(marks, m.getCenter().toArray() as [number, number]) }
    else this.three?.set([], [0, 0])
  }

  private async loadThree() {
    const T = await import('three'), m = this.m
    let P = new T.Matrix4(), owner: Mark[][] = []
    let rings: any[] = []
    let scene: any, camera: any, renderer: any, origin: [number, number] = [0, 0], meshes: any[] = [], marks: Mark[] = [], builtGlobe: boolean | null = null
    const geos = new Map<string, any>()
    const R = 6371008.8   // MapLibre's earth radius (metres), as in its globe + three.js example
    // On the globe: the instance sits on the unit sphere, lifted by its altitude; our parts are x east, y north, z up.
    const globeAt = (d: Mark) => new T.Matrix4().makeRotationY(d.lon / 180 * Math.PI)
      .multiply(new T.Matrix4().makeRotationX(-d.lat / 180 * Math.PI))
      .multiply(new T.Matrix4().makeTranslation(0, 0, 1 + d.alt / R))
      .multiply(new T.Matrix4().makeRotationX(Math.PI / 2))
      .multiply(new T.Matrix4().makeScale(1 / R, 1 / R, 1 / R))
      .multiply(new T.Matrix4().makeRotationX(-Math.PI / 2))
    // Canvas textures for the satellite: solar cells (light blue-grey, fine grid) and the bus (black panels, faint seams)
    const grid = (w: number, h: number, bg: string, line: string, cols: number, rows: number, edge: string) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const g = c.getContext('2d')!; g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = line; g.lineWidth = 1.5
      for (let i = 1; i < cols; i++) { g.beginPath(); g.moveTo(i * w / cols, 0); g.lineTo(i * w / cols, h); g.stroke() }
      for (let j = 1; j < rows; j++) { g.beginPath(); g.moveTo(0, j * h / rows); g.lineTo(w, j * h / rows); g.stroke() }
      g.strokeStyle = edge; g.lineWidth = 4; g.strokeRect(1, 1, w - 2, h - 2)
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t
    }
    // The curtain's glow: bright at its foot, fading out towards the top
    const fade = () => {
      const c = document.createElement('canvas'); c.width = 4; c.height = 128
      const g = c.getContext('2d')!, gr = g.createLinearGradient(0, 0, 0, 128)
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgb(90,90,90)'); gr.addColorStop(0.9, 'rgb(255,255,255)'); gr.addColorStop(1, 'rgb(160,160,160)')
      g.fillStyle = gr; g.fillRect(0, 0, 4, 128)
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t
    }
    const mats = new Map<string, any>()
    const material = (p: Part) => {
      const k = p.mat || 'plain'
      if (!mats.has(k)) mats.set(k, k === 'panel' ? new T.MeshPhongMaterial({ map: grid(1024, 256, '#bccfe0', '#7f95a8', 36, 4, '#eef4f8'), emissive: 0x2c3c4c, specular: 0xc8d6e2, shininess: 70, side: T.DoubleSide })
        : k === 'bus' ? new T.MeshPhongMaterial({ map: grid(256, 192, '#0d0f10', '#3a4046', 4, 2, '#8a939a'), specular: 0x7a848c, shininess: 90 })
        : k === 'metal' ? new T.MeshPhongMaterial({ color: 0xd9dee2, specular: 0xffffff, shininess: 120 })
        : k === 'glow' ? new T.MeshBasicMaterial({ color: 0xffffff })
        : k === 'aurora' ? new T.MeshBasicMaterial({ map: fade(), transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })
        : new T.MeshLambertMaterial({ color: 0xffffff }))
      return mats.get(k)
    }
    const geo = (p: Part) => {
      const k = JSON.stringify(p)
      if (!geos.has(k)) geos.set(k, partGeometry(T, p))
      return geos.get(k)
    }
    const build = (globe: boolean) => {
      for (const x of meshes) { scene.remove(x); x.dispose() }   // materials and geometries are cached and shared
      for (const x of rings) { scene.remove(x); x.geometry.dispose(); x.material.dispose() }
      rings = []
      meshes = []; owner = []; builtGlobe = globe
      const oc = maplibregl.MercatorCoordinate.fromLngLat(origin, 0), u = oc.meterInMercatorCoordinateUnits()
      const tilt = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), 35 * Math.PI / 180)
      const q = new T.Quaternion(), zAxis = new T.Vector3(0, 0, 1), local = new T.Matrix4(), col = new T.Color()
      if (globe) for (const r of this.rings) {   // orbit rings: globe view only (in the flat map a ring would cross the antimeridian)
        const g = new T.BufferGeometry().setFromPoints(r.pts.map(([lon, lat, alt]) => new T.Vector3(0, 0, 1 + alt * 1000 / R)
          .applyMatrix4(new T.Matrix4().makeRotationY(lon / 180 * Math.PI).multiply(new T.Matrix4().makeRotationX(-lat / 180 * Math.PI)))))
        const line = new T.LineLoop(g, new T.LineBasicMaterial({ color: col.setRGB(r.c[0] / 255, r.c[1] / 255, r.c[2] / 255, T.SRGBColorSpace).clone(), transparent: true, opacity: 0.6, depthWrite: false }))
        line.frustumCulled = false
        scene.add(line); rings.push(line)
      }
      for (const [kind, list] of group(marks)) SHAPES[kind].forEach(p => {
        const mesh = new T.InstancedMesh(geo(p), material(p), list.length)
        mesh.frustumCulled = false   // the instances are placed by our matrices, not the unit geometry's bounds
        list.forEach((d, i) => {
          q.setFromAxisAngle(zAxis, -d.yaw * Math.PI / 180)
          if (kind === 'sat') q.multiply(tilt)   // arrays tilted, so the wings catch the light and read from an oblique camera
          if (globe) local.compose(new T.Vector3(0, 0, 0), q, new T.Vector3(d.s, d.s, d.h)).premultiply(globeAt(d))
          else { const mc = maplibregl.MercatorCoordinate.fromLngLat([d.lon, d.lat], 0)
            local.compose(new T.Vector3((mc.x - oc.x) / u, -(mc.y - oc.y) / u, d.alt), q, new T.Vector3(d.s, d.s, d.h)) }
          mesh.setMatrixAt(i, local)
          const c = p.mat === 'glow' || p.mat === 'aurora' ? d.c : p.mat ? [255, 255, 255] : p.tint ? TINT[p.tint] : d.c
          mesh.setColorAt(i, col.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, T.SRGBColorSpace))
        })
        scene.add(mesh); meshes.push(mesh); owner.push(list)
      })
    }
    const layer: any = {
      id: 'm3-three', type: 'custom', renderingMode: '3d',
      onAdd: (_: any, gl: WebGLRenderingContext) => {
        scene = new T.Scene(); camera = new T.Camera()
        scene.add(new T.AmbientLight(0xffffff, 1.4))
        const sun = new T.DirectionalLight(0xffffff, 1.6); sun.position.set(0.4, -0.8, 1.5); scene.add(sun)
        renderer = new T.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true }); renderer.autoClear = false
      },
      render: (_: any, args: any) => {
        if (!scene || !marks.length) return
        const globe = args.defaultProjectionData.projectionTransition > 0
        if (globe !== builtGlobe) build(globe)
        P = new T.Matrix4().fromArray(args.defaultProjectionData.mainMatrix)
        if (!globe) { const o = maplibregl.MercatorCoordinate.fromLngLat(origin, 0), u = o.meterInMercatorCoordinateUnits()
          P.multiply(new T.Matrix4().makeTranslation(o.x, o.y, o.z).scale(new T.Vector3(u, -u, u))) }
        camera.projectionMatrix = P
        renderer.resetState(); renderer.render(scene, camera)
      },
    }
    const add = () => { if (!m.getLayer('m3-three')) m.addLayer(layer, m.getLayer('countries-hit') ? 'countries-hit' : undefined) }
    add()
    this.three = {
      layer,
      hit: pt => {   // a ray through the click, in the same space the instances were drawn in
        if (!meshes.length) return null
        const c = m.getCanvas(), x = pt.x / c.clientWidth * 2 - 1, y = -pt.y / c.clientHeight * 2 + 1, inv = P.clone().invert()
        const a = new T.Vector3(x, y, -1).applyMatrix4(inv), b = new T.Vector3(x, y, 1).applyMatrix4(inv)
        const ray = new T.Raycaster(a, b.sub(a).normalize()), hits = ray.intersectObjects(meshes, false)
        const h = hits.find((r: any) => r.instanceId != null)
        return h ? owner[meshes.indexOf(h.object)][h.instanceId] : null
      },
      set: (next, o) => { add(); marks = next; origin = o; builtGlobe = null; if (scene && !next.length) { for (const x of [...meshes, ...rings]) scene.remove(x); meshes = []; rings = [] } m.triggerRepaint() },
    }
  }
}

// Where the camera is, in metres around the map centre, from the public camera state. MapLibre's default field of view (36.87°)
// puts the camera 1.5 viewport heights from the centre. ponytail: flat-earth offsets; good at city zoom, rough for satellites.
function camera(m: maplibregl.Map) {
  const c = m.getCenter(), H = m.getCanvas().clientHeight, p = m.getPitch() * Math.PI / 180, b = m.getBearing() * Math.PI / 180
  const kx = 111320 * Math.cos(c.lat * Math.PI / 180), mppC = 40075016.686 * Math.cos(c.lat * Math.PI / 180) / (512 * 2 ** m.getZoom())
  const D = 1.5 * H * mppC, ex = -Math.sin(b) * D * Math.sin(p), ny = -Math.cos(b) * D * Math.sin(p), cz = D * Math.cos(p)
  return { mpp: ([lon, lat]: number[], alt: number) => {
    let dx = lon - c.lng; dx = ((dx + 540) % 360) - 180
    const d = Math.hypot(dx * kx - ex, (lat - c.lat) * 110540 - ny, alt - cz)
    return mppC * Math.max(d, D * 0.05) / D
  } }
}

function group(marks: Mark[]) {
  const g = new Map<string, Mark[]>()
  for (const d of marks) { if (!g.has(d.kind)) g.set(d.kind, []); g.get(d.kind)!.push(d) }
  return g
}

// A unit part, z up: footprint radius 1 = s metres, height 1 = h metres (scaled per instance).
function partGeometry(T: any, p: Part) {
  const dz = p.z1 - p.z0, mid = (p.z0 + p.z1) / 2
  const g = p.prim === 'box' ? new T.BoxGeometry(p.w, p.l, dz)
    : p.prim === 'sphere' ? new T.SphereGeometry(p.r, 16, 12).rotateX(Math.PI / 2).scale(1, 1, dz / (2 * p.r!))
    : (p.prim === 'cone' ? new T.ConeGeometry(p.r, dz, p.sides || 12) : new T.CylinderGeometry(p.r, p.r, dz, p.sides || 12)).rotateX(Math.PI / 2)
  return g.translate(p.x || 0, p.y || 0, mid)
}

// O1: each part as extruded polygons (a cone or sphere as stacked rings), in lon/lat around the mark.
function shapes(marks: Mark[]) {
  const features: any[] = []
  const ring = (d: Mark, pts: [number, number][]) => {
    const kx = 1 / (111320 * Math.cos(d.lat * Math.PI / 180)), ky = 1 / 110540, a = -d.yaw * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a)
    const r = pts.map(([x, y]) => [d.lon + (x * ca - y * sa) * kx, d.lat + (x * sa + y * ca) * ky])
    return [[...r, r[0]]]
  }
  const poly = (d: Mark, c: number[], pts: [number, number][], z0: number, z1: number) => features.push({ type: 'Feature',
    properties: { c: `rgb(${c.join(',')})`, base: d.alt + z0 * d.h, top: d.alt + z1 * d.h }, geometry: { type: 'Polygon', coordinates: ring(d, pts) } })
  const circle = (r: number, n: number) => Array.from({ length: n }, (_, i) => [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)] as [number, number])
  for (const d of marks) for (const p of SHAPES[d.kind]) {
    const c = p.tint ? TINT[p.tint] : d.c, n = p.sides || 12
    const ox = (p.x || 0) * d.s, oy = (p.y || 0) * d.s, at = (pts: [number, number][]) => pts.map(([x, y]) => [x + ox, y + oy] as [number, number])
    if (p.prim === 'box') { const w = p.w! * d.s / 2, l = p.l! * d.s / 2; poly(d, c, at([[-w, -l], [w, -l], [w, l], [-w, l]]), p.z0, p.z1) }
    else if (p.prim === 'cyl') poly(d, c, at(circle(p.r! * d.s, n)), p.z0, p.z1)
    else {   // cone and sphere: stacked rings
      const steps = 5
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps, t1 = (i + 1) / steps, tm = (t0 + t1) / 2
        const k = p.prim === 'cone' ? 1 - tm : Math.sqrt(Math.max(0, 1 - (2 * tm - 1) ** 2))
        poly(d, c, at(circle(Math.max(k, 0.12) * p.r! * d.s, n)), p.z0 + t0 * (p.z1 - p.z0), p.z0 + t1 * (p.z1 - p.z0))
      }
    }
  }
  return { type: 'FeatureCollection', features }
}
