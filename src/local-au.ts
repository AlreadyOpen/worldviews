// Australia (South Australia deepest): Geoscience Australia, DEA Hotspots, NSW RFS, SA DIT, ABS, SA Education, City of Melbourne, AEMO.
import { json, once } from './data'
import { RAMPS } from './views'
import { type Bbox, type Local, OI, I, arcgis, circle, env, fc, fill, fmt, has, heights, icon, line, magColor, magRadius, nf, ramp, zipFrom } from './local-kit'

export const AU: Bbox = [112, -44.5, 154.5, -9], SA: Bbox = [129, -38.2, 141.1, -25.9], NSW: Bbox = [140.9, -37.6, 154, -28], MELB: Bbox = [144.88, -37.86, 145.0, -37.77]
const SAL = (() => {
  const a = 6378137, f = 1 / 298.257222101, e = Math.sqrt(2 * f - f * f), r = Math.PI / 180
  const m = (p: number) => Math.cos(p) / Math.sqrt(1 - (e * Math.sin(p)) ** 2)
  const t = (p: number) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2)
  const p1 = -28 * r, p2 = -36 * r, n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2))), F = m(p1) / (n * t(p1) ** n), r0 = a * F * t(-32 * r) ** n
  return ([x, y]: number[]) => {
    const dx = x - 1e6, dy = r0 - (y - 2e6), s = Math.sign(n), tt = (s * Math.hypot(dx, dy) / (a * F)) ** (1 / n)
    let p = Math.PI / 2 - 2 * Math.atan(tt)
    for (let i = 0; i < 6; i++) p = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2))
    return [Math.atan2(s * dx, s * dy) / n / r + 135, p / r]
  }
})()


// --- Australia: ABS estimated resident population by SA2 (2021 areas), with age, joined to the ASGS boundaries in view.
async function absSA2(cell: Bbox) {
  const b = await arcgis('https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA2/MapServer/1', `${env(cell)}&outFields=sa2_code_2021,sa2_name_2021,sa3_name_2021,state_name_2021,area_albers_sqkm&maxAllowableOffset=0.0005&geometryPrecision=5`)
  const codes = b.map(f => f.properties.sa2_code_2021).filter(c => /^\d{9}$/.test(c))
  if (!codes.length) return []
  const by: Record<string, Record<string, number>> = {}
  let year = ''
  for (let i = 0; i < codes.length; i += 120) {   // keep the URL short
    const r = await fetch(`https://data.api.abs.gov.au/rest/data/ABS,ERP_ASGS2021,1.0.0/ERP.3..SA2.${codes.slice(i, i + 120).join('+')}.A?startPeriod=${new Date().getFullYear() - 2}&format=csvfile`)
    if (!r.ok) throw new Error(`ABS Data API answered ${r.status}`)
    const [head, ...rows] = (await r.text()).trim().split(/\r?\n/).map(l => l.split(','))
    const k = (n: string) => head.indexOf(n)
    for (const x of rows) {   // keep the latest year per area and age
      const t = x[k('TIME_PERIOD')], a = (by[x[k('ASGS_2021')]] ||= {}), key = x[k('AGE')]
      if (!a['y:' + key] || t > String(a['y:' + key])) { a[key] = +x[k('OBS_VALUE')]; a['y:' + key] = +t }
      if (t > year) year = t
    }
  }
  const kids = ['A04', 'A59', 'A10'], old = ['A65', 'A70', 'A75', 'A80', '8599']
  return b.map(f => {
    const p = f.properties, a = by[p.sa2_code_2021] || {}, tot = a.TOT
    const sum = (ks: string[]) => ks.reduce((s, k2) => s + (a[k2] || 0), 0)
    return { ...f, properties: { ...p, pop: tot ?? null, year: a['y:TOT'] ?? year, density: tot != null && p.area_albers_sqkm > 0 ? tot / p.area_albers_sqkm : null,
      kids: tot ? (100 * sum(kids)) / tot : null, old: tot ? (100 * sum(old)) / tot : null } }
  })
}
export const DENSITY_STOPS = [0, 100, 1000, 3000, 8000]

// AEMO NEM summary for the city card: price and demand in the NEM region the map centre is in (5-minute data, cached 5 min).
export const aemo = () => once('aemo-' + Math.floor(Date.now() / 300e3), () => json('https://visualisations.aemo.com.au/aemo/apps/api/report/ELEC_NEM_SUMMARY'))
export const auState = (c: number[]) => once(`au-state-${c.map(x => x.toFixed(2))}`, async () =>
  (await json(`https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/STE/MapServer/0/query?geometry=${c[0]},${c[1]}&geometryType=esriGeometryPoint&inSR=4326&returnGeometry=false&outFields=state_code_2021,state_name_2021&f=json`)).features?.[0]?.attributes)
export const NEM_REGION: Record<string, string> = { 1: 'NSW1', 8: 'NSW1', 2: 'VIC1', 3: 'QLD1', 4: 'SA1', 6: 'TAS1' }
const OUTBACK: Record<number, [string, string]> = { 2: ['Open with warnings', OI.yellow], 3: ['4WD or high vehicles only', OI.orange], 4: ['4WD only', OI.orange], 5: ['Closed', OI.red] }
const RFS: Record<string, string> = { 'Emergency Warning': OI.red, 'Watch and Act': OI.orange, Advice: OI.yellow }
export const AADT_STOPS = [0, 2000, 8000, 25000, 60000]

export const AU_LAYERS: Local[] = [
  { id: 'L-ga-quake', view: 'hazards', cat: 'quakes', area: AU, minzoom: 2, what: 'earthquakes in Australia in the last 7 days (Geoscience Australia)',
    name: 'Geoscience Australia, Earthquakes@GA', href: 'https://earthquakes.ga.gov.au', licence: 'CC BY 4.0',
    load: async () => fc((await json('https://earthquakes.ga.gov.au/geoserver/earthquakes/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=earthquakes:earthquakes_seven_days&outputFormat=application/json')).features
      .filter((f: any) => f.properties.display_flag === 'Y' && f.properties.located_in_australia === 'Y')
      .map((f: any) => ({ ...f, properties: { mag: Math.round(f.properties.preferred_magnitude * 10) / 10, magType: f.properties.preferred_magnitude_type, place: f.properties.description,
        time: f.properties.origin_time, depth: f.properties.depth, felt: f.properties.felt_reports_count, id: f.properties.event_id } }))),
    layers: d => [circle('L-ga-quake', magColor(d), magRadius, d), icon('L-ga-quake-icon', 'i-pulse', 0.2, '#fff', { filter: ['>=', ['get', 'mag'], 3] })],
    legend: d => [{ label: 'Earthquake in Australia, from M1 (GA)', color: I(d)[0], shape: 'dot' }],
    pick: p => ({ title: `M${p.mag} ${p.place}`, href: `https://earthquakes.ga.gov.au/event/${p.id}`,
      rows: [['Magnitude', `${p.mag}${p.magType ? ` (${p.magType})` : ''}`], ['When', fmt(p.time)], ['Depth', `${nf.format(p.depth)} km`], ...has('Felt reports', p.felt)] }) },
  { id: 'L-dea-hot', view: 'hazards', cat: 'fire', area: AU, minzoom: 6, cell: 2, what: 'satellite fire hotspots, last 3 days (DEA Hotspots)',
    name: 'Digital Earth Australia Hotspots (Geoscience Australia)', href: 'https://hotspots.dea.ga.gov.au', licence: 'CC BY 4.0. Not for safety-of-life decisions',
    load: async c => fc((await json(`https://hotspots.dea.ga.gov.au/geoserver/public/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=public:hotspots_three_days&count=5000&outputFormat=application/json&bbox=${c![1]},${c![0]},${c![3]},${c![2]},urn:ogc:def:crs:EPSG::4326`)).features
      .map((f: any) => ({ ...f, properties: { id: f.properties.id, sat: f.properties.satellite, sensor: f.properties.sensor, time: f.properties.datetime, conf: f.properties.confidence, power: f.properties.power, k: f.properties.temp_kelvin, h: f.properties.hours_since_hotspot } }))),
    layers: d => [circle('L-dea-hot', ['step', ['get', 'h'], OI.red, 12, OI.orange, 36, d ? '#8a6b2f' : '#c9a66b'], ['interpolate', ['linear'], ['zoom'], 6, 2, 12, 5], d, { layout: { 'circle-sort-key': ['-', 0, ['get', 'h']] } })],
    legend: () => [{ label: 'Fire hotspot, last 12 h (red) to 3 days (DEA)', color: OI.red, shape: 'dot' }],
    pick: p => ({ title: 'Satellite fire hotspot', rows: [['Seen', fmt(p.time)], ['Satellite', `${p.sat}, ${p.sensor}`], ['Confidence', `${p.conf}%`], ...has('Fire power', p.power != null ? `${p.power} MW` : null), ...has('Temperature', p.k != null ? `${Math.round(p.k)} K` : null)] }) },
  { id: 'L-rfs', view: 'hazards', cat: 'fire', area: NSW, minzoom: 4, what: 'NSW Rural Fire Service incidents',
    name: 'NSW Rural Fire Service, major incidents', href: 'https://www.rfs.nsw.gov.au/news-and-media/stay-up-to-date/feeds', licence: 'CC BY 4.0, © State of New South Wales (NSW Rural Fire Service)',
    load: async () => fc((await json('https://www.rfs.nsw.gov.au/feeds/majorIncidents.json')).features.flatMap((f: any) => {
      const p = f.properties, d: Record<string, string> = {}
      for (const part of String(p.description || '').split(/<br\s*\/?>/i)) { const [k, ...v] = part.split(':'); if (v.length) d[k.trim()] = v.join(':').trim() }
      const props = { title: p.title, cat: p.category, link: p.link, status: d.STATUS, type: d.TYPE, size: d.SIZE, council: d['COUNCIL AREA'], updated: d.UPDATED, agency: d['RESPONSIBLE AGENCY'] }
      const gs = f.geometry?.type === 'GeometryCollection' ? f.geometry.geometries : [f.geometry]
      return gs.filter(Boolean).map((g: any) => ({ geometry: g, properties: props }))
    })),
    layers: d => [fill('L-rfs-area', OI.red, 0.25, { filter: ['==', ['geometry-type'], 'Polygon'] }),
      circle('L-rfs', ['match', ['get', 'cat'], ...Object.entries(RFS).flat(), d ? '#d8dedb' : '#5b625f'], 8, d, { filter: ['==', ['geometry-type'], 'Point'] }),
      icon('L-rfs-icon', 'i-fire', 0.2, '#fff', { filter: ['==', ['geometry-type'], 'Point'] })],
    legend: d => [...Object.entries(RFS).map(([k, c]) => ({ label: `NSW RFS: ${k}`, color: c, shape: 'dot' as const })), { label: 'NSW RFS: other incident', color: d ? '#d8dedb' : '#5b625f', shape: 'dot' as const }],
    pick: p => ({ title: p.title, href: p.link, rows: [['Alert level', p.cat], ...has('Status', p.status), ...has('Type', p.type), ...has('Size', p.size), ...has('Council area', p.council), ...has('Agency', p.agency), ...has('Updated', p.updated)] }) },
  { id: 'L-sa-inc', view: 'hazards', cat: 'roads', area: SA, minzoom: 4, what: 'road incidents in South Australia (DIT)',
    name: 'SA Department for Infrastructure and Transport, Traffic SA incidents', href: 'https://data.sa.gov.au/data/dataset/8d75dfcc-cc95-4be3-8747-ff273e8c53db', licence: 'CC BY 4.0',
    load: () => arcgis('https://dit-cms-prod.geohub.sa.gov.au/arcgis/rest/services/TrafficSATime_OpenData/TrafficSATime_OpenData/MapServer/0', 'where=1%3D1&outFields=*&outSR=4326'),
    layers: d => [circle('L-sa-inc', OI.red, 8, d), icon('L-sa-inc-icon', 'i-warning', 0.2)],
    legend: () => [{ label: 'Road incident (SA)', color: OI.red, shape: 'dot' }],
    pick: p => ({ title: p.description || 'Road incident', rows: [['Road', [p.local_road, p.side_street].filter(Boolean).join(' at ')], ...has('Suburb', p.suburb), ['Since', p.start_date_string || fmt(p.start_date)], ...has('Until', p.end_date_string), ...has('Lanes closed', p.no_lanes_closed)] }) },
  { id: 'L-sa-closed', view: 'hazards', cat: 'roads', area: SA, minzoom: 4, what: 'road closures and detours in South Australia (DIT)',
    name: 'SA DIT, road closures and detours', href: 'https://data.sa.gov.au/data/dataset/8d75dfcc-cc95-4be3-8747-ff273e8c53db', licence: 'CC BY 4.0',
    load: () => arcgis('https://dit-cms-prod.geohub.sa.gov.au/arcgis/rest/services/TrafficSATime_OpenData/TrafficSATime_OpenData/MapServer/2', 'where=1%3D1&outFields=*&outSR=4326'),
    layers: () => [{ ...line('L-sa-closed', ['match', ['get', 'plot_type'], 'RD_CLOSURE', OI.red, OI.pink], ['interpolate', ['linear'], ['zoom'], 6, 2, 14, 5]), layout: {} }],
    legend: () => [{ label: 'Road closed (red) or detour (pink), SA', color: OI.red, shape: 'line' }],
    pick: p => ({ title: p.local_road_name ? `${p.local_road_name}` : 'Road closure', href: p.plot_hyperlink || undefined,
      rows: [['Kind', p.plot_type === 'RD_CLOSURE' ? 'Road closed' : String(p.plot_type || 'Detour').replace(/_/g, ' ').toLowerCase()], ...has('From', p.start_side_street_name1), ...has('Suburb', p.start_suburb),
        ...has('Details', String(p.plot_details || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280))] }) },
  { id: 'L-sa-outback', view: 'hazards', cat: 'roads', area: SA, minzoom: 4, what: 'outback road sections with warnings or closed (SA)',
    name: 'SA DIT, outback road warnings', href: 'https://data.sa.gov.au/data/dataset/f87c3fe7-e175-4538-a4cb-78521bc02eec', licence: 'CC BY 4.0',
    load: () => arcgis('https://maps.sa.gov.au/arcgis/rest/services/DPTIExtTransport/FNRR2/MapServer/0', 'where=1%3D1&outFields=ROAD_SECTION,CODE,DESCRIPTION,AREA_NAME,COMMENTS&outSR=4326&maxAllowableOffset=0.002&geometryPrecision=4'),
    layers: () => [line('L-sa-outback', ['match', ['get', 'CODE'], ...Object.entries(OUTBACK).flatMap(([k, [, c]]) => [+k, c]), OI.yellow], ['interpolate', ['linear'], ['zoom'], 4, 1.5, 10, 4])],
    legend: () => Object.values(OUTBACK).filter((x, i, a) => a.findIndex(y => y[1] === x[1]) === i).map(([l, c]) => ({ label: `Outback road: ${l.toLowerCase()}`, color: c, shape: 'line' as const })),
    pick: p => ({ title: p.ROAD_SECTION, rows: [['Status', p.DESCRIPTION], ...has('Area', p.AREA_NAME), ...has('Comments', p.COMMENTS)] }) },
  { id: 'L-sa-works', view: 'hazards', cat: 'roads', area: SA, minzoom: 8, cell: 1, what: 'roadworks on now in South Australia (Traffic SA)',
    name: 'SA DIT, Traffic SA roadworks', href: 'https://data.sa.gov.au/data/dataset/8d75dfcc-cc95-4be3-8747-ff273e8c53db', licence: 'CC BY 4.0',
    load: async c => (await arcgis('https://maps.sa.gov.au/arcgis/rest/services/DPTIExtTransport/TrafficSAOpenData/MapServer/0', `${env(c!)}&where=REC_TYPE%3C%3E'INCIDENT'&outFields=REC_TYPE,DESCRIPTION,START_DATE,END_DATE,LOCAL_ROAD,SIDE_STREET,SUBURB,START_DATE_STRING,END_DATE_STRING,TRAFFIC_DIR,NO_LANES_CLOSED,SPEED_LIMIT,ESRI_OID`))
      .map(f => ({ ...f, id: f.properties.ESRI_OID }))
      .filter(f => f.properties.START_DATE <= Date.now() && (f.properties.END_DATE == null || f.properties.END_DATE >= Date.now())),   // on now; the feed also lists planned works
    layers: d => [circle('L-sa-works', OI.yellow, ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 8], d), icon('L-sa-works-icon', 'i-cone', 0.17, '#1d2120', { minzoom: 11 })],
    legend: () => [{ label: 'Roadworks on now (SA)', color: OI.yellow, shape: 'dot' }],
    pick: p => ({ title: p.DESCRIPTION || 'Roadworks', rows: [['Road', [p.LOCAL_ROAD, p.SIDE_STREET].filter(Boolean).join(' at ')], ...has('Suburb', p.SUBURB), ['From', p.START_DATE_STRING], ...has('Until', p.END_DATE_STRING),
      ...has('Lanes', p.NO_LANES_CLOSED), ...has('Speed limit', p.SPEED_LIMIT ? `${p.SPEED_LIMIT} km/h` : null), ['Kind', String(p.REC_TYPE).toLowerCase()]] }) },
  { id: 'L-melb', view: 'height', area: MELB, minzoom: 14, cell: 0.01, dedupe: true, what: 'City of Melbourne footprints with a measured height',
    name: 'City of Melbourne, 2023 building footprints', href: 'https://data.melbourne.vic.gov.au/explore/dataset/2023-building-footprints/', licence: 'CC BY 4.0',
    load: async c => fc((await json(`https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/2023-building-footprints/exports/geojson?where=${encodeURIComponent(`in_bbox(geo_point_2d,${c![1]},${c![0]},${c![3]},${c![2]}) and footprint_type="Structure"`)}&select=objectid,geo_shape,roof_type,footprint_max_elevation,footprint_min_elevation,structure_min_elevation,structure_extrusion,date_captured&limit=-1`)).features
      .map((f: any) => { const p = f.properties, g = p.structure_min_elevation
        return { ...f, id: +p.objectid, properties: { height: p.footprint_max_elevation - g, min_height: Math.max(0, p.footprint_min_elevation - g), building: p.structure_extrusion, roof: p.roof_type, captured: p.date_captured } } })),
    layers: d => [heights('L-melb', d)],
    pick: p => ({ title: 'Building (City of Melbourne)', rows: [['Height of this part', `${Math.round(p.height)} m`], ...has('Whole building', p.building != null ? `${Math.round(p.building)} m` : null), ...has('Starts at', p.min_height > 0 ? `${Math.round(p.min_height)} m` : null), ...has('Roof', p.roof),
      ...has('Captured', p.captured ? `${p.captured.slice(0, 4)}-${p.captured.slice(4, 6)}` : null)] }) },
  { id: 'L-abs-sa2', view: 'people', area: AU, minzoom: 9, cell: 0.5, what: 'ABS SA2 areas',
    name: 'Australian Bureau of Statistics, estimated resident population by SA2 (Data API) and ASGS 2021 boundaries', href: 'https://www.abs.gov.au/statistics/people/population/regional-population', licence: 'CC BY 4.0',
    load: async c => (await absSA2(c!)).map(f => ({ ...f, id: +f.properties.sa2_code_2021 })),
    layers: d => [fill('L-abs-sa2', ['case', ['!=', ['get', 'density'], null], ramp(['get', 'density'], DENSITY_STOPS, RAMPS.cividis[d ? 'dark' : 'light']), d ? '#2f3432' : '#e4e6e3'], 0.8),
      line('L-abs-sa2-line', d ? '#1d2120' : '#fbfcfa', 0.6)],
    pick: p => ({ title: `${p.sa2_name_2021} (SA2)`, rows: [['People', p.pop != null ? nf.format(p.pop) : 'Not published'], ['Per km²', p.density != null ? nf.format(p.density) : 'None'],
      ['Aged 0 to 14', p.kids != null ? `${nf.format(p.kids)}%` : 'None'], ['Aged 65 and over', p.old != null ? `${nf.format(p.old)}%` : 'None'], ['Area', `${nf.format(p.area_albers_sqkm)} km²`], ['Year', String(p.year || 'None')], ['Part of', `${p.sa3_name_2021}, ${p.state_name_2021}`]] }) },
  { id: 'L-sa-school', view: 'people', area: SA, minzoom: 8, what: 'SA government schools',
    name: 'SA Department for Education, enrolments by school', href: 'https://data.sa.gov.au/data/dataset/d385385a-6d79-4ef7-ab0f-0cfc583469f6', licence: 'CC BY 4.0',
    load: async () => {
      const r = await fetch('https://data.sa.gov.au/data/dataset/d385385a-6d79-4ef7-ab0f-0cfc583469f6/resource/7223f681-d340-4fc9-b92b-403d158f521f/download/sa-governament-enrolments-by-school.csv')
      if (!r.ok) throw new Error(`data.sa.gov.au answered ${r.status}`)
      const [head, ...rows] = (await r.text()).replace(/^﻿/, '').trim().split(/\r?\n/).map(l => l.split(','))   // no quoted commas in this file
      const years = head.filter(h => /^\d{4}$/.test(h))
      return rows.map(x => { const o = Object.fromEntries(head.map((h, i) => [h, x[i]])), y = [...years].reverse().find(k => o[k])
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [+o.Longitude, +o.Latitude] }, properties: { name: o.School_Name, kind: o.School_Type, suburb: o.Suburb, n: y ? +o[y] : null, year: y, old: y !== years.at(-1), first: o[years.find(k => o[k])!], firstYear: years.find(k => o[k]) } } })
        .filter(f => f.properties.n != null && Number.isFinite(f.geometry.coordinates[0]))
    },
    layers: d => [circle('L-sa-school', ['case', ['get', 'old'], d ? '#5b625f' : '#b4b9b6', OI.blue], ['interpolate', ['linear'], ['sqrt', ['get', 'n']], 0, 3, 40, 14], d), icon('L-sa-school-icon', 'i-school', 0.15, '#fff', { minzoom: 12 })],
    legend: d => [{ label: 'Government school, sized by enrolments (SA)', color: OI.blue, shape: 'dot' }, { label: 'School with no recent enrolment figure (SA)', color: d ? '#5b625f' : '#b4b9b6', shape: 'dot' }],
    pick: p => ({ title: p.name, rows: [[p.old ? 'Last enrolment figure' : 'Pupils', `${nf.format(p.n)} (${p.year})`], ...has(`In ${p.firstYear}`, p.first ? nf.format(+p.first) : null), ['Kind', p.kind], ['Suburb', p.suburb]] }) },
  { id: 'L-sa-aadt', view: 'traffic', cat: 'volume', area: SA, minzoom: 5, what: 'road sections with a traffic estimate (SA)',
    name: 'SA DIT, traffic volume estimates (AADT) 2026', href: 'https://data.sa.gov.au/data/dataset/e5d6588a-f163-4f6a-bc57-25e95c87b5bd', licence: 'CC BY 4.0',
    load: async () => {
      const [z] = await zipFrom('https://data.sa.gov.au/data/dataset/e5d6588a-f163-4f6a-bc57-25e95c87b5bd/resource/f6800eea-b0c2-45d9-a010-ba7cc22b0ee7/download/trafficvolumeestimates2026_geojson.zip', n => n.endsWith('.geojson'))
      const d = JSON.parse(z.text), proj = (g: any): any => (typeof g[0] === 'number' ? SAL(g).map(v => Math.round(v * 1e6) / 1e6) : g.map(proj))   // the file is in EPSG:3107
      return d.features.map((f: any) => ({ type: 'Feature', geometry: { type: f.geometry.type, coordinates: proj(f.geometry.coordinates) }, properties: { v: f.properties.TESECN_VOLUME,
        cv: f.properties.CV_PERCENT, ncv: f.properties.NUMBER_CVS, road: f.properties.ROAD_NO, base: f.properties.TESECN_BASE_YEAR, proj: f.properties.TESECN_PROJECTED_YEAR } })).filter((f: any) => f.properties.v != null)
    },
    layers: d => [{ ...line('L-sa-aadt', ramp(['get', 'v'], AADT_STOPS, RAMPS.viridis[d ? 'dark' : 'light'])), layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'v'] },
      paint: { 'line-color': ramp(['get', 'v'], AADT_STOPS, RAMPS.viridis[d ? 'dark' : 'light']), 'line-width': ['interpolate', ['linear'], ['zoom'], 6, ['interpolate', ['linear'], ['get', 'v'], 0, 1, 80000, 4], 14, ['interpolate', ['linear'], ['get', 'v'], 0, 3, 80000, 12]] } }],
    pick: p => ({ title: `Road ${p.road}`, rows: [['Vehicles per day', nf.format(p.v)], ...has('Heavy vehicles', p.cv != null ? `${p.cv}% (${nf.format(p.ncv)} a day)` : null), ['Counted', String(p.base)], ['Estimated for', String(p.proj)]] }) },
  { id: 'L-sa-crash', view: 'traffic', cat: 'crashes', area: SA, minzoom: 12, what: 'crash locations, 2020 to 2024',
    name: 'SA DIT, road crash locations 2020 to 2024', href: 'https://data.sa.gov.au/data/dataset/cf8d8549-b976-4523-88ad-46dd32053696', licence: 'CC BY 3.0 AU (per the file\'s licence note)',
    load: async () => {
      const [z] = await zipFrom('https://data.sa.gov.au/data/dataset/cf8d8549-b976-4523-88ad-46dd32053696/resource/5fcbce14-ad30-4737-aa7d-5b1cfb939eb9/download/roadcrashes_2020_2024_geojson.zip', n => /GDA2020\.geojson$/.test(n))
      return JSON.parse(z.text).features.map((f: any) => { const p = f.properties
        return { type: 'Feature', geometry: f.geometry, properties: { n: p.total_crashes, fat: p.cse_fat, si: p.cse_si, inj: p.cse_inj, pdo: p.cse_pdo, killed: p.total_fatalities, hurt: p.total_serious_injuries,
          sev: p.cse_fat ? 3 : p.cse_si ? 2 : p.cse_inj ? 1 : 0, ped: p.uty_pedestrian, bike: p.uty_bicycle, night: p.lco_night } } })
    },
    layers: d => [circle('L-sa-crash', ['match', ['get', 'sev'], 3, I(d)[0], 2, I(d)[1], 1, I(d)[2], I(d)[3]], ['interpolate', ['linear'], ['zoom'], 12, ['min', ['+', 2, ['get', 'n']], 6], 16, ['min', ['+', 3, ['*', 1.5, ['get', 'n']]], 14]], d,
      { layout: { 'circle-sort-key': ['get', 'sev'] } })],
    legend: d => [['Fatal', 0], ['Serious injury', 1], ['Minor injury', 2], ['Property damage only', 3]].map(([l, i]) => ({ label: `Crash: ${String(l).toLowerCase()}`, color: I(d)[i as number], shape: 'dot' as const })),
    pick: p => ({ title: `${p.n} crash${p.n > 1 ? 'es' : ''} here, 2020 to 2024`, rows: [['Fatal crashes', String(p.fat)], ['Serious injury', String(p.si)], ['Minor injury', String(p.inj)], ['Property damage only', String(p.pdo)],
      ['People killed', String(p.killed)], ['Seriously injured', String(p.hurt)], ...has('Involving pedestrians', p.ped || null), ...has('Involving cyclists', p.bike || null), ...has('At night', p.night || null)] }) },
]
