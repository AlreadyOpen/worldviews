// Hong Kong: alerts (TD Special Traffic News, HKO warnings, HA A&E waiting times; Helen 2026-10-14) and aircraft within 250 nm, from AlreadyOpen world-flights' 15-minute snapshot (adsb.lol, ODbL). Altitude is kept
// (alt_m, metres above the ellipsoid where the aircraft reports it, else barometric), so the 3D marks can fly them at height.
import { json, once, peek } from './data'
import { type Bbox, type Local, OI, circle, fmt, has, icon, nf, ramp } from './local-kit'
import { RAMPS } from './views'

export const FLIGHTS = 'https://huggingface.co/buckets/alreadyopen/world-flights/resolve'
const HK250: Bbox = [109.6, 17.8, 118.7, 26.8]
const HK: Bbox = [113.8, 22.13, 114.45, 22.57]
export const HK_CENTRE: [number, number] = [114.17, 22.32]

// HK1980 Grid (EPSG:2326: transverse Mercator on International 1924) to WGS84 lon/lat. The datum step is the Survey and Mapping
// Office's published shortcut (lat − 5.5″, lon + 8.8″), about a metre off pyproj (checked 2026-10-14 at Lam Tin Station): enough for a pin.
export function hk80(e: number, n: number): [number, number] {
  const a = 6378388, f = 1 / 297, e2 = f * (2 - f), ep2 = e2 / (1 - e2), d = Math.PI / 180, m0 = 1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256
  const lat0 = (22 + 18 / 60 + 43.68 / 3600) * d, lon0 = (114 + 10 / 60 + 42.80 / 3600) * d
  const M = (p: number) => a * (m0 * p - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p) - (35 * e2 ** 3 / 3072) * Math.sin(6 * p))
  const mu = (M(lat0) + n - 819069.80) / (a * m0), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
  const C = ep2 * Math.cos(p1) ** 2, T = Math.tan(p1) ** 2, N = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5
  const D = (e - 836694.05) / N
  const lat = p1 - (N * Math.tan(p1) / R) * (D ** 2 / 2 - (5 + 3 * T + 10 * C - 4 * C ** 2 - 9 * ep2) * D ** 4 / 24)
  return [(lon0 + (D - (1 + 2 * T + C) * D ** 3 / 6) / Math.cos(p1)) / d + 8.8 / 3600, lat / d - 5.5 / 3600]
}
// A place name to lon/lat with the Lands Department's location search (www.map.gov.hk, CORS-open), first hit, cached per visit
const where = (q: string) => once('hk-loc:' + q, async () => {
  const r = await json(`https://www.map.gov.hk/gs/api/v1.0.0/locationSearch?q=${encodeURIComponent(q)}`)
  return Array.isArray(r) && r[0] ? hk80(+r[0].x, +r[0].y) : null
}).then(f => f.data || null)

// TD Special Traffic News, both feeds: the 2nd generation (v2: road, landmark, district, sometimes a position) and the first
// (v1: text only), which also carries MTR and ferry notices (14 Oct 2026: "Kwun Tong Line trains will not stop at Lam Tin
// Station" was in v1 only). Same English text in both = one message.
const PLACE = /((?:[A-Z][\w'.]*\s)+(?:Road|Street|Link|Tunnel|Highway|Bridge|Avenue|Station|Interchange|Bypass|Corridor|Pier|Terminal|Drive|Lane|Path|Flyover|Crossing|Hospital|Centre))\b/
// Road names in a message, upper case as TD's Road Network spells them (for the whole-road highlight)
const ROAD = /((?:[A-Z][\w'.]*\s)+(?:Road|Street|Link|Tunnel|Highway|Bridge|Avenue|Interchange|Bypass|Corridor|Drive|Lane|Path|Flyover|Crossing))\b/g
const roadsIn = (...texts: string[]) => [...new Set(texts.flatMap(t => [...(t || '').matchAll(ROAD)].map(m => m[1].trim().toUpperCase())))]
const XT = (e: Element, k: string) => e.getElementsByTagName(k)[0]?.textContent?.trim() || ''
export type HkMsg = { id: string; text: string; t: number; title: string; loc: string; roads: string[]; c?: [number, number]; at?: [number, number][]; guessed?: boolean; status: string; feed: string }   // at: every pier of a ferry notice
export const hkTraffic = () => once('hk-stn', async () => {
  const get = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`${new URL(u).host} answered ${r.status}`); return new DOMParser().parseFromString(await r.text(), 'text/xml') }
  const [v2, v1] = await Promise.all([get('https://www.td.gov.hk/en/special_news/trafficnews.xml'), get('https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml').catch(() => null)])
  const out: HkMsg[] = []
  for (const m of Array.from(v2.getElementsByTagName('message'))) {
    const lat = +XT(m, 'LATITUDE'), lon = +XT(m, 'LONGITUDE'), loc = [XT(m, 'LOCATION_EN'), XT(m, 'DIRECTION_EN') && `(${XT(m, 'DIRECTION_EN')} bound)`, XT(m, 'NEAR_LANDMARK_EN') && `near ${XT(m, 'NEAR_LANDMARK_EN')}`].filter(Boolean).join(' ')
    out.push({ id: 'td2-' + XT(m, 'INCIDENT_NUMBER'), text: XT(m, 'CONTENT_EN'), t: Date.parse(XT(m, 'ANNOUNCEMENT_DATE') + '+08:00'), title: XT(m, 'INCIDENT_HEADING_EN') || 'Traffic news',
      loc, roads: roadsIn(XT(m, 'LOCATION_EN'), XT(m, 'CONTENT_EN')), status: XT(m, 'INCIDENT_STATUS_EN'), feed: 'TD Special Traffic News (2nd generation)',
      c: lat && lon ? [lon, lat] : (await where(XT(m, 'NEAR_LANDMARK_EN')) || await where(XT(m, 'LOCATION_EN'))) || undefined })
  }
  for (const m of v1 ? Array.from(v1.getElementsByTagName('message')) : []) {
    const text = XT(m, 'EngText').replace(/\s+/g, ' ')
    if (!text || out.some(o => o.text.replace(/\s+/g, ' ') === text)) continue
    // ReferenceDate is the feed's time ("2026/10/14 上午 09:01:31"), not the message's: it is the best v1 gives
    const [, y, mo, dd, ap, h, mi, se] = XT(m, 'ReferenceDate').match(/(\d+)\/(\d+)\/(\d+)\s*(上午|下午)?\s*(\d+):(\d+):(\d+)/) || []
    const t = y ? Date.parse(`${y}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}T${String((+h % 12) + (ap === '下午' ? 12 : 0)).padStart(2, '0')}:${mi}:${se}+08:00`) : Date.now()
    const place = text.match(PLACE)?.[1], piers = /ferry/i.test(text) ? await ferryPiers(text) : []
    out.push({ id: 'td1-' + XT(m, 'msgID'), text, t, title: /\b\w+ Line trains?\b|\bStation is closed\b|\bMTR shuttle\b/i.test(text) ? 'MTR service' : /ferry/i.test(text) ? 'Ferry service' : 'Traffic news',
      status: XT(m, 'CurrentStatus') === '3' ? 'Update' : 'New', feed: 'TD Special Traffic News', guessed: !piers.length && !!place, roads: piers.length ? [] : roadsIn(text),
      loc: piers.length ? piers.map(p => p.name).join('; ') : place || '', c: piers[0]?.c || (place && await where(place)) || undefined, at: piers.length ? piers.map(p => p.c) : undefined })
  }
  return out
})

// Ferry notices name their routes in quotes ("'Ma Wan - Central' Route"): their piers, from TD's routes and fares data
// (JSON_FERRY.json, every stop with its route, name and position; Helen pointed to it 2026-10-14)
const ferryStops = () => once('td-ferry', async () => {
  const r = await fetch('https://static.data.gov.hk/td/routes-fares-geojson/JSON_FERRY.json')
  if (!r.ok) throw new Error(`static.data.gov.hk answered ${r.status}`)
  return JSON.parse((await r.text()).replace(/^\uFEFF/, '')).features as any[]   // the file starts with a byte-order mark
})
async function ferryPiers(text: string) {
  const routes = [...text.matchAll(/['‘’]([^'‘’\n]+? - [^'‘’\n]+?)['‘’]/g)].map(m => m[1].trim().toLowerCase())
  const stops = (await ferryStops()).data || [], out = new Map<number, { name: string; c: [number, number] }>()
  for (const f of stops) if (routes.includes(String(f.properties.routeNameE).toLowerCase()))
    out.set(f.properties.stopId, { name: f.properties.stopNameE, c: f.geometry.coordinates })
  return [...out.values()]
}

// HKO warnings in force (warnsum): territory-wide, so they go to the feed and the answer, not the map
export const hkWarnings = () => once('hko-warn', async () => Object.values(await json('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en') as Record<string, any>)
  .filter(w => w.actionCode !== 'CANCEL').map(w => ({ id: 'hko-' + w.code, text: `${w.name}${w.type ? ` (${w.type})` : ''} in force`, t: Date.parse(w.updateTime || w.issueTime), c: HK_CENTRE })))

// Feeds without CORS (AQHI, press releases) come from AlreadyOpen hk-alerts, republished every 15 minutes
export const ALERTS = 'https://huggingface.co/buckets/alreadyopen/hk-alerts/resolve'
// Press releases that are notices about now (traffic arrangements, suspensions, closures, flags, warnings, cases), for the feed;
// the bucket keeps all 100. ponytail: a keyword list; a press release about a new policy with "closure" in it slips through.
const NOTICE = /traffic arrangement|suspen|closure|closed|flags? hoisted|warning|landslip|flood|water supply|outbreak|case of|confirmed .* case|power|road works|diversion|cancel/i
export const hkPress = () => once('hk-press', async () => ((await json(`${ALERTS}/live/press.json`)).items as any[])
  .filter(i => NOTICE.test(i.title)).map(i => ({ id: i.link, text: i.title, t: Date.parse(i.time), c: HK_CENTRE, href: i.link })))

// "less than 15 minutes", "1 hour", "over 8 hours" to minutes
const mins = (s = '') => { const m = s.match(/([\d.]+)\s*(minute|hour)/); return m ? +m[1] * (m[2] === 'hour' ? 60 : 1) : null }
export const ALT_M_STOPS = [0, 1000, 3000, 7000, 12000]
let asOf = 0, aedAt = '', aqhiAt = ''
const peekCount = () => peek<HkMsg[]>('hk-stn')?.data?.length ?? 0   // every message, placed or not

export const HK_LAYERS: Local[] = [
  { id: 'L-hk-inc', view: 'hazards', cat: 'roads', area: HK, minzoom: 8, what: 'traffic and transport alerts in Hong Kong (TD Special Traffic News)',
    name: 'Transport Department, Special Traffic News (both feeds), via DATA.GOV.HK', href: 'https://data.gov.hk/en-data/dataset/hk-td-tis_19-special-traffic-news-v2', licence: 'DATA.GOV.HK terms (free reuse with attribution)',
    load: async () => ((await hkTraffic()).data || []).flatMap(m => (m.at || (m.c ? [m.c] : [])).map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c },
      properties: { title: m.title, text: m.text, loc: m.loc, t: m.t, status: m.status, feed: m.feed, guessed: !!m.guessed, mtr: m.title !== 'Traffic news' && m.title !== 'Road Incident' } }))),
    layers: d => [circle('L-hk-inc', ['case', ['get', 'mtr'], OI.pink, OI.orange], ['interpolate', ['linear'], ['zoom'], 8, 6, 14, 10], d), icon('L-hk-inc-icon', 'i-warning', 0.2)],
    legend: () => [{ label: 'Road incident or closure (TD)', color: OI.orange, shape: 'dot' }, { label: 'MTR or ferry service notice (TD)', color: OI.pink, shape: 'dot' }],
    summary: all => { const n = peekCount(); return `Traffic news (TD): ${nf.format(n)} message${n === 1 ? '' : 's'} now, ${nf.format(all.length)} placed on the map` },
    pick: p => ({ title: p.title, rows: [['Message', p.text], ...has('Where', p.loc), ['Announced', fmt(+p.t)], ...has('Status', p.status), ['Source', p.feed],
      ...(p.guessed === true || p.guessed === 'true' ? [['Position', 'Matched from the place named in the message (Lands Department location search)'] as [string, string]] : [])] }) },
  { id: 'L-hk-aqhi', view: 'hazards', cat: 'health', area: HK, minzoom: 8, what: 'air quality monitoring stations in Hong Kong (AQHI)',
    name: 'Environmental Protection Department, AQHI, via AlreadyOpen hk-alerts (positions from CSDI)', href: 'https://www.aqhi.gov.hk', licence: 'DATA.GOV.HK and CSDI terms (free reuse with attribution)',
    load: async () => { const d = await json(`${ALERTS}/live/aqhi.json`); aqhiAt = d.features?.[0]?.properties?.time || ''; return d.features },
    // AQHI bands: 1-3 low, 4-6 moderate, 7 high, 8-10 very high, 10+ serious
    layers: d => { const L: any = circle('L-hk-aqhi', ramp(['get', 'aqhi'], [1, 4, 7, 10], RAMPS.inferno[d ? 'dark' : 'light']), ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 9], d)
      L.paint['circle-stroke-width'] = ['case', ['==', ['get', 'kind'], 'roadside'], 3, 1]; return [L] },
    legend: d => [{ label: 'Air quality (AQHI 1 low to 10+ serious), roadside stations ringed', color: RAMPS.inferno[d ? 'dark' : 'light'][1], shape: 'ring' }],
    summary: all => `Air quality (EPD AQHI): ${nf.format(all.length)} stations${aqhiAt ? `, as of ${fmt(aqhiAt)}` : ''}`,
    pick: p => ({ title: `${p.station} air quality`, rows: [['AQHI', `${p.aqhi_text} (${p.risk} health risk)`], ['Station', p.kind === 'roadside' ? 'Roadside' : 'General'], ['As of', fmt(p.time)]], href: p.link }) },
  { id: 'L-hk-aed', view: 'hazards', cat: 'health', area: HK, minzoom: 8, what: 'public hospital A&E departments in Hong Kong with waiting times (Hospital Authority)',
    name: 'Hospital Authority, A&E waiting time, via DATA.GOV.HK', href: 'https://data.gov.hk/en-data/dataset/hospital-hadata-ae-waiting-time', licence: 'DATA.GOV.HK terms (free reuse with attribution)',
    load: async () => {
      const d = await json('https://www.ha.org.hk/opendata/aed/aedwtdata2-en.json')
      aedAt = d.updateTime || ''
      return (await Promise.all((d.waitTime || []).map(async (h: any) => {
        const c = await where(h.hospName)
        return c && { type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { name: h.hospName, t1: h.t1wt, t2: h.t2wt, t3: h.t3p50, t3p95: h.t3p95,
          t45: h.t45p50, t45p95: h.t45p95, wait: mins(h.t45p50) ?? -1 } }
      }))).filter(Boolean)
    },
    // colour by the median wait for stable and non-urgent cases (categories 4 and 5): the wait most walk-in patients see
    layers: d => [circle('L-hk-aed', ['case', ['<', ['get', 'wait'], 0], '#888', ramp(['get', 'wait'], [30, 90, 240, 480], RAMPS.inferno[d ? 'dark' : 'light'])], ['interpolate', ['linear'], ['zoom'], 8, 7, 14, 12], d),
      icon('L-hk-aed-icon', 'i-first-aid', 0.2)],
    legend: d => [{ label: 'A&E median wait, stable and non-urgent (30 min to 8 h and over)', color: RAMPS.inferno[d ? 'dark' : 'light'][2], shape: 'dot' }],
    summary: all => `A&E waits (Hospital Authority): ${nf.format(all.length)} hospitals${aedAt ? `, as of ${aedAt}` : ''}`,
    pick: p => ({ title: p.name, rows: [['Critical (median)', p.t1], ['Emergency (median)', p.t2], ['Urgent', `${p.t3} median, ${p.t3p95} for 95% of patients`],
      ['Stable and non-urgent', `${p.t45} median, ${p.t45p95} for 95% of patients`], ['As of', aedAt]] }) },
  { id: 'L-hk-flights', view: 'satellites', area: HK250, minzoom: 5, what: 'aircraft around Hong Kong (adsb.lol, 15-minute snapshot)',
    name: 'adsb.lol via AlreadyOpen world-flights', href: 'https://huggingface.co/datasets/alreadyopen/world-flights', licence: 'ODbL 1.0',
    load: async () => {
      const d = await json(`${FLIGHTS}/live/hk.json`)
      asOf = (d.now || 0) * (d.now > 1e12 ? 1 : 1000)
      return (d.ac || []).filter((a: any) => Number.isFinite(a.lon) && Number.isFinite(a.lat)).map((a: any) => {
        const ft = typeof a.alt_geom === 'number' ? a.alt_geom : typeof a.alt_baro === 'number' ? a.alt_baro : 0   // 'ground' = 0
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
          properties: { flight: (a.flight || '').trim(), reg: a.r, type: a.t, alt_ft: ft, alt_m: Math.round(ft * 0.3048), ground: a.alt_baro === 'ground',
            gs: a.gs, track: a.track ?? a.true_heading ?? 0, squawk: a.squawk } }
      })
    },
    layers: d => [circle('L-hk-flights', ramp(['get', 'alt_m'], ALT_M_STOPS, RAMPS.viridis[d ? 'dark' : 'light']), ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 7], d),
      icon('L-hk-flights-icon', 'i-plane', 0.16, '#fff', { minzoom: 8 })],
    legend: d => [{ label: 'Aircraft, colour by altitude (0 to 12 km)', color: RAMPS.viridis[d ? 'dark' : 'light'][3], shape: 'dot' }],
    summary: all => `Aircraft around Hong Kong: ${nf.format(all.length)}${asOf ? `, positions at ${new Date(asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''} (15-minute snapshot)`,
    pick: p => ({ title: p.flight || p.reg || 'Aircraft', rows: [...has('Registration', p.reg), ...has('Type', p.type),
      ['Altitude', p.ground ? 'On the ground' : `${nf.format(p.alt_ft)} ft (${nf.format(p.alt_m)} m)`], ...has('Ground speed', p.gs != null ? `${Math.round(p.gs)} kt` : null),
      ...has('Track', p.track != null ? `${Math.round(p.track)}°` : null), ...has('Squawk', p.squawk)] }) },
]
