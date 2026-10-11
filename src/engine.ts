// One MapLibre world. The page may hold two (V4 compare); data is fetched once and shared (data.ts caches it).
import * as maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import * as D from './data'
import * as Sat from './sats'
import { MAP_ICONS, iconImage } from './icons'
import { LOCAL, cellsFor, layerOwner, meets, type Bbox, type Local } from './local'
import { HEIGHT_STOPS, MAG_STOPS, RAMPS, VIEWS, VIEW_IDS, type ViewId, HK, inHK } from './views'
import { FIRE, FIRE_LINKS, FIRE_MINZOOM, SA_BOX, drawable, fireLayers, fireRows, type FireMode } from './fire'

let protocol = false
export type Theme = 'light' | 'dark'
export type EngineState = { views: ViewId[]; base: boolean; sub: Partial<Record<ViewId, string>>; time: 't1' | 't2' | 't3'; hour: number; day: number; fire: FireMode }
export type Pick = { view: ViewId; title: string; rows: [string, string][]; href?: string; source: string; links?: [string, string][] }

const STYLE = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' }
// Attribution per world-buildings region source.
const BLD_ATTR: Record<string, string> = { hk: 'Lands Department via CSDI (AlreadyOpen hk-buildings)', '3dbag': '© 3DBAG by tudelft3d and 3DGI (CC BY 4.0)' }
const BLD_OVERTURE = 'Overture Maps (ODbL), © OpenStreetMap contributors via AlreadyOpen world-buildings'
const H: any = ['coalesce', ['get', 'height'], 0]
const ramp = (input: any, stops: number[], colors: string[]) => ['interpolate', ['linear'], input, ...stops.flatMap((s, i) => [s, colors[i]])]
const NEUTRAL = { light: { bld: '#d9dcd8', bldTop: '#c9ccc8', line: '#8d938f', nodata: '#e4e6e3' }, dark: { bld: '#3a3f3d', bldTop: '#454b48', line: '#7d8481', nodata: '#2f3432' } }
export const LAYERS: Record<ViewId | 'base', string[]> = {
  base: ['b-mtr'],        // building layers (b-bld-<region>, h-bld-<region>) are appended as their regions load
  height: [],
  hazards: ['z-eonet', 'z-gdacs', 'z-quake', 'z-eonet-icon', 'z-gdacs-icon', 'z-quake-icon', 'z-quake-label'],
  transit: ['t-bus', 't-mtr', 't-mtr-st', 't-mtr-st-icon'],
  traffic: [],            // country layers (local.ts) add their own ids to their view's list
  people: ['p-fill', 'p-line'],
  business: ['bz-fill', 'bz-line'],
  rules: ['r-fill', 'r-line'],
  satellites: ['s-past', 's-next', 's-dot', 's-icon'],
  airports: ['a-rwy', 'a-dot', 'a-icon', 'a-world', 'a-world-icon'],
}
// Airport kinds, largest first: a categorical colour each (Okabe-Ito, colour-blind safe; the closest pair under simulated
// deuteranopia, protanopia and tritanopia is still CIE76 dE 16, small vs balloon port), plus an icon and a size. Closed: muted grey.
export const AIRPORT_TYPES: [string, string][] = [['large_airport', 'Large airport'], ['medium_airport', 'Medium airport'], ['small_airport', 'Small airport'],
  ['heliport', 'Heliport'], ['seaplane_base', 'Seaplane base'], ['balloonport', 'Balloon port'], ['closed', 'Closed']]
export const airportColors = (dark: boolean) => ['#0072B2', '#009E73', '#E69F00', '#CC79A7', '#56B4E9', '#F0E442', dark ? '#4a504d' : '#d2d6d3']
// Satellite colour by altitude (km): low orbit, Starlink shells, navigation orbits, geostationary.
export const ALT_STOPS = [400, 600, 1200, 20000, 36000]
const EONET_CAT: Record<string, string> = { severeStorms: 'storms', floods: 'floods', drought: 'floods', wildfires: 'fire', volcanoes: 'fire' }
// Which icon each hazard kind gets (GDACS event type, NASA EONET category id).
const GDACS_ICON: any = ['match', ['get', 'eventtype'], 'EQ', 'i-pulse', 'TC', 'i-hurricane', 'FL', 'i-drop', 'DR', 'i-sun-dim', 'WF', 'i-fire', 'VO', 'i-mountains', 'i-warning']
const EONET_ICON: any = ['match', ['get', 'catId'], 'severeStorms', 'i-hurricane', 'floods', 'i-drop', 'drought', 'i-sun-dim', 'wildfires', 'i-fire',
  'volcanoes', 'i-mountains', 'earthquakes', 'i-pulse', 'seaLakeIce', 'i-snowflake', 'snow', 'i-snowflake', 'i-warning']
const GDACS_CAT: Record<string, string> = { TC: 'storms', FL: 'floods', DR: 'floods', WF: 'fire', VO: 'fire' }

export class World {
  map: maplibregl.Map
  theme: Theme
  state: EngineState = { views: [], base: true, sub: {}, time: 't1', hour: 24, day: 30, fire: 'off' }
  pending = new Set<Promise<any>>()
  onPick?: (p: Pick | null) => void
  onUpdate?: () => void
  busLoaded = new Set<string>()
  busLines: any[] = []
  busStops: any[] = []
  private regions = new Map<string, D.Region>()   // world-buildings regions whose source this map has added
  private installed = false
  private peopleBy: Record<string, { v: number; year: string; src?: string }> = {}
  private peopleRamp: any = null
  private bizBy: Record<string, { v: number; year: string }> = {}
  private riseBy: Record<string, { v: number; year: string }> = {}
  private noData: any = null
  private gen = 0
  sats: Sat.Sat[] = []
  satGroup = ''
  satMs = 0                    // last propagation + setData time, for the performance note
  private satTimer: any = 0
  private trackAt = 0
  localFeats: Record<string, any[]> = {}         // what each country layer is drawing now (answers count it)
  localErr: Record<string, string> = {}
  private localCells: Record<string, Map<string, any[]>> = {}
  private warned = new Set<string>()
  private bldLayer = 'buildings'
  private fireMode = ''                          // the fire presentation whose sources are on the map ('' = none yet)
  fireErr: Record<string, string> = {}

  constructor(el: HTMLElement, theme: Theme, camera: { center: [number, number]; zoom: number; pitch?: number; bearing?: number }) {
    if (!protocol) { maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs'); maplibregl.addProtocol('pmtiles', new Protocol().tile); protocol = true }
    this.theme = theme
    this.map = new maplibregl.Map({ container: el, style: STYLE[theme], ...camera, maxPitch: 80, attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true } } as any)
    this.map.on('style.load', () => { this.installed = false; this.install(++this.gen).catch(e => console.error('worldviews install failed', e)) })
    this.map.on('moveend', () => { this.loadBus(); this.loadBuildings(); this.loadLocal(); this.loadFire(); this.onUpdate?.() })
    // A listener stops MapLibre's own console.error, so pass on every error that is not a fire source's (those show in the answer)
    this.map.on('error', (e: any) => { const id = e.sourceId || e.source?.id
      if (typeof id === 'string' && id.startsWith('fs-')) { this.fireErr[id.slice(3)] = String(e.error?.message || e.error || 'failed').replace(/https?:\/\/\S+/g, '').replace(/[:\s]+$/, '').trim(); this.onUpdate?.() } else console.error(e.error || e) })
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
    if (this.installed || gen !== this.gen) return   // a newer style (theme switch) took over while we waited
    this.installed = true
    const hid = { visibility: 'none' } as any, V = RAMPS.viridis[this.theme]
    this.regions.clear()
    this.fireMode = ''; LAYERS.hazards = LAYERS.hazards.filter(id => !id.startsWith('f-'))   // a new style has none of them
    const empty: any = { type: 'FeatureCollection', features: [] }
    // Natural Earth 1:10m outlines as tiles (AlreadyOpen world-places): 1:50m sat km off at city zoom (Macau)
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
    for (const s of ['quakes', 'gdacs', 'eonet', 'mtr', 'mtr-st', 'bus', 'sats', 'iss-past', 'iss-next'])
      m.addSource(s, { type: 'geojson', data: empty,
        attribution: { quakes: 'USGS', gdacs: 'GDACS', eonet: 'NASA EONET', mtr: 'hk-transit (Government of the HKSAR data)', sats: 'CelesTrak; satellite.js' }[s] } as any)
    const P = RAMPS.cividis[this.theme], I = RAMPS.inferno[this.theme]
    this.peopleRamp = P; this.noData = n.nodata
    m.addLayer({ id: 'p-fill', type: 'fill', source: 'people', 'source-layer': 'countries', layout: hid,
      paint: { 'fill-color': n.nodata, 'fill-opacity': 0.78 } })
    m.addLayer({ id: 'p-line', type: 'line', source: 'people', 'source-layer': 'countries', layout: hid, paint: { 'line-color': dark ? '#1d2120' : '#fbfcfa', 'line-width': 0.6 } })
    m.addLayer({ id: 'bz-fill', type: 'fill', source: 'people', 'source-layer': 'countries', layout: hid,
      paint: { 'fill-color': n.nodata, 'fill-opacity': 0.78 } })
    m.addLayer({ id: 'bz-line', type: 'line', source: 'people', 'source-layer': 'countries', layout: hid, paint: { 'line-color': dark ? '#1d2120' : '#fbfcfa', 'line-width': 0.6 } })
    for (const [id, type, paint] of [['r-fill', 'fill', { 'fill-color': n.nodata, 'fill-opacity': 0.78 }],
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
    m.addSource('apt', { type: 'vector', url: `pmtiles://${D.AIRPORTS}/airports.pmtiles`, attribution: 'OurAirports (public domain)' })
    m.addSource('rwy', { type: 'vector', url: `pmtiles://${D.AIRPORTS}/runways.pmtiles` })
    const T: any = ['get', 'type'], AC = airportColors(dark)
    m.addSource('apt-large', { type: 'geojson', data: empty })
    m.addLayer({ id: 'a-rwy', type: 'line', source: 'rwy', 'source-layer': 'runways', layout: { ...hid, 'line-cap': 'butt' },
      paint: { 'line-color': dark ? '#c9d1cd' : '#3a403d', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 8, 2, 13, 10], 'line-opacity': ['case', ['to-boolean', ['coalesce', ['get', 'closed'], false]], 0.35, 0.85] } })
    m.addLayer({ id: 'a-dot', type: 'circle', source: 'apt', 'source-layer': 'airports', layout: { ...hid, 'circle-sort-key': ['match', T, 'large_airport', 3, 'medium_airport', 2, 'closed', 0, 1] },
      paint: { 'circle-color': ['match', T, ...AIRPORT_TYPES.flatMap(([k], i) => [k, AC[i]]), AC[2]],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, ['match', T, 'large_airport', 6, 'medium_airport', 5, 4], 10, ['match', T, 'large_airport', 9, 'medium_airport', 8, 'closed', 5, 7]],
        'circle-opacity': ['case', ['==', T, 'closed'], 0.55, 0.92], 'circle-stroke-color': dark ? '#151918' : '#fbfcfa', 'circle-stroke-width': 1 } })
    // The tiles start at z2: below that, the large airports (already loaded for "nearest") come from a GeoJSON copy
    m.addLayer({ id: 'a-world', type: 'circle', source: 'apt-large', maxzoom: 2, layout: hid,
      paint: { 'circle-color': AC[0], 'circle-radius': 4, 'circle-opacity': 0.92, 'circle-stroke-color': dark ? '#151918' : '#fbfcfa', 'circle-stroke-width': 1 } })
    const iss = dark ? '#e6ebe8' : '#1d2120'
    m.addLayer({ id: 's-past', type: 'line', source: 'iss-past', layout: hid, paint: { 'line-color': iss, 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } })
    m.addLayer({ id: 's-next', type: 'line', source: 'iss-next', layout: hid, paint: { 'line-color': iss, 'line-width': 2, 'line-opacity': 0.85 } })
    m.addLayer({ id: 's-dot', type: 'circle', source: 'sats', layout: { ...hid, 'circle-sort-key': ['case', ['get', 'iss'], 1, 0] }, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['get', 'iss'], 9, 5], 6, ['case', ['get', 'iss'], 13, 8]],
      'circle-color': ramp(['get', 'alt'], ALT_STOPS, RAMPS.viridis[this.theme]), 'circle-stroke-color': dark ? '#151918' : '#fbfcfa', 'circle-stroke-width': 1 } })
    // Iconify icons on the points (SDF, so one image takes any colour); circles keep the data colour underneath
    await Promise.all(Object.entries(MAP_ICONS).map(async ([id, d]) => { if (!m.hasImage(id)) m.addImage(id, await iconImage(d), { sdf: true, pixelRatio: 2 }) }))
    if (gen !== this.gen) return
    const icon = (id: string, source: string, image: any, size: any, color: any, extra: any = {}) =>
      m.addLayer({ id, type: 'symbol', source, ...extra, layout: { ...hid, 'icon-image': image, 'icon-size': size, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
        paint: { 'icon-color': color } })
    icon('z-quake-icon', 'quakes', 'i-pulse', ['interpolate', ['exponential', 1.6], ['get', 'mag'], 4, 0.22, 5, 0.3, 8, 0.95], '#fff', { filter: ['>=', ['get', 'mag'], 4] })
    icon('z-gdacs-icon', 'gdacs', GDACS_ICON, ['*', 0.17, sev], '#fff')
    icon('z-eonet-icon', 'eonet', EONET_ICON, 0.2, dark ? '#d8dedb' : '#2c3330')
    icon('s-icon', 'sats', 'i-satellite', ['interpolate', ['linear'], ['zoom'], 1, ['case', ['get', 'iss'], 0.3, 0.17], 6, ['case', ['get', 'iss'], 0.44, 0.27]], '#fff')
    icon('a-icon', 'apt', ['match', T, 'heliport', 'i-heli', 'seaplane_base', 'i-anchor', 'balloonport', 'i-balloon', 'i-plane'],
      ['interpolate', ['linear'], ['zoom'], 2, ['match', T, 'large_airport', 0.19, 'medium_airport', 0.15, 0.12], 10, ['match', T, 'large_airport', 0.28, 'medium_airport', 0.24, 'closed', 0.15, 0.2]],
      ['case', ['==', T, 'closed'], dark ? '#151918' : '#fbfcfa', '#fff'], { 'source-layer': 'airports' })
    icon('a-world-icon', 'apt-large', 'i-plane', 0.12, '#fff', { maxzoom: 2 })
    icon('t-mtr-st-icon', 'mtr-st', 'i-subway', ['interpolate', ['linear'], ['zoom'], 11, 0.16, 15, 0.3], ['get', 'color'], { minzoom: 11 })
    // Country layers: one GeoJSON source each; areas and lines under the global points, extrusions with the buildings.
    this.localCells = {}; this.localFeats = {}
    for (const L of LOCAL) {
      m.addSource(L.id, { type: 'geojson', data: empty, attribution: L.name } as any)
      for (const spec of L.layers(dark)) {
        const before = spec.type === 'fill-extrusion' ? 'countries-hit' : spec.type === 'fill' || spec.type === 'line' ? 'z-eonet' : undefined
        m.addLayer({ ...spec, source: L.id, layout: { ...(spec.layout || {}), visibility: 'none' } }, before)
        if (!LAYERS[L.view].includes(spec.id)) LAYERS[L.view].push(spec.id)
      }
    }
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
    if (s.views.includes('rules') && (force || prev.sub.rules !== s.sub.rules || !prev.views.includes('rules'))) this.loadRules(s.sub.rules || 'BEC')
    if (s.views.includes('satellites')) { if (force || prev.sub.satellites !== s.sub.satellites || !prev.views.includes('satellites')) this.loadSats(s.sub.satellites || 'stations') }
    else if (this.satTimer) { clearInterval(this.satTimer); this.satTimer = 0 }
    if (s.views.includes('airports')) this.track(D.largeAirports().then(f => { if (f.data && this.installed) (this.map.getSource('apt-large') as any)?.setData({ type: 'FeatureCollection',
      features: f.data.map(a => ({ type: 'Feature', properties: a.props, geometry: { type: 'Point', coordinates: [a.lon, a.lat] } })) }) }))
    if (s.views.includes('transit')) this.loadBus()
    this.loadBuildings()
    this.loadLocal()
    this.loadFire()
    this.filters()
    this.onUpdate?.()
  }

  private filters() {
    const m = this.map, s = this.state, hs = s.sub.height || 'all', zs = s.sub.hazards || 'all', ts = s.sub.transit || 'all'
    const min = hs === 'super' ? 300 : hs === 'tall' ? 150 : 0
    for (const id of LAYERS.height) if (m.getLayer(id)) m.setFilter(id, min ? ['>=', H, min] : null)
    const cut = this.cutoff()
    m.setFilter('z-quake', zs === 'all' || zs === 'quakes' ? (cut ? ['<=', ['get', 'time'], cut] : null) : ['==', 1, 0])
    m.setFilter('z-quake-label', ['all', ['>=', ['get', 'mag'], 5], ...(zs === 'all' || zs === 'quakes' ? [] : [['==', 1, 0]]), ...(cut ? [['<=', ['get', 'time'], cut]] : [])] as any)
    for (const id of ['z-gdacs', 'z-eonet']) m.setFilter(id, zs === 'all' ? null : zs === 'quakes' ? ['==', 1, 0] : ['==', ['get', 'cat'], zs])
    m.setLayoutProperty('t-bus', 'visibility', s.views.includes('transit') && ts !== 'rail' ? 'visible' : 'none')
    for (const id of ['t-mtr', 't-mtr-st']) m.setLayoutProperty(id, 'visibility', s.views.includes('transit') && ts !== 'bus' ? 'visible' : 'none')
    // country layers that belong to one sub-map (hazards: quakes, fire, storms, roads; traffic: volume, crashes)
    for (const L of LOCAL) if (L.cat) {
      const sub = s.sub[L.view] || 'all', on = s.views.includes(L.view) && (sub === 'all' || sub === L.cat)
      for (const id of LAYERS[L.view]) if (layerOwner(id) === L && m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    for (const id of LAYERS.hazards) if (id.startsWith('f-') && m.getLayer(id)) m.setLayoutProperty(id, 'visibility', this.fireWanted() !== 'off' ? 'visible' : 'none')
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

  // RISE score on a fixed 0 to 100 viridis scale; in the full edition, sub 'bg' = Building Green status, categorical (four
  // ordered classes on the same ramp). Places not covered stay neutral.
  private loadRules(sub: string) {
    if (!(import.meta.env.PUBLIC_EDITION === 'full' && sub === 'bg')) {
      this.track(D.rise(sub === 'bg' ? 'BEC' : sub).then(f => {
        if (!this.installed || (this.state.sub.rules || 'BEC') !== sub) return
        this.riseBy = f.data?.by || {}
        const pairs = Object.entries(this.riseBy).flatMap(([k, r]) => [k, r.v])
        const v: any = pairs.length ? ['match', D.ISO, ...pairs, -1] : -1
        this.map.setPaintProperty('r-fill', 'fill-color', ['case', ['>=', v, 0], ramp(v, [0, 25, 50, 75, 100], RAMPS.viridis[this.theme]), this.noData])
      }))
      return
    }
    this.track(D.buildingGreen().then(f => {
      if (!this.installed || !f.data) return
      const V = RAMPS.viridis[this.theme], col = [V[3], V[2], V[1], V[0]]
      const pairs = Object.entries(f.data.countries).flatMap(([k, c]) => [k, col[D.bgStatus(c)]])
      this.map.setPaintProperty('r-fill', 'fill-color', pairs.length ? ['match', D.ISO, ...pairs, this.noData] : this.noData)
    }))
  }

  // Satellites: fetch the group (cached 2 h), then move every point once a second; the ISS track is redrawn once a minute.
  private loadSats(group: string) {
    this.track(Sat.gp(group).then(f => {
      if (!this.installed || (this.state.sub.satellites || 'stations') !== group) return
      this.sats = f.data?.sats || []; this.satGroup = group; this.trackAt = 0
      this.onPick?.(null)
      // Thousands of points (Starlink): plain small dots, no icons, so the globe stays readable; icons for small groups.
      const many = this.sats.length > 500
      this.map.setFilter('s-icon', many ? ['has', '__none__'] : null)   // a filter that matches nothing
      this.map.setPaintProperty('s-dot', 'circle-radius', many ? ['interpolate', ['linear'], ['zoom'], 1, 1.4, 6, 3.5]
        : ['interpolate', ['linear'], ['zoom'], 1, ['case', ['get', 'iss'], 9, 5], 6, ['case', ['get', 'iss'], 13, 8]])
      this.map.setPaintProperty('s-dot', 'circle-stroke-width', many ? 0 : 1)
      clearInterval(this.satTimer)
      this.tickSats()
      this.satTimer = setInterval(() => this.tickSats(), 1000)
    }))
  }

  private tickSats() {
    const m = this.map
    if (!this.installed || !this.state.views.includes('satellites')) return
    const t0 = performance.now(), t = new Date(), g = Sat.gstime(t), features: any[] = []
    this.sats.forEach((s, i) => {
      const p = Sat.where(s.rec, t, g)
      if (p && Number.isFinite(p.lon)) features.push({ type: 'Feature', properties: { i, alt: Math.round(p.alt), iss: s.id === 25544 }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })
    })
    ;(m.getSource('sats') as any)?.setData({ type: 'FeatureCollection', features })
    const iss = this.sats.find(s => s.id === 25544)
    if (Date.now() - this.trackAt > 60e3) {
      this.trackAt = Date.now()
      const tr = iss ? Sat.track(iss.rec) : { past: [], next: [] }
      ;(m.getSource('iss-past') as any)?.setData({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: tr.past } })
      ;(m.getSource('iss-next') as any)?.setData({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: tr.next } })
    }
    this.satMs = performance.now() - t0
  }

  // Buildings: add a region's tiles only when its bbox meets the view (from z5; the tiles start at z6), so a world of regions
  // costs no requests until you look at one. Base layers are neutral, height layers take the height ramp.
  private loadBuildings() {
    const m = this.map
    if (!this.installed || m.getZoom() < 5) return
    this.track(D.buildingRegions().then(f => {
      if (!f.data || !this.installed) return
      this.bldLayer = f.data.layer
      const b = m.getBounds(), [w, s, e, n] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], N = NEUTRAL[this.theme], V = RAMPS.viridis[this.theme]
      const OH: any = ['coalesce', ['get', 'height'], ['*', ['get', 'num_floors'], 3], 3]
      let added = false
      for (const r of f.data.regions) {
        const [x0, y0, x1, y1] = r.bbox
        if (this.regions.has(r.id) || x1 < w || x0 > e || y1 < s || y0 > n) continue
        this.regions.set(r.id, r)
        m.addSource('bld-' + r.id, { type: 'vector', url: 'pmtiles://' + r.tiles, attribution: BLD_ATTR[r.source] || BLD_OVERTURE })
        for (const [pre, color] of [['b', N.bld], ['h', ['case', ['has', 'height'], ramp(['get', 'height'], HEIGHT_STOPS, V), N.nodata]]] as const) {
          const id = `${pre}-bld-${r.id}`, list = pre === 'b' ? LAYERS.base : LAYERS.height
          m.addLayer({ id, type: 'fill-extrusion', source: 'bld-' + r.id, 'source-layer': r.layer || f.data.layer, layout: { visibility: 'none' },
            paint: { 'fill-extrusion-color': color as any, 'fill-extrusion-height': OH, 'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0], 'fill-extrusion-opacity': 0.92 } }, 'countries-hit')
          if (!list.includes(id)) list.unshift(id)
        }
        added = true
      }
      if (!added) return
      const st = this.state, height = st.views.includes('height')
      for (const id of this.regions.keys()) {
        m.setLayoutProperty(`b-bld-${id}`, 'visibility', st.base && !height ? 'visible' : 'none')
        m.setLayoutProperty(`h-bld-${id}`, 'visibility', height ? 'visible' : 'none')
      }
      this.filters(); this.onUpdate?.()
    }))
  }

  // SA fire layers (fire.ts): the presentation the viewer chose, on while hazards shows all events or fire. Sources are added
  // only once the view is near South Australia (plain and styled load whole files), and swapped when the presentation changes.
  fireWanted(): FireMode {
    const s = this.state, sub = s.sub.hazards || 'all'
    return s.views.includes('hazards') && (sub === 'all' || sub === 'fire') ? s.fire : 'off'
  }
  private loadFire() {
    const m = this.map
    if (!this.installed) return
    const want = this.fireWanted(), b = m.getBounds(), draw = !['off', 'link'].includes(want)
    const near = m.getZoom() >= FIRE_MINZOOM && meets([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], SA_BOX)
    const target = want === 'off' ? this.fireMode : draw && !near && this.fireMode !== want ? '' : want   // 'off' hides, keeps the sources
    if (target === this.fireMode) return
    for (const id of LAYERS.hazards.filter(x => x.startsWith('f-'))) if (m.getLayer(id)) m.removeLayer(id)
    LAYERS.hazards = LAYERS.hazards.filter(x => !x.startsWith('f-'))
    for (const L of FIRE) if (m.getSource('fs-' + L.id)) m.removeSource('fs-' + L.id)
    this.fireMode = target; this.fireErr = {}
    const mode = target as FireMode, tiled = mode === 'tiles' || mode === 'thinned'
    for (const L of FIRE) if (target && drawable(L, mode)) {
      const src = 'fs-' + L.id, attribution = `${L.owner} via AlreadyOpen sa-fire (${L.licence})`
      m.addSource(src, tiled ? { type: 'vector', url: `pmtiles://${L.tiles}${mode === 'thinned' ? '-thinned' : ''}.pmtiles`, attribution } : { type: 'geojson', data: L.geojson!, attribution } as any)
      for (const spec of fireLayers(L, mode === 'styled', this.theme === 'dark')) {
        m.addLayer({ ...spec, source: src, ...(tiled ? { 'source-layer': L.id } : {}), layout: { ...(spec.layout || {}), visibility: 'none' } }, spec.type === 'fill' || spec.type === 'line' ? 'z-eonet' : undefined)
        LAYERS.hazards.push(spec.id)
      }
      if (!tiled) this.track(new Promise<void>(res => {   // a whole GeoJSON file: ready() waits until it is parsed (or failed)
        const done = () => { clearTimeout(t); m.off('sourcedata', f); m.off('error', f); res() }, t = setTimeout(done, 300e3)
        const f = (e: any) => { try { if ((e.sourceId || e.source?.id) === src && (e.type === 'error' || m.isSourceLoaded(src))) done() } catch { done() } }
        m.on('sourcedata', f); m.on('error', f)
      }))
    }
    this.filters(); this.onUpdate?.()
  }
  // What the fire presentation has put on the map, for __state and the answer
  fireState() {
    const m = this.map, layers = LAYERS.hazards.filter(id => id.startsWith('f-') && m.getLayer(id) && m.getLayoutProperty(id, 'visibility') === 'visible')
    return { wanted: this.fireWanted(), loaded: this.fireMode, errors: this.fireErr,
      sources: FIRE.filter(L => m.getSource('fs-' + L.id)).map(L => { const sp: any = m.getSource('fs-' + L.id); return sp.url || L.geojson }),
      rendered: Object.fromEntries(layers.map(id => [id, m.queryRenderedFeatures({ layers: [id] }).length])) }
  }

  // Country layers: fetch (once per session, or once per grid cell in view) while their view is on and the view meets their area.
  // A failure is kept: the answer says "source unavailable", and the console gets one warning per source, not an error per move.
  private loadLocal() {
    const m = this.map
    if (!this.installed) return
    const b = m.getBounds(), view: Bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], z = m.getZoom(), gen = this.gen
    for (const L of LOCAL) {
      if (!this.state.views.includes(L.view) || z < L.minzoom || !meets(view, L.area)) continue
      const cells = L.cell ? cellsFor(view, L.area, L.cell) : [null]
      if (!cells?.length) continue                                   // null: too many cells at this zoom
      const got = (this.localCells[L.id] ||= new Map())
      const todo = cells.filter(c => !got.has(String(c)))
      if (!todo.length) { if (L.dedupe) this.setLocal(L); continue }
      this.track(Promise.all(todo.map(c => D.once(c ? `${L.id}:${c}` : L.id, () => L.load(c || undefined)))).then(rs => {
        if (gen !== this.gen || !this.installed) return
        const err = rs.find(r => r.error)?.error
        if (err) {
          this.localErr[L.id] = err
          if (!this.warned.has(L.id)) { this.warned.add(L.id); console.warn(`WorldViews: ${L.name} unavailable (${err})`) }
        } else delete this.localErr[L.id]
        rs.forEach((r, i) => { if (r.data) got.set(String(todo[i]), r.data) })   // ponytail: cells stay for the session; evict if memory matters
        this.setLocal(L)
      }))
    }
  }

  private setLocal(L: Local) {
    const seen = new Set<any>(), all: any[] = []
    for (const fs of this.localCells[L.id]?.values() || []) for (const f of fs) {
      const k = f.id ?? null
      if (k != null) { if (seen.has(k)) continue; seen.add(k) }   // a shape that spans two cells comes back from both
      all.push(f)
    }
    const fs = L.dedupe ? this.withoutOverture(all) : all
    this.localFeats[L.id] = fs
    ;(this.map.getSource(L.id) as any)?.setData({ type: 'FeatureCollection', features: fs })
    this.filters(); this.onUpdate?.()
    this.map.once('idle', () => this.onUpdate?.())   // answers that read drawn features wait for the draw
    // Overture tiles may still be arriving: check again once the map settles, if what it holds has changed
    if (L.dedupe) this.map.once('idle', () => { if (this.overtureCount() !== this.lastOverture) this.setLocal(L) })
  }

  // Heights: keep a local building only where Overture has no height for it (its centre is not inside an Overture building
  // that has one), so the two sources fill each other's gaps instead of drawing the same building twice.
  private lastOverture = -1
  private overturePolys() {
    const out: number[][][] = []
    for (const id of this.regions.keys()) for (const f of this.map.querySourceFeatures('bld-' + id, { sourceLayer: this.bldLayer, filter: ['has', 'height'] })) {
      const g: any = f.geometry
      if (g.type === 'Polygon') out.push(g.coordinates[0]); else if (g.type === 'MultiPolygon') for (const p of g.coordinates) out.push(p[0])
    }
    return out
  }
  private overtureCount() { return this.overturePolys().length }
  private withoutOverture(fs: any[]) {
    const polys = this.overturePolys(), grid = new Map<string, number[][][]>(), K = 1000   // ~100 m buckets
    this.lastOverture = polys.length
    for (const r of polys) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const [x, y] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
      for (let i = Math.floor(x0 * K); i <= Math.floor(x1 * K); i++) for (let j = Math.floor(y0 * K); j <= Math.floor(y1 * K); j++) {
        const k = `${i},${j}`; (grid.get(k) || grid.set(k, []).get(k)!).push(r)
      }
    }
    const inRing = (r: number[][], x: number, y: number) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c } return c }
    return fs.filter(f => {
      const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]
      const x = ring.reduce((a: number, p: number[]) => a + p[0], 0) / ring.length, y = ring.reduce((a: number, p: number[]) => a + p[1], 0) / ring.length
      return !(grid.get(`${Math.floor(x * K)},${Math.floor(y * K)}`) || []).some(r => inRing(r, x, y))
    })
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
    const fs = layers.length ? this.map.queryRenderedFeatures(pt, { layers }) : []
    const f = fs.find(x => x.properties?.iss) || fs[0]   // vehicles docked at the ISS share its point: the ISS wins
    if (!f) {
      const ll = this.map.unproject(pt).toArray()
      if (this.fireWanted() === 'link' && meets([ll[0], ll[1], ll[0], ll[1]], SA_BOX)) return this.onPick?.({ view: 'hazards', title: 'Fire information, South Australia',
        rows: [['Shown as', 'Links only: no fire data is drawn here'], ['Fires now', 'See the CFS for current incidents and warnings']],
        source: 'Department for Environment and Water and SA Country Fire Service, on Data.SA', href: 'https://www.cfs.sa.gov.au/', links: FIRE_LINKS })
      return this.onPick?.(null)
    }
    let p: any = f.properties; const id = f.layer.id
    if (id.startsWith('f-')) { const F = FIRE.find(x => id.startsWith(`f-${x.id}-`))!
      return this.onPick?.({ view: 'hazards', title: F.name, rows: fireRows(p), href: F.docs, source: `${F.owner} via AlreadyOpen sa-fire. ${F.licence}` }) }
    const fmt = (t: any) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    const L = layerOwner(id)
    if (L) { const r = L.pick(p)
      return this.onPick?.({ view: L.view, title: r.title, rows: r.rows, href: r.href || L.href, source: `${L.name}. ${L.licence}`, links: r.href && r.href !== L.href ? [['Source', L.href]] : undefined }) }
    if (id.startsWith('h-bld-')) {
      const r = this.regions.get(id.slice(6)), hk = r?.source === 'hk', bag = r?.source === '3dbag', m1 = (k: string, v: any, f = (x: any) => String(x)) => v != null && v !== '' ? [[k, f(v)]] as [string, string][] : []
      return this.onPick?.({ view: 'height', title: p.name || p['names.primary'] || p.BuildingNameEN || 'Building',
        source: hk ? 'Lands Department via CSDI (AlreadyOpen hk-buildings)' : bag ? '© 3DBAG by tudelft3d and 3DGI (CC BY 4.0)' : 'Overture Maps via AlreadyOpen world-buildings',
        href: bag ? 'https://3dbag.nl' : `https://huggingface.co/datasets/alreadyopen/${hk ? 'hk' : 'world'}-buildings`,
        rows: [['Height', p.height != null ? `${Math.round(p.height)} m` : 'Not in the data'], ...m1('Floors', p.num_floors ?? p.Storeys ?? p.b3_bouwlagen), ...m1('Starts at', p.min_height, x => `${Math.round(x)} m`),
          ...m1('Data source', p.source), ...m1('Check', p.check)] })
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
    if (id === 's-dot' || id === 's-icon') { const s = this.sats[p.i], q = s && Sat.where(s.rec, new Date())
      if (s) return this.onPick?.({ view: 'satellites', title: s.name, source: 'CelesTrak GP data; position computed with satellite.js', href: `https://celestrak.org/satcat/table-satcat.php?CATNR=${s.id}`,
        rows: [['NORAD id', String(s.id)], ['Altitude', q ? `${Math.round(q.alt).toLocaleString('en')} km` : 'Not computed'], ['Speed', q ? `${q.speed.toFixed(2)} km/s` : 'Not computed'],
          ['Element epoch', `${s.epoch.replace('T', ' ').slice(0, 16)} UTC`]] }) }
    if (id === 'a-dot' || id === 'a-icon' || id === 'a-world' || id === 'a-world-icon') {
      const elev = p.elevation_ft != null ? `${Number(p.elevation_ft).toLocaleString('en')} ft (${Math.round(p.elevation_ft * 0.3048).toLocaleString('en')} m)` : 'Not published'
      return this.onPick?.({ view: 'airports', title: p.name, source: 'OurAirports (public domain)', href: `https://ourairports.com/airports/${p.ident}/`,
        rows: [['ICAO', p.icao_code || p.gps_code || 'None'], ['IATA', p.iata_code || 'None'], ['Type', AIRPORT_TYPES.find(([k]) => k === p.type)?.[1] || p.type],
          ['Elevation', elev], ['Municipality', p.municipality || 'Not published']],
        links: [...(p.wikipedia_link ? [['Wikipedia', p.wikipedia_link]] : []), ...(p.home_link ? [['Home page', p.home_link]] : [])] as [string, string][] }) }
    if (id === 'bz-fill') { const iso = D.isoOf(p), r = this.bizBy[iso], t = this.state.sub.business || 'BE'
      return this.onPick?.({ view: 'business', title: p.NAME, source: 'World Bank, B-READY (CC BY 4.0)', href: 'https://www.worldbank.org/en/businessready',
        rows: [[`${VIEWS.business.subs.find(x => x.id === t)?.label}, score`, r ? `${Math.round(r.v * 10) / 10} of 100` : 'Not covered by B-READY yet'], ['Year', r?.year || 'None']] }) }
    if (id === 'r-fill' && !(import.meta.env.PUBLIC_EDITION === 'full' && this.state.sub.rules === 'bg')) { const r = this.riseBy[D.isoOf(p)], t = this.state.sub.rules || 'BEC'
      return this.onPick?.({ view: 'rules', title: p.NAME, source: 'World Bank, RISE (CC BY 4.0)', href: 'https://rise.esmap.org',
        rows: [[`${D.RISE_LABEL[t]}, score`, r ? `${Math.round(r.v * 10) / 10} of 100` : 'Not covered by RISE'], ['Year', r?.year || 'None']] }) }
    if (import.meta.env.PUBLIC_EDITION === 'full' && id === 'r-fill') { const c = (D.peek('building-green') as any)?.data?.countries?.[D.isoOf(p)]
      return this.onPick?.({ view: 'rules', title: p.NAME, source: 'World Bank, Building Green (noncommercial use with attribution)', href: 'https://www.worldbank.org/en/building-green',
        rows: c ? [['Status', D.BG_STATUS[D.bgStatus(c)]], ['Code', c['BEC-INFO-02'] === '..' ? 'Not reported' : c['BEC-INFO-02']], ['Measured in', c['DEM-INFO-03']]] : [['Status', 'Not covered by Building Green']] }) }
  }
}

export { VIEW_IDS, HK }
