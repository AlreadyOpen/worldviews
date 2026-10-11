// South Australia fire layers from AlreadyOpen sa-fire (DEW and CFS on Data.SA), drawn the way the viewer chooses: each
// presentation is one that existing fire platforms use (Helen, 2026-10-11). Every choice changes what is drawn:
//   plain    the published GeoJSON as is, one colour per layer (the whole file loads)
//   styled   the same GeoJSON, coloured by the data's own fields (incident type, year of the last fire), with labels
//   tiles    lossless PMTiles: every feature at every zoom it can be drawn at, full detail from zoom 14
//   thinned  PMTiles with tippecanoe's defaults: dense areas lose features at low zoom
//   link     nothing drawn; a click in South Australia opens a card of links to the official sources
// HOLD layers (licence not settled) are links only in both editions. To draw them on the full site once sa-fire publishes them,
// set HOLD_DRAW_FULL to true. In a dev server, ?firehold=local draws them from the local preview files (rsbuild proxy
// /cfs-preview -> 127.0.0.1:8765); both branches are constant-false in a production build, so no HOLD file URL is bundled.
import type { Bbox } from './local-kit'

export type FireMode = 'off' | 'plain' | 'styled' | 'tiles' | 'thinned' | 'link'
export const FIRE_MODES: [FireMode, string][] = [['off', 'Off'], ['plain', 'Plain: the GeoJSON as published (large files)'], ['styled', 'Styled: coloured by the data (large files)'],
  ['tiles', 'Tiled: every feature'], ['thinned', 'Tiled, thinned at low zoom'], ['link', 'Link only']]
export const FIRE_DEFAULT: FireMode = 'tiles'
export const isFireMode = (m: any): m is FireMode => FIRE_MODES.some(([k]) => k === m)
export const SA_BOX: Bbox = [129, -38.2, 141.1, -25.9]
export const FIRE_MINZOOM = 5
const B = 'https://huggingface.co/buckets/alreadyopen/sa-fire/resolve'
const HOLD_DRAW_FULL = false
const FULL_HOLD = import.meta.env.PUBLIC_EDITION === 'full' && HOLD_DRAW_FULL
const DEV_HOLD = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('firehold') === 'local'
const DEW = 'Department for Environment and Water (SA)', CFS = 'SA Country Fire Service'
const BY = 'CC BY 4.0'

export type FireLayer = {
  id: string; name: string; owner: string; licence: string; docs: string; kind: 'poly' | 'line' | 'point'; color: string
  geojson?: string; tiles?: string; hold?: boolean
}
const ds = (id: string) => `https://data.sa.gov.au/data/dataset/${id}`
export const FIRE: FireLayer[] = [
  { id: 'fire-history', name: 'Bushfires and prescribed burns, every one on record', owner: DEW, licence: BY, docs: ds('e5434c77-9815-48e6-8ea7-fb35c78f6786'), kind: 'poly', color: '#a16207',
    geojson: `${B}/FIREMGT_FireHistory_GDA2020.geojson`, tiles: `${B}/fire-history` },
  { id: 'last-fire', name: 'Last bushfire or prescribed burn at each place', owner: DEW, licence: BY, docs: ds('e81e147c-aba1-4d92-acf3-8cd5163c1104'), kind: 'poly', color: '#b45309',
    geojson: `${B}/FIREMGT_LastFire_GDA2020.geojson`, tiles: `${B}/last-fire` },
  { id: 'bushfire-management-areas', name: 'Bushfire management areas', owner: CFS, licence: BY, docs: ds('d93dc636-ec20-45f2-beb0-998b1c5f438c'), kind: 'poly', color: '#475569',
    geojson: `${B}/BushfireManagementAreas_GDA2020.geojson`, tiles: `${B}/bushfire-management-areas` },
  { id: 'emergency-location-markers', name: 'Emergency location markers', owner: DEW, licence: BY, docs: ds('52e3d746-c8d1-407f-8561-d2afcd5f6ef5'), kind: 'point', color: '#0072B2',
    geojson: `${B}/TOPO_EmergencyLocationMarkers_GDA2020.geojson`, tiles: `${B}/emergency-location-markers` },
  // HOLD
  { id: 'prescribed-burns', name: 'Prescribed burns, upcoming', owner: DEW, licence: 'CC BY-ND 4.0', docs: ds('13d3bb89-4354-4a36-9857-b8ee7ad93904'), kind: 'poly', color: '#0369a1', hold: true,
    geojson: DEV_HOLD ? '/cfs-preview/data/PrescribedBurns/Upcoming_Prescribed_Burns_GDA2020.geojson' : FULL_HOLD ? `${B}/Upcoming_Prescribed_Burns_GDA2020.geojson` : undefined },
  { id: 'fire-ban-districts', name: 'Fire ban districts', owner: CFS, licence: 'CC BY-NC-ND (Data.SA) or CC BY 3.0 AU (the file)', docs: ds('ec5b0373-63a2-4193-b095-2dd5b66edf3f'), kind: 'poly', color: '#c2410c', hold: true,
    geojson: DEV_HOLD ? '/cfs-preview/data/FireBanDistricts/FireBanDistricts_GDA2020.geojson' : FULL_HOLD ? `${B}/FireBanDistricts_GDA2020.geojson` : undefined },
  { id: 'bushfire-safer-places', name: 'Bushfire safer places', owner: CFS, licence: 'CC BY-NC-ND (Data.SA) or CC BY 3.0 AU (the file)', docs: ds('00ccaac9-d75a-45ad-a6b2-8a9d70d46aa3'), kind: 'poly', color: '#15803d', hold: true,
    geojson: DEV_HOLD ? '/cfs-preview/data/BushfireSaferPlaces/BushfireSaferPlaces_GDA2020.geojson' : FULL_HOLD ? `${B}/BushfireSaferPlaces_GDA2020.geojson` : undefined },
  { id: 'last-resort-refuges', name: 'Last resort refuges', owner: CFS, licence: 'CC BY-NC-ND (Data.SA) or CC BY 3.0 AU (the file)', docs: ds('4caf5333-138e-4048-b71f-15c59163355a'), kind: 'point', color: '#b91c1c', hold: true,
    geojson: DEV_HOLD ? '/cfs-preview/data/BushfireLastResortRefuges/BushfireLastResortRefuges_GDA2020.geojson' : FULL_HOLD ? `${B}/BushfireLastResortRefuges_GDA2020.geojson` : undefined },
  { id: 'bmap-assets', name: 'Bushfire management plan assets (areas)', owner: CFS, licence: 'CC BY-NC-ND (Data.SA) or CC BY 3.0 AU (the file)', docs: ds('1897bf91-5221-4719-bce2-341721a85d51'), kind: 'poly', color: '#7c3aed', hold: true,
    geojson: DEV_HOLD ? '/cfs-preview/data/BMAPAssetPolygons/BMAPAssetPolygons_GDA2020.geojson' : FULL_HOLD ? `${B}/BMAPAssetPolygons_GDA2020.geojson` : undefined },
]
// What is drawn: open layers always; HOLD layers only where a URL survived the build (never in a production build today).
export const drawable = (L: FireLayer, mode: FireMode) => mode === 'tiles' || mode === 'thinned' ? !!L.tiles : (mode === 'plain' || mode === 'styled') && !!L.geojson
export const FIRE_LINKS: [string, string][] = [
  ['Current incidents and warnings (CFS)', 'https://www.cfs.sa.gov.au/'], ['Fire bans and restrictions (CFS)', 'https://www.cfs.sa.gov.au/warnings-restrictions/'],
  ['Bushfire safer places and last resort refuges (CFS)', 'https://www.cfs.sa.gov.au/plan-prepare/bushfire-safer-places/'],
  ...FIRE.map(L => [`${L.name} (Data.SA)`, L.docs] as [string, string])]

const YEAR = (dark: boolean) => ['interpolate', ['linear'], ['to-number', ['get', 'FIREYEAR'], 1950], 1950, dark ? '#4a3b6b' : '#d9cfe6', 1990, dark ? '#7a4a8a' : '#b48ac0', 2010, '#dd513a', 2025, '#f38a1a']
const TYPE: any = ['match', ['get', 'INCIDENTTY'], 'Bushfire', '#D55E00', 'Prescribed Burn', '#0072B2', '#9ca3af']
// MapLibre layers for one fire layer (source added by the engine; vector tiles carry the layer as source-layer = id)
export function fireLayers(L: FireLayer, styled: boolean, dark: boolean): any[] {
  const id = `f-${L.id}`, halo = { 'text-halo-color': dark ? '#151918' : '#fbfcfa', 'text-halo-width': 1.5 }, ink = dark ? '#e6ebe8' : '#1d2120'
  if (L.kind === 'point') return [
    { id: `${id}-pt`, type: 'circle', paint: { 'circle-radius': styled ? ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 6] : 3, 'circle-color': L.color,
      'circle-stroke-color': dark ? '#151918' : '#fbfcfa', 'circle-stroke-width': styled ? 1.5 : 0.5 } },
    ...(styled ? [{ id: `${id}-lbl`, type: 'symbol', minzoom: 11, layout: { 'text-field': ['to-string', ['coalesce', ['get', 'EMERGENCYL'], ['get', 'lrr'], '']], 'text-size': 11,
      'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': ink, ...halo } }] : [])]
  // styled: the last fire fills each place by year; every fire on record is an outline by type on top (both cover the same ground)
  const fill = !styled || L.id === 'fire-history' || L.id === 'bushfire-management-areas' ? null : L.id === 'last-fire' ? YEAR(dark) : L.color
  return [
    ...(fill ? [{ id: `${id}-fill`, type: 'fill', paint: { 'fill-color': fill, 'fill-opacity': 0.45 } }] : []),
    ...(styled && L.id === 'last-fire' ? [] : [{ id: `${id}-line`, type: 'line', paint: { 'line-color': styled && L.id === 'fire-history' ? TYPE : L.color, 'line-width': L.id === 'bushfire-management-areas' ? 1.8 : styled && L.id === 'fire-history' ? 1.1 : 0.8,
      ...(L.id === 'bushfire-management-areas' ? { 'line-dasharray': [3, 2] } : {}) } }]),   // styled last fire: fill only, so the type outlines show
    ...(styled && L.id === 'bushfire-management-areas' ? [{ id: `${id}-lbl`, type: 'symbol', layout: { 'text-field': ['get', 'area_name'], 'text-size': 12, 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': L.color, ...halo } }] : []),
  ]
}
export function fireLegend(mode: FireMode, dark: boolean) {
  const on = FIRE.filter(L => drawable(L, mode))
  if (mode === 'styled') return [
    { label: 'Fire on record, outline: bushfire', color: '#D55E00', shape: 'line' as const }, { label: 'Fire on record, outline: prescribed burn', color: '#0072B2', shape: 'line' as const },
    { label: 'Last fire here, fill: 1950 or earlier (purple) to 2025 (orange)', color: '#f38a1a', shape: 'dot' as const },
    { label: 'Bushfire management area (dashed)', color: '#475569', shape: 'line' as const }, { label: 'Emergency location marker, numbered', color: '#0072B2', shape: 'dot' as const },
    ...on.filter(L => L.hold).map(L => ({ label: L.name, color: L.color, shape: 'dot' as const }))]
  return on.map(L => ({ label: L.name, color: L.color, shape: L.kind === 'point' ? 'dot' as const : 'line' as const }))
}
// A clicked fire feature's fields, as published (dates from epoch milliseconds; empty and housekeeping fields left out)
export function fireRows(p: any): [string, string][] {
  const skip = /^(fid|tiny_polygon_point|shape_?(leng|length|area)|FID)$/i
  return Object.entries(p || {}).filter(([k, v]) => !skip.test(k) && v != null && String(v).trim() !== '').slice(0, 16)
    .map(([k, v]) => [k, /DATE$/i.test(k) && typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : String(v)])
}
