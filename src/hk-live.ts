// Hong Kong live roads (Helen 2026-10-14): TD speeds per road segment on the hk-roads centreline (segment_id = ROUTE_ID), lane
// detectors, journey time indicators (2nd generation), HyD roadworks; EPD's public EV chargers via AlreadyOpen hk-alerts (field
// names stable across EPD's CSDI renames); Marine Department typhoon shelters. TD and CSDI files are CORS-open, read directly.
// AlreadyOpen hk-alerts keeps the 15-minute history of the TD feeds (Kaggle archive).
import { json, once } from './data'
import { type Bbox, type Local, OI, circle, fill, fmt, has, icon, line, nf, ramp } from './local-kit'
import { HKR_SRC } from './hk-roads'
import { RAMPS } from './views'

const HK: Bbox = [113.8, 22.13, 114.45, 22.57]
const TD = 'https://resource.data.one.gov.hk/td/'
const ALERTS = 'https://huggingface.co/buckets/alreadyopen/hk-alerts/resolve'
const CSDI = 'https://portal.csdi.gov.hk/server/rest/services/common/'
const TERMS = 'DATA.GOV.HK terms (free reuse with attribution)'
const xml = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`${new URL(u).host} answered ${r.status}`); return new DOMParser().parseFromString(await r.text(), 'text/xml') }
const X = (e: Element, k: string) => e.getElementsByTagName(k)[0]?.textContent?.trim() || ''
export const SPEED_STOPS = [10, 40, 70, 100]   // one stop per inferno colour
const speedColor = (d: boolean) => RAMPS.inferno[d ? 'dark' : 'light']

// Speeds per road segment (every 2 min at source): ROUTE_ID -> km/h, valid readings only
export const hkSpeeds = () => once('hk-speeds', async () => {
  const doc = await xml(TD + 'traffic-detectors/irnAvgSpeed-all.xml'), speeds: Record<string, number> = {}
  for (const s of Array.from(doc.getElementsByTagName('segment'))) if (X(s, 'valid') === 'Y') speeds[X(s, 'segment_id')] = +X(s, 'speed')
  return { at: `${X(doc.documentElement, 'date')} ${X(doc.documentElement, 'time')}`, speeds }
})
// The coloured road layer: the hk-roads centreline, only segments with a speed; filter and colours set once the speeds load
export const HKR_LIVE = 'hr-live'
export const hkLiveLayer = () => ({ id: HKR_LIVE, type: 'line', source: HKR_SRC, 'source-layer': 'centerline', minzoom: 10, filter: ['in', ['to-string', ['get', 'ROUTE_ID']], ['literal', []]],
  layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#888', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 6], 'line-opacity': 0.9 } })
export function hkLiveStyle(speeds: Record<string, number>, dark: boolean) {
  const ids = Object.keys(speeds), C = speedColor(dark)
  const color = (v: number) => C[Math.max(0, SPEED_STOPS.filter(s => v >= s).length - 1)]   // the band the speed falls in
  return { filter: ['in', ['to-string', ['get', 'ROUTE_ID']], ['literal', ids]],
    color: ids.length ? ['match', ['to-string', ['get', 'ROUTE_ID']], ...ids.flatMap(id => [id, color(speeds[id])]), '#888'] : '#888' }
}

// Journey time indicator boards: CSDI gives each board and destination; the XML the minutes (JOURNEY_TYPE 1) and TD's colour
const JT_COLOR: Record<string, [string, string]> = { 1: ['Congested (TD red)', OI.red], 2: ['Slow (TD amber)', OI.orange], 3: ['Smooth (TD green)', OI.green] }
let jtAt = '', speedAt = '', evCount = 0

export const HK_LIVE_LAYERS: Local[] = [
  { id: 'L-hk-jt', view: 'traffic', cat: 'hkspeed', area: HK, minzoom: 9, what: 'journey time indicator boards in Hong Kong (TD)',
    name: 'Transport Department, Journey Time Indicators (2nd generation), via DATA.GOV.HK and CSDI', href: 'https://data.gov.hk/en-data/dataset/hk-td-sm_8-journey-time-indicators-v2', licence: TERMS,
    load: async () => {
      const [boards, doc] = await Promise.all([json(`${CSDI}td_rcd_1671692669689_59165/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`), xml(TD + 'jss/Journeytimev2.xml')])
      const now: Record<string, Element> = {}
      for (const j of Array.from(doc.getElementsByTagName('jtis_journey_time'))) { now[`${X(j, 'LOCATION_ID')}|${X(j, 'DESTINATION_ID')}`] = j; jtAt = X(j, 'CAPTURE_DATE') || jtAt }
      const by: Record<string, any> = {}
      for (const f of boards.features || []) {
        const p = f.properties, j = now[`${p.location_id}|${p.destination_id}`]
        const b = by[p.location_id] ||= { type: 'Feature', geometry: f.geometry, properties: { id: p.location_id, board: p.location_name_en, worst: 9, rows: [] as [string, string][] } }
        const colour = j ? X(j, 'COLOUR_ID') : '', mins = j && X(j, 'JOURNEY_TYPE') === '1' ? `${X(j, 'JOURNEY_DATA')} min` : j ? (X(j, 'JOURNEY_DESC') || X(j, 'JOURNEY_DATA')) : 'No reading'
        b.properties.rows.push([p.destination_name_en, `${mins}${JT_COLOR[colour] ? `, ${JT_COLOR[colour][0].split(' (')[0].toLowerCase()}` : ''}`])
        if (+colour) b.properties.worst = Math.min(b.properties.worst, +colour)
      }
      return Object.values(by).map(b => ({ ...b, properties: { ...b.properties, rows: JSON.stringify(b.properties.rows) } }))
    },
    layers: d => [circle('L-hk-jt', ['match', ['to-string', ['get', 'worst']], ...Object.entries(JT_COLOR).flatMap(([k, [, c]]) => [k, c]), '#888'], ['interpolate', ['linear'], ['zoom'], 9, 5, 15, 10], d),
      icon('L-hk-jt-icon', 'i-clock', 0.18, '#fff', { minzoom: 12 })],
    legend: () => [{ label: 'Journey time board, coloured by its slowest route: green smooth, amber slow, red congested (TD)', color: OI.orange, shape: 'dot' as const }],
    summary: all => `Journey times (TD): ${nf.format(all.length)} boards${jtAt ? `, as of ${fmt(jtAt + '+08:00')}` : ''}`,
    pick: p => ({ title: p.board, rows: [...(JSON.parse(p.rows || '[]') as [string, string][]).map(([d, t]) => [`To ${d}`, t] as [string, string]), ...has('As of', jtAt && fmt(jtAt + '+08:00'))] }) },
  { id: 'L-hk-det', view: 'traffic', cat: 'hkspeed', area: HK, minzoom: 12, what: 'traffic detectors on strategic and major roads in Hong Kong (TD)',
    name: 'Transport Department, Traffic Data of Strategic / Major Roads, via DATA.GOV.HK', href: 'https://data.gov.hk/en-data/dataset/hk-td-sm_4-traffic-data-strategic-major-roads', licence: TERMS,
    load: async () => {
      const [csv, doc, sp] = await Promise.all([fetch('https://static.data.gov.hk/td/traffic-data-strategic-major-roads/info/traffic_speed_volume_occ_info.csv').then(r => r.text()),
        xml(TD + 'traffic-detectors/rawSpeedVol-all.xml'), hkSpeeds()])
      speedAt = sp.data?.at || ''
      const lanes: Record<string, { lane: string; speed: number; occ: number; vol: number; ok: boolean }[]> = {}
      const period = doc.getElementsByTagName('period')[0]   // the newest 30 s period
      for (const det of period ? Array.from(period.getElementsByTagName('detector')) : [])
        lanes[X(det, 'detector_id')] = Array.from(det.getElementsByTagName('lane')).map(l => ({ lane: X(l, 'lane_id'), speed: +X(l, 'speed'), occ: +X(l, 'occupancy'), vol: +X(l, 'volume'), ok: X(l, 'valid') === 'Y' }))
      const at = period ? `${X(doc.documentElement, 'date')} ${X(period, 'period_from')}` : ''
      // quoted fields may hold commas ("Road A, near B"): split on commas outside quotes, by header name
      const rows = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(l => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')))
      const H = rows[0].map(h => h.trim()), col = (r: string[], k: string) => r[H.indexOf(k)]
      return rows.slice(1).map(r => {
        const [id, district, road, lat, lon, dir] = ['AID_ID_Number', 'District', 'Road_EN', 'Latitude', 'Longitude', 'Direction'].map(k => col(r, k) || '')
        const ls = (lanes[id] || []).filter(l => l.ok), vol = ls.reduce((a, l) => a + l.vol, 0)
        const speed = ls.length ? Math.round(vol ? ls.reduce((a, l) => a + l.speed * l.vol, 0) / vol : ls.reduce((a, l) => a + l.speed, 0) / ls.length) : -1
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [+lon, +lat] }, properties: { id, district, road: road.trim(), dir, speed, vol, at,
          lanes: JSON.stringify(ls.map(l => [l.lane, `${l.speed} km/h, ${l.vol} vehicles, ${l.occ}% occupied`])) } }
      }).filter(f => { const [x, y] = f.geometry.coordinates; return x > 113 && x < 115 && y > 22 && y < 23 })
    },
    layers: d => [circle('L-hk-det', ['case', ['<', ['get', 'speed'], 0], '#888', ramp(['get', 'speed'], SPEED_STOPS, speedColor(d))], ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 6], d)],
    legend: d => [{ label: 'Small dots: traffic detectors, coloured by speed (click for each lane)', color: speedColor(d)[3], shape: 'dot' }],
    summary: all => `Road speeds (TD): ${nf.format(all.length)} detectors${speedAt ? `, segment speeds as of ${fmt(speedAt.replace(' ', 'T') + '+08:00')}` : ''}`,
    pick: p => ({ title: p.road, rows: [['Speed', p.speed < 0 ? 'No valid reading' : `${p.speed} km/h (lanes weighted by volume)`], ['Vehicles, 30 s', String(p.vol)],
      ...(JSON.parse(p.lanes || '[]') as [string, string][]), ...has('Direction', p.dir), ...has('District', p.district), ...has('Period from', p.at)] }) },
  { id: 'L-hk-rw', view: 'hazards', cat: 'roads', area: HK, minzoom: 8, what: 'roadworks with lane closures on 70 km/h+ roads in Hong Kong (HyD)',
    name: 'Highways Department via Transport Department, Roadworks location data, via DATA.GOV.HK', href: 'https://data.gov.hk/en-data/dataset/hk-td-tis_18-roadworks-location', licence: TERMS,
    load: async () => (await hkRoadworks()).data || [],
    layers: d => [circle('L-hk-rw', ['case', ['==', ['get', 'worksstatus'], 'In Progress'], OI.orange, OI.yellow], ['interpolate', ['linear'], ['zoom'], 8, 6, 14, 10], d),
      icon('L-hk-rw-icon', 'i-cone', 0.2, '#151918')],
    legend: () => [{ label: 'Roadworks in progress (lane closure)', color: OI.orange, shape: 'dot' }, { label: 'Roadworks under preparation', color: OI.yellow, shape: 'dot' }],
    summary: all => `Roadworks (HyD, 70 km/h+ roads): ${nf.format(all.length)}`,
    pick: p => ({ title: `Roadworks, ${p.roadname}`, rows: [['Status', p.worksstatus], ['Works', p.workstype], ['Where', p.locdesc], ...has('Lane', p.lane), ...has('Bound', p.bound),
      ['From', fmt(p.starttime.replace(' ', 'T') + '+08:00')], ['To', fmt(p.endtime.replace(' ', 'T') + '+08:00')], ...has('Remarks', p.remark), ...has('District', p.district), ['Source', p.datasource]] }) },
  { id: 'L-hk-ev', view: 'traffic', cat: 'hkev', area: HK, minzoom: 9, what: 'public EV charging sites in Hong Kong (EPD)',
    name: 'Environmental Protection Department, EV chargers for public access (CSDI), via AlreadyOpen hk-alerts', href: 'https://data.gov.hk/en-data/dataset/hk-epd-evcpateam-evc-1', licence: 'DATA.GOV.HK and CSDI terms (free reuse with attribution)',
    load: async () => { const d = await json(`${ALERTS}/live/ev-chargers.json`); evCount = d.features.reduce((a: number, f: any) => a + (f.properties._chargers || 0), 0)
      return d.features.map((f: any) => ({ ...f, properties: { name: f.properties._name, address: f.properties._address, district: f.properties._district, n: f.properties._chargers,
        kinds: JSON.stringify(f.properties._by_kind || {}) } })) },
    layers: d => [circle('L-hk-ev', OI.green, ['interpolate', ['linear'], ['get', 'n'], 1, 3, 20, 6, 200, 12], d), icon('L-hk-ev-icon', 'i-plug', 0.16, '#fff', { minzoom: 14 })],
    legend: () => [{ label: 'Public EV charging site, size by number of chargers', color: OI.green, shape: 'dot' }],
    summary: all => `EV charging (EPD): ${nf.format(all.length)} sites, ${nf.format(evCount)} chargers`,
    pick: p => ({ title: p.name, rows: [['Chargers', String(p.n)], ...Object.entries(JSON.parse(p.kinds || '{}')).map(([k, v]) =>
      [k.replace(/_no$/i, '').replace(/__/g, ' ').replace(/_/g, ' ').replace(/^(\w+) /, (_, s) => `${s[0]}${s.slice(1).toLowerCase()}: `), String(v)] as [string, string]),
      ...has('Address', p.address), ...has('District', p.district)] }) },
  { id: 'L-hk-shelter', view: 'hazards', cat: 'storms', area: HK, minzoom: 9, what: 'typhoon shelters in Hong Kong (Marine Department)',
    name: 'Marine Department, Typhoon Shelters (CSDI)', href: 'https://data.gov.hk/en-data/dataset/hk-md-hydro-typhoon-shelters', licence: 'DATA.GOV.HK and CSDI terms (free reuse with attribution)',
    load: async () => (await json(`${CSDI}mardep_rcd_1730971403590_9667/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`)).features,
    layers: () => [fill('L-hk-shelter', OI.sky, 0.25), line('L-hk-shelter-line', OI.blue, 1.5)],
    legend: () => [{ label: 'Typhoon shelter (Marine Department)', color: OI.sky, shape: 'line' }],
    pick: p => ({ title: p.OBJNAM || 'Typhoon shelter', rows: has('Rules', p.INFORM) }) },
]

// Roadworks also go to the news feed: HK local times, in progress first
export const hkRoadworks = () => once('hk-rw', async () => (await json(TD + 'roadworks-location/get_all_the_roadworks.geojson')).features.map((f: any) => ({ ...f,
  properties: Object.fromEntries(Object.entries(f.properties).filter(([k]) => !/_(tc|sc)$/.test(k))) })) as any[])
