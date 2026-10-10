// One MapLibre world. The page may hold two (V4 compare); data is fetched once and shared (data.ts caches it).
import * as maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import * as D from './data'
import { MAP_ICONS, iconImage } from './icons'
import { HEIGHT_STOPS, MAG_STOPS, RAMPS, VIEWS, VIEW_IDS, type ViewId, HK, inHK } from './views'

let protocol = false
export type Theme = 'light' | 'dark'
export type EngineState = { views: ViewId[]; base: boolean; sub: Partial<Record<ViewId, string>>; time: 't1' | 't2' | 't3'; hour: number; day: number }
export type Pick = { view: ViewId; title: string; rows: [string, string][]; href?: string; source: string }

const STYLE = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' }
const SKY_FILES = [['overture', 'Overture Maps (ODbL), © OpenStreetMap contributors'], ['hk', 'Lands Department, CSDI Portal (Government of the HKSAR)'],
  ['nl', '<a href="https://docs.3dbag.nl/en/copyright/">© 3DBAG by tudelft3d and 3DGI</a>']]
const H: any = ['coalesce', ['get', 'height'], 0]
const ramp = (input: any, stops: number[], colors: string[]) => ['interpolate', ['linear'], input, ...stops.flatMap((s, i) => [s, colors[i]])]
const NEUTRAL = { light: { bld: '#d9dcd8', bldTop: '#c9ccc8', line: '#8d938f', nodata: '#e4e6e3' }, dark: { bld: '#3a3f3d', bldTop: '#454b48', line: '#7d8481', nodata: '#2f3432' } }
export const LAYERS: Record<ViewId | 'base', string[]> = {
  base: ['b-sky-overture', 'b-sky-hk', 'b-sky-nl', 'b-ov', 'b-mtr'],
  height: ['h-sky-overture', 'h-sky-hk', 'h-sky-nl', 'h-ov'],
  hazards: ['z-eonet', 'z-gdacs', 'z-quake', 'z-eonet-icon', 'z-gdacs-icon', 'z-quake-icon', 'z-quake-label'],
  transit: ['t-bus', 't-mtr', 't-mtr-st', 't-mtr-st-icon'],
  people: ['p-fill', 'p-line'],
  business: ['bz-fill', 'bz-line'],
  ...(import.meta.env.PUBLIC_EDITION === 'full' ? { rules: ['r-fill', 'r-line'] } : {}) as any,
}
const EONET_CAT: Record<string, string> = { severeStorms: 'storms', floods: 'floods', drought: 'floods', wildfires: 'fire', volcanoes: 'fire' }
// Which icon each hazard kind gets (GDACS event type, NASA EONET category id).
const GDACS_ICON: any = ['match', ['get', 'eventtype'], 'EQ', 'i-pulse', 'TC', 'i-hurricane', 'FL', 'i-drop', 'DR', 'i-sun-dim', 'WF', 'i-fire', 'VO', 'i-mountains', 'i-warning']
const EONET_ICON: any = ['match', ['get', 'catId'], 'severeStorms', 'i-hurricane', 'floods', 'i-drop', 'drought', 'i-sun-dim', 'wildfires', 'i-fire',
  'volcanoes', 'i-mountains', 'earthquakes', 'i-pulse', 'seaLakeIce', 'i-snowflake', 'snow', 'i-snowflake', 'i-warning']
const GDACS_CAT: Record<string, string> = { TC: 'storms', FL: 'floods', DR: 'floods', WF: 'fire', VO: 'fire' }

export class World {
  map: maplibregl.Map
  theme: Theme
  state: EngineState = { views: [], base: true, sub: {}, time: 't1', hour: 24, day: 30 }
  pending = new Set<Promise<any>>()
  onPick?: (p: Pick | null) => void
  onUpdate?: () => void
  busLoaded = new Set<string>()
  busLines: any[] = []
  busStops: any[] = []
  overture?: { url: string; release: string }
  private installed = false
  private peopleBy: Record<string, { v: number; year: string; src?: string }> = {}
  private peopleRamp: any = null
  private bizBy: Record<string, { v: number; year: string }> = {}
  private noData: any = null
  private gen = 0

  constructor(el: HTMLElement, theme: Theme, camera: { center: [number, number]; zoom: number; pitch?: number; bearing?: number }) {
    if (!protocol) { maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs'); maplibregl.addProtocol('pmtiles', new Protocol().tile); protocol = true }
    this.theme = theme
    this.map = new maplibregl.Map({ container: el, style: STYLE[theme], ...camera, maxPitch: 80, attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true } } as any)
    this.map.on('style.load', () => { this.installed = false; this.install(++this.gen).catch(e => console.error('world-views install failed', e)) })
    this.map.on('moveend', () => { this.loadBus(); this.onUpdate?.() })
    this.map.on('click', e => this.pick(e.point))
    // Start with the attribution folded (the i button opens it), so it does not run under the panels.
    this.map.once('load', () => this.map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'))
  }

  track<T>(p: Promise<T>) { this.pending.add(p); p.finally(() => this.pending.delete(p)); return p }

  setTheme(t: Theme) {
    if (t === this.theme) return
    this.theme = t
    this.map.setStyle(STYLE[t], { diff: false })
  }

  private async install(gen: number) {
    const m = this.map, n = NEUTRAL[this.theme], dark = this.theme === 'dark'
    m.setProjection({ type: 'globe' })
    for (const l of m.getStyle().layers) if ((l as any)['source-layer'] === 'building') m.setLayoutProperty(l.id, 'visibility', 'none')
    const ov = await this.track(D.overtureBuildings())
    if (ov.data) this.overture = ov.data
    if (this.installed || gen !== this.gen) return   // a newer style (theme switch) took over while we waited
    this.installed = true
    const hid = { visibility: 'none' } as any, V = RAMPS.viridis[this.theme]
    for (const [f, attribution] of SKY_FILES) {
      m.addSource('sky-' + f, { type: 'vector', url: `pmtiles://${D.SKY}/${f}.pmtiles`, attribution })
      for (const [pre, color] of [['b', n.bld], ['h', ramp(H, HEIGHT_STOPS, V)]] as const)
        m.addLayer({ id: `${pre}-sky-${f}`, type: 'fill-extrusion', source: 'sky-' + f, 'source-layer': 'skylines', maxzoom: 14, layout: hid,
          paint: { 'fill-extrusion-color': color as any, 'fill-extrusion-height': H, 'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0], 'fill-extrusion-opacity': 0.92 } })
    }
    if (this.overture) {
      m.addSource('ov', { type: 'vector', url: 'pmtiles://' + this.overture.url, attribution: 'Overture Maps (ODbL), © OpenStreetMap contributors' })
      const OH: any = ['coalesce', ['get', 'height'], ['*', ['get', 'num_floors'], 3], 3]
      for (const [pre, color] of [['b', n.bld], ['h', ['case', ['has', 'height'], ramp(['get', 'height'], HEIGHT_STOPS, V), n.nodata]]] as const)
        m.addLayer({ id: pre + '-ov', type: 'fill-extrusion', source: 'ov', 'source-layer': 'building', minzoom: 14, layout: hid,
          paint: { 'fill-extrusion-color': color as any, 'fill-extrusion-height': OH, 'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0], 'fill-extrusion-opacity': 0.92 } })
    }
    const empty: any = { type: 'FeatureCollection', features: [] }
    // Natural Earth 1:10m outlines as tiles (AlreadyOpen world-places): 1:50m sat km off at city zoom (Macau, Helen 2026-10-10)
    m.addSource('people', { type: 'vector', url: `pmtiles://${D.PLACES}/countries.pmtiles`,
      attribution: 'World Bank (CC BY 4.0); official statistics via AlreadyOpen world-places; Natural Earth' })
    m.addLayer({ id: 'countries-hit', type: 'fill', source: 'people', 'source-layer': 'countries', paint: { 'fill-opacity': 0 } })
    D.setPlaceLookup(async ([x, y]) => {
      if (!m.getSource('people')) return undefined
      // wait for this view's tiles; 'idle' never fires again if the map is already idle, so cap the wait
      if (!m.areTilesLoaded()) await Promise.race([m.once('idle'), new Promise(r => setTimeout(r, 4000))])
      const f = m.queryRenderedFeatures(m.project([x, y]), { layers: ['countries-hit'] })[0]
      return f ? { NAME_ENGL: f.properties.NAME, ISO3_CODE: D.isoOf(f.properties) } : null
    })
    for (const s of ['quakes', 'gdacs', 'eonet', 'mtr', 'mtr-st', 'bus'])
      m.addSource(s, { type: 'geojson', data: empty,
        attribution: { quakes: 'USGS', gdacs: 'GDACS', eonet: 'NASA EONET', mtr: 'hk-transit (Government of the HKSAR data)' }[s] } as any)
    const P = RAMPS.cividis[this.theme], I = RAMPS.inferno[this.theme]
    this.peopleRamp = P; this.noData = n.nodata
    m.addLayer({ id: 'p-fill', type: 'fill', source: 'people', 'source-layer': 'countries', layout: hid,
      paint: { 'fill-color': n.nodata, 'fill-opacity': 0.78 } })
    m.addLayer({ id: 'p-line', type: 'line', source: 'people', 'source-layer': 'countries', layout: hid, paint: { 'line-color': dark ? '#1d2120' : '#fbfcfa', 'line-width': 0.6 } })
    m.addLayer({ id: 'bz-fill', type: 'fill', source: 'people', 'source-layer': 'countries', layout: hid,
      paint: { 'fill-color': n.nodata, 'fill-opacity': 0.78 } })
    m.addLayer({ id: 'bz-line', type: 'line', source: 'people', 'source-layer': 'countries', layout: hid, paint: { 'line-color': dark ? '#1d2120' : '#fbfcfa', 'line-width': 0.6 } })
    if (import.meta.env.PUBLIC_EDITION === 'full') for (const [id, type, paint] of [['r-fill', 'fill', { 'fill-color': n.nodata, 'fill-opacity': 0.78 }],
      ['r-line', 'line', { 'line-color': dark ? '#1d2120' : '#fbfcfa', 'line-width': 0.6 }]] as const)
      m.addLayer({ id, type, source: 'people', 'source-layer': 'countries', layout: hid, paint } as any)
    m.addLayer({ id: 'b-mtr', type: 'line', source: 'mtr', layout: { ...hid, 'line-cap': 'round' }, paint: { 'line-color': n.line, 'line-width': 1.6, 'line-opacity': 0.8 } })
    m.addLayer({ id: 't-bus', type: 'line', source: 'bus', layout: { ...hid, 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': dark ? '#c9d1cd' : '#2c3330', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 1.6], 'line-opacity': dark ? 0.11 : 0.22 } })
    m.addLayer({ id: 't-mtr', type: 'line', source: 'mtr', layout: { ...hid, 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 15, 5] } })
    m.addLayer({ id: 't-mtr-st', type: 'circle', source: 'mtr-st', minzoom: 11, layout: hid,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 15, 8], 'circle-color': dark ? '#151918' : '#fbfcfa', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.5 } })
    const sev: any = ['match', ['get', 'alertlevel'], 'Red', 3, 'Orange', 2, 1]
    m.addLayer({ id: 'z-eonet', type: 'circle', source: 'eonet', layout: hid,
      paint: { 'circle-radius': 7, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': dark ? '#d8dedb' : '#2c3330', 'circle-stroke-width': 1.5 } })
    m.addLayer({ id: 'z-gdacs', type: 'circle', source: 'gdacs', layout: hid,
      paint: { 'circle-radius': ['*', 4, sev], 'circle-color': ramp(sev, [1, 2, 3], [I[1], I[2], I[3]]), 'circle-stroke-color': dark ? '#151918' : '#fbfcfa', 'circle-stroke-width': 1.5 } })
    m.addLayer({ id: 'z-quake', type: 'circle', source: 'quakes', layout: hid,
      paint: { 'circle-radius': ['interpolate', ['exponential', 1.6], ['get', 'mag'], 2.5, 2.5, 5, 7, 8, 22],
        'circle-color': ramp(['get', 'mag'], MAG_STOPS, I), 'circle-opacity': 0.88, 'circle-stroke-color': dark ? '#151918' : '#fbfcfa', 'circle-stroke-width': 1 } })
    m.addLayer({ id: 'z-quake-label', type: 'symbol', source: 'quakes', filter: ['>=', ['get', 'mag'], 5], layout: { ...hid,
      'text-field': ['concat', 'M', ['to-string', ['get', 'mag']]], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.4] },
      paint: { 'text-color': dark ? '#e6ebe8' : '#1d2120', 'text-halo-color': dark ? '#151918' : '#fbfcfa', 'text-halo-width': 1.5 } })
    // Iconify icons on the points (SDF, so one image takes any colour); circles keep the data colour underneath
    await Promise.all(Object.entries(MAP_ICONS).map(async ([id, d]) => { if (!m.hasImage(id)) m.addImage(id, await iconImage(d), { sdf: true, pixelRatio: 2 }) }))
    if (gen !== this.gen) return
    const icon = (id: string, source: string, image: any, size: any, color: any, extra: any = {}) =>
      m.addLayer({ id, type: 'symbol', source, ...extra, layout: { ...hid, 'icon-image': image, 'icon-size': size, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
        paint: { 'icon-color': color } })
    icon('z-quake-icon', 'quakes', 'i-pulse', ['interpolate', ['exponential', 1.6], ['get', 'mag'], 4, 0.22, 5, 0.3, 8, 0.95], '#fff', { filter: ['>=', ['get', 'mag'], 4] })
    icon('z-gdacs-icon', 'gdacs', GDACS_ICON, ['*', 0.17, sev], '#fff')
    icon('z-eonet-icon', 'eonet', EONET_ICON, 0.2, dark ? '#d8dedb' : '#2c3330')
    icon('t-mtr-st-icon', 'mtr-st', 'i-subway', ['interpolate', ['linear'], ['zoom'], 11, 0.16, 15, 0.3], ['get', 'color'], { minzoom: 11 })
    this.apply(this.state, true)
  }

  // Show the requested views (and the neutral base city), loading their data on first use.
  apply(s: EngineState, force = false) {
    const prev = this.state
    this.state = s
    if (!this.installed) return
    const m = this.map
    const want = new Set<string>(s.views.flatMap(v => LAYERS[v]))
    if (s.base) for (const id of LAYERS.base)
      if (!(s.views.includes('height') && id !== 'b-mtr') && !(s.views.includes('transit') && id === 'b-mtr')) want.add(id)
    for (const id of Object.values(LAYERS).flat()) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', want.has(id) ? 'visible' : 'none')
    if (want.has('b-mtr') || s.views.includes('transit')) this.loadMtr()
    if (s.views.includes('hazards')) this.loadHazards(s.time === 't3' ? 'month' : 'day')
    if (s.views.includes('people') || force || prev.sub.people !== s.sub.people) this.loadPeople((s.sub.people || 'density') as D.Indicator)
    if (s.views.includes('business') && (force || prev.sub.business !== s.sub.business || !prev.views.includes('business'))) this.loadBusiness(s.sub.business || 'BE')
    if (import.meta.env.PUBLIC_EDITION === 'full' && s.views.includes('rules') && (force || !prev.views.includes('rules'))) this.loadRules()
    if (s.views.includes('transit')) this.loadBus()
    this.filters()
    this.onUpdate?.()
  }

  private filters() {
    const m = this.map, s = this.state, hs = s.sub.height || 'all', zs = s.sub.hazards || 'all', ts = s.sub.transit || 'all'
    const min = hs === 'super' ? 300 : hs === 'tall' ? 150 : 0
    for (const id of LAYERS.height) if (m.getLayer(id)) m.setFilter(id, min ? ['>=', id === 'h-ov' ? ['coalesce', ['get', 'height'], 0] : H, min] : null)
    const cut = this.cutoff()
    m.setFilter('z-quake', zs === 'all' || zs === 'quakes' ? (cut ? ['<=', ['get', 'time'], cut] : null) : ['==', 1, 0])
    m.setFilter('z-quake-label', ['all', ['>=', ['get', 'mag'], 5], ...(zs === 'all' || zs === 'quakes' ? [] : [['==', 1, 0]]), ...(cut ? [['<=', ['get', 'time'], cut]] : [])] as any)
    for (const id of ['z-gdacs', 'z-eonet']) m.setFilter(id, zs === 'all' ? null : zs === 'quakes' ? ['==', 1, 0] : ['==', ['get', 'cat'], zs])
    m.setLayoutProperty('t-bus', 'visibility', s.views.includes('transit') && ts !== 'rail' ? 'visible' : 'none')
    for (const id of ['t-mtr', 't-mtr-st']) m.setLayoutProperty(id, 'visibility', s.views.includes('transit') && ts !== 'bus' ? 'visible' : 'none')
  }

  // T2 = a moment in the last 24 h (USGS day feed), T3 = a day in the last 30 (month feed). Both are real feed history.
  cutoff() {
    const s = this.state
    if (s.time === 't2' && s.hour < 24) return Date.now() - (24 - s.hour) * 3600e3
    if (s.time === 't3' && s.day < 30) return Date.now() - (30 - s.day) * 86400e3
    return 0
  }

  private loadMtr() {
    this.track(D.mtr().then(f => {
      if (!f.data || !this.installed) return
      const lines = f.data.lines.map((l: any) => ({ type: 'Feature', properties: { line: l.line, color: l.color, name: f.data.names?.[l.stations[0][0]]?.[0] },
        geometry: { type: 'LineString', coordinates: l.track.map((p: number[]) => [p[0], p[1]]) } }))
      const st = new Map<string, any>()
      for (const l of f.data.lines) for (const s of l.stations) if (!st.has(s[0]))
        st.set(s[0], { type: 'Feature', properties: { code: s[0], en: s[1], zh: s[2], line: l.line, color: l.color }, geometry: { type: 'Point', coordinates: [s[4], s[5]] } })
      ;(this.map.getSource('mtr') as any)?.setData({ type: 'FeatureCollection', features: lines })
      ;(this.map.getSource('mtr-st') as any)?.setData({ type: 'FeatureCollection', features: [...st.values()] })
    }))
  }

  // Each feed draws as soon as it arrives: GDACS is slow and must not hold back the earthquakes.
  private loadHazards(span: 'day' | 'month') {
    const set = (id: string, fc: any) => { if (this.installed) { (this.map.getSource(id) as any)?.setData(fc); this.filters(); this.onUpdate?.() } }
    this.track(D.quakes(span).then(q => q.data && set('quakes', q.data)))
    this.track(D.gdacs().then(g => g.data && set('gdacs', { ...g.data, features: g.data.features.map((f: any) =>
      ({ ...f, properties: { name: f.properties.name, alertlevel: f.properties.alertlevel, eventtype: f.properties.eventtype, country: f.properties.country,
        from: f.properties.fromdate, report: f.properties.url?.report, sev: f.properties.severitydata?.severitytext, cat: GDACS_CAT[f.properties.eventtype] } })) })))
    this.track(D.eonet().then(e => e.data && set('eonet', { ...e.data, features: e.data.features.map((f: any) =>
      ({ ...f, properties: { title: f.properties.title, cat: EONET_CAT[f.properties.categories?.[0]?.id] || 'other', catTitle: f.properties.categories?.[0]?.title, catId: f.properties.categories?.[0]?.id, date: f.properties.date, link: f.properties.sources?.[0]?.url } })) })))
  }

  private loadPeople(ind: D.Indicator) {
    this.track(Promise.all([D.countries(), D.worldBank(ind)]).then(([c, w]) => {
      if (!c.data || !this.installed) return
      const vals = Object.values(w.data?.by || {}).map(x => x.v).sort((a, b) => a - b)
      // Quantile position, so one city-state at 7,000 people/km² does not flatten every other country into one colour.
      const q = (v: number) => { let lo = 0, hi = vals.length; while (lo < hi) { const mid = (lo + hi) >> 1; vals[mid] < v ? lo = mid + 1 : hi = mid } return vals.length > 1 ? lo / (vals.length - 1) : 0 }
      // colour by country code on the tiles: code -> quantile, -1 = no figure
      this.peopleBy = w.data?.by || {}
      const pairs = Object.entries(this.peopleBy).flatMap(([k, r]) => [k, q(r.v)])
      const qx: any = pairs.length ? ['match', D.ISO, ...pairs, -1] : -1
      this.map.setPaintProperty('p-fill', 'fill-color', ['case', ['>=', qx, 0], ramp(qx, [0, 0.25, 0.5, 0.75, 1], this.peopleRamp), this.noData])
    }))
  }

  // B-READY topic score, 0 to 100, on a fixed scale (scores are comparable across economies); uncovered places stay neutral.
  private loadBusiness(topic: string) {
    this.track(D.bready(`IC.BRE.${topic}.OS`).then(f => {
      if (!this.installed) return
      this.bizBy = f.data?.by || {}
      const pairs = Object.entries(this.bizBy).flatMap(([k, r]) => [k, r.v])
      const v: any = pairs.length ? ['match', D.ISO, ...pairs, -1] : -1
      this.map.setPaintProperty('bz-fill', 'fill-color', ['case', ['>=', v, 0], ramp(v, [0, 25, 50, 75, 100], RAMPS.viridis[this.theme]), this.noData])
    }))
  }

  // Building-rules status, categorical (four ordered classes on the viridis ramp); places not covered stay neutral.
  private loadRules() {
    if (!(import.meta.env.PUBLIC_EDITION === 'full')) return
    this.track(D.buildingGreen().then(f => {
      if (!this.installed || !f.data) return
      const V = RAMPS.viridis[this.theme], col = [V[3], V[2], V[1], V[0]]
      const pairs = Object.entries(f.data.countries).flatMap(([k, c]) => [k, col[D.bgStatus(c)]])
      this.map.setPaintProperty('r-fill', 'fill-color', pairs.length ? ['match', D.ISO, ...pairs, this.noData] : this.noData)
    }))
  }

  private loadBus() {
    const m = this.map
    if (!this.installed || !this.state.views.includes('transit') || m.getZoom() < 11 || !inHK(m.getCenter().toArray())) return
    this.track(D.busIndex().then(async idx => {
      if (!idx.data) return
      const b = m.getBounds()
      const names = D.busTilesFor(idx.data, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]).filter(t => !this.busLoaded.has(t)).slice(0, 36)
      const tiles = await Promise.all(names.map(D.busTile))
      tiles.forEach((t, i) => { if (t.data) { this.busLoaded.add(names[i]); this.busLines.push(...t.data.lines); this.busStops.push(...t.data.stops) } })
      if (names.length) (m.getSource('bus') as any)?.setData({ type: 'FeatureCollection', features: this.busLines })
      this.onUpdate?.()
    }))
  }

  // Resolves once every fetch has settled and the map has drawn the result.
  async ready() {
    for (let i = 0; i < 50 && (this.pending.size || !this.installed); i++) await Promise.allSettled([...this.pending, new Promise(r => setTimeout(r, 100))])
    if (!this.map.loaded() || !this.map.areTilesLoaded()) await new Promise(r => { this.map.once('idle', r); setTimeout(r, 15000) })
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  }

  private pick(pt: maplibregl.PointLike) {
    const layers = this.state.views.flatMap(v => LAYERS[v]).filter(id => this.map.getLayoutProperty(id, 'visibility') === 'visible')
    const f = layers.length ? this.map.queryRenderedFeatures(pt, { layers })[0] : undefined
    if (!f) return this.onPick?.(null)
    let p: any = f.properties; const id = f.layer.id
    const fmt = (t: any) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    if (id.startsWith('h-')) {
      const src = id === 'h-ov' ? `Overture Maps ${this.overture?.release || ''}` : id.endsWith('hk') ? 'Lands Department via CSDI (hk-buildings)' : id.endsWith('nl') ? '3DBAG' : 'Overture Maps via world-skylines'
      return this.onPick?.({ view: 'height', title: p.name || p['names.primary'] || 'Building', source: src, href: id === 'h-ov' ? 'https://docs.overturemaps.org' : 'https://huggingface.co/datasets/alreadyopen/world-skylines',
        rows: [['Height', p.height != null ? `${Math.round(p.height)} m` : 'Not in the data'], ...(p.num_floors ? [['Floors', String(p.num_floors)]] as [string, string][] : []), ...(p.min_height ? [['Starts at', `${Math.round(p.min_height)} m`]] as [string, string][] : [])] })
    }
    if (id === 'z-quake' || id === 'z-quake-label') return this.onPick?.({ view: 'hazards', title: p.title, source: 'USGS', href: p.url,
      rows: [['Magnitude', String(p.mag)], ['When', fmt(p.time)], ['Felt reports', String(p.felt ?? 0)], ['Tsunami flag', p.tsunami ? 'Yes' : 'No']] })
    if (id === 'z-gdacs') return this.onPick?.({ view: 'hazards', title: p.name, source: 'GDACS', href: p.report,
      rows: [['Alert level', p.alertlevel], ['Where', p.country || 'At sea'], ['Since', fmt(p.from)], ...(p.sev ? [['Severity', p.sev]] as [string, string][] : [])] })
    if (id === 'z-eonet') return this.onPick?.({ view: 'hazards', title: p.title, source: 'NASA EONET', href: p.link, rows: [['Kind', p.catTitle], ['Reported', fmt(p.date)]] })
    if (id === 't-mtr' || id === 't-mtr-st') return this.onPick?.({ view: 'transit', title: p.en ? `${p.en} station ${p.zh || ''}` : `MTR ${p.line}`, source: 'hk-transit (MTR Corporation, Lands Department)',
      href: 'https://huggingface.co/datasets/alreadyopen/hk-transit', rows: [['Line', p.line], ...(p.code ? [['Station code', p.code]] as [string, string][] : [])] })
    if (id === 't-bus') return this.onPick?.({ view: 'transit', title: `Route ${p.route}`, source: 'hk-transit (TD, KMB, Citybus)', href: 'https://huggingface.co/datasets/alreadyopen/hk-transit',
      rows: [['Operator', p.op], ['Direction', p.dir === 'O' ? 'Outbound' : p.dir === 'I' ? 'Inbound' : String(p.dir)]] })
    if (id === 'p-fill') { const iso = D.isoOf(p), r = this.peopleBy[iso]; p = { name: p.NAME, iso3: iso, v: r?.v, year: r?.year } }
    if (id === 'p-fill') return this.onPick?.({ view: 'people', title: p.name, source: 'World Bank or official statistics (world-places), Natural Earth', href: `https://data.worldbank.org/country/${p.iso3}`,
      rows: [['Value', p.v != null ? `${Math.round(p.v * 10) / 10}` : 'No data'], ['Year', p.year || 'None']] })
    if (id === 'bz-fill') { const iso = D.isoOf(p), r = this.bizBy[iso], t = this.state.sub.business || 'BE'
      return this.onPick?.({ view: 'business', title: p.NAME, source: 'World Bank, B-READY (CC BY 4.0)', href: 'https://www.worldbank.org/en/businessready',
        rows: [[`${VIEWS.business.subs.find(x => x.id === t)?.label}, score`, r ? `${Math.round(r.v * 10) / 10} of 100` : 'Not covered by B-READY yet'], ['Year', r?.year || 'None']] }) }
    if (import.meta.env.PUBLIC_EDITION === 'full' && id === 'r-fill') { const c = (D.peek('building-green') as any)?.data?.countries?.[D.isoOf(p)]
      return this.onPick?.({ view: 'rules', title: p.NAME, source: 'World Bank, Building Green (noncommercial use with attribution)', href: 'https://www.worldbank.org/en/building-green',
        rows: c ? [['Status', D.BG_STATUS[D.bgStatus(c)]], ['Code', c['BEC-INFO-02'] === '..' ? 'Not reported' : c['BEC-INFO-02']], ['Measured in', c['DEM-INFO-03']]] : [['Status', 'Not covered by Building Green']] }) }
  }
}

export { VIEW_IDS, HK }
