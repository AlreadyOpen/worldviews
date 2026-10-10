// Taiwan: Central Weather Administration open data (public S3) and MOI household registration (ris.gov.tw).
import { json } from './data'
import { RAMPS } from './views'
import { type Bbox, type Local, OI, I, circle, fmt, has, icon, magColor, magRadius, nf, ramp, zipFrom } from './local-kit'

export const TW: Bbox = [118, 21.8, 122.2, 26.4]
// --- Taiwan: county centres (CWA warnings and the ages view are published per county; no open county outlines load in a browser).
// ponytail: a hand-made centre per county; swap in county polygons when a pipeline bakes NLSC boundaries.
export const TW_COUNTY: Record<string, [string, number, number]> = {
  臺北市: ['Taipei City', 121.56, 25.06], 新北市: ['New Taipei City', 121.64, 24.98], 桃園市: ['Taoyuan City', 121.22, 24.93], 臺中市: ['Taichung City', 120.86, 24.2],
  臺南市: ['Tainan City', 120.31, 23.14], 高雄市: ['Kaohsiung City', 120.58, 22.98], 基隆市: ['Keelung City', 121.72, 25.12], 新竹市: ['Hsinchu City', 120.96, 24.8],
  新竹縣: ['Hsinchu County', 121.17, 24.69], 苗栗縣: ['Miaoli County', 120.94, 24.49], 彰化縣: ['Changhua County', 120.47, 23.99], 南投縣: ['Nantou County', 120.97, 23.84],
  雲林縣: ['Yunlin County', 120.39, 23.7], 嘉義市: ['Chiayi City', 120.45, 23.48], 嘉義縣: ['Chiayi County', 120.58, 23.44], 屏東縣: ['Pingtung County', 120.62, 22.55],
  宜蘭縣: ['Yilan County', 121.62, 24.6], 花蓮縣: ['Hualien County', 121.4, 23.75], 臺東縣: ['Taitung County', 121.1, 22.9], 澎湖縣: ['Penghu County', 119.58, 23.57],
  金門縣: ['Kinmen County', 118.35, 24.44], 連江縣: ['Lienchiang County', 119.95, 26.16],
}
const twCounty = (s: string) => TW_COUNTY[String(s).replace(/台/g, '臺').slice(0, 3)]
const TW_HAZARD: Record<string, string> = { 陸上強風: 'Strong wind on land', 大雨: 'Heavy rain', 豪雨: 'Extremely heavy rain', 大豪雨: 'Torrential rain', 超大豪雨: 'Extremely torrential rain',
  濃霧: 'Dense fog', 低溫: 'Low temperature', 颱風: 'Typhoon', 高溫: 'High temperature', 海上颱風: 'Typhoon at sea', 陸上颱風: 'Typhoon on land' }
const CWA = 'https://cwaopendata.s3.ap-northeast-1.amazonaws.com'
const OGDL = 'Open Government Data License, version 1.0 (data.gov.tw/license)'
// Taiwan household registration (MOI ris.gov.tw), every village; the latest month (or year) that is out.
async function ris(id: string, periods: string[]) {
  for (const per of periods) {
    const first = await json(`https://www.ris.gov.tw/rs-opendata/api/v1/datastore/${id}/${per}?page=1`)
    if (!first.responseData?.length) continue
    const rest = await Promise.all([...Array(Math.max(0, +first.totalPage - 1)).keys()].map(i => json(`https://www.ris.gov.tw/rs-opendata/api/v1/datastore/${id}/${per}?page=${i + 2}`)))
    return { per, rows: [first, ...rest].flatMap(d => d.responseData) }
  }
  throw new Error(`ris.gov.tw ${id}: no recent period`)
}
const rocMonths = () => [...Array(4).keys()].map(b => { const d = new Date(); d.setMonth(d.getMonth() - b - 1); return `${d.getFullYear() - 1911}${String(d.getMonth() + 1).padStart(2, '0')}` })

export const TW_LAYERS: Local[] = [
  { id: 'L-cwa-warn', view: 'hazards', cat: 'storms', area: TW, minzoom: 4, what: 'Taiwan counties under a weather warning (CWA)',
    name: 'Central Weather Administration (CWA), weather warnings by county', href: 'https://opendata.cwa.gov.tw', licence: OGDL,
    load: async () => {
      const d = (await json(`${CWA}/Warning/W-C0033-001.json`)).cwaopendata
      return d.dataset.location.flatMap((l: any) => {
        const hz = l.hazardConditions?.hazards, list = Array.isArray(hz) ? hz : hz ? [hz] : [], c = twCounty(l.locationName)
        if (!list.length || !c) return []
        const ph = list.map((h: any) => h.info.phenomena + h.info.significance)
        return [{ type: 'Feature', geometry: { type: 'Point', coordinates: [c[1], c[2]] }, properties: { county: c[0], zh: l.locationName, ph: ph.join('、'),
          en: list.map((h: any) => TW_HAZARD[h.info.phenomena] || h.info.phenomena).join(', '), from: list[0].validTime?.startTime, to: list[0].validTime?.endTime, sent: d.sent } }]
      })
    },
    layers: d => [circle('L-cwa-warn', OI.orange, 11, d), icon('L-cwa-warn-icon', 'i-warning', 0.22)],
    legend: () => [{ label: 'Taiwan county under a weather warning (CWA)', color: OI.orange, shape: 'dot' }],
    pick: p => ({ title: `${p.county} ${p.zh}`, href: 'https://www.cwa.gov.tw/V8/E/P/Warning/FIFOWS.html', rows: [['Warning', p.en], ['As issued', p.ph], ['From', fmt(p.from)], ['Until', fmt(p.to)], ['Issued', fmt(p.sent)]] }) },
  { id: 'L-cwa-quake', view: 'hazards', cat: 'quakes', area: TW, minzoom: 3, what: 'numbered CWA earthquake reports since July',
    name: 'CWA earthquake reports', href: 'https://scweb.cwa.gov.tw/en-us/earthquake/data', licence: OGDL,
    load: async () => (await zipFrom(`${CWA}/Earthquake/E-A0015-001.zip`, n => n.endsWith('.xml'))).map(({ text }) => {
      const g = (t: string) => text.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1]?.trim()
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [+g('EpicenterLongitude')!, +g('EpicenterLatitude')!] },
        properties: { mag: +g('MagnitudeValue')!, time: g('OriginTime'), depth: g('FocalDepth'), where: g('Location'), text: g('ReportContent'), web: g('Web'), no: g('EarthquakeNo') } }
    }).filter(f => Number.isFinite(f.geometry.coordinates[0])),
    layers: d => [circle('L-cwa-quake', magColor(d), magRadius, d), { id: 'L-cwa-quake-label', type: 'symbol', layout: { 'text-field': ['concat', 'M', ['to-string', ['get', 'mag']]], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.4] },
      paint: { 'text-color': d ? '#e6ebe8' : '#1d2120', 'text-halo-color': d ? '#151918' : '#fbfcfa', 'text-halo-width': 1.5 } }],
    legend: d => [{ label: 'Earthquake report, Taiwan (CWA, local magnitude)', color: I(d)[1], shape: 'dot' }],
    pick: p => ({ title: `M${p.mag} earthquake, CWA report ${p.no}`, href: p.web, rows: [['Magnitude (local)', String(p.mag)], ['When', fmt(p.time)], ['Depth', `${p.depth} km`], ...has('Where', p.where), ...has('Report', p.text)] }) },
  { id: 'L-cwa-obs', view: 'hazards', cat: 'weather', area: TW, minzoom: 9, what: 'CWA weather stations reporting',
    name: 'CWA automatic weather stations (temperature now)', href: 'https://opendata.cwa.gov.tw/dataset/observation/O-A0001-001', licence: OGDL,
    load: async () => (await json(`${CWA}/Observation/O-A0001-001.json`)).cwaopendata.dataset.Station.map((s: any) => {
      const w = s.GeoInfo.Coordinates.find((c: any) => c.CoordinateName === 'WGS84') || s.GeoInfo.Coordinates[0], e = s.WeatherElement
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [+w.StationLongitude, +w.StationLatitude] }, properties: { name: s.StationName, county: s.GeoInfo.CountyName, town: s.GeoInfo.TownName,
        t: +e.AirTemperature > -90 ? +e.AirTemperature : null, rain: +e.Now?.Precipitation >= 0 ? +e.Now.Precipitation : null, wind: +e.WindSpeed >= 0 ? +e.WindSpeed : null, rh: +e.RelativeHumidity >= 0 ? +e.RelativeHumidity : null,
        wx: e.Weather !== '-99' ? e.Weather : null, at: s.ObsTime.DateTime, alt: s.GeoInfo.StationAltitude } }
    }).filter((f: any) => f.properties.t != null),
    layers: d => [circle('L-cwa-obs', ramp(['get', 't'], [5, 15, 25, 33], I(d)), ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 6], d),
      { id: 'L-cwa-obs-label', type: 'symbol', minzoom: 10, layout: { 'text-field': ['concat', ['to-string', ['get', 't']], '°'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.2] },
        paint: { 'text-color': d ? '#e6ebe8' : '#1d2120', 'text-halo-color': d ? '#151918' : '#fbfcfa', 'text-halo-width': 1.5 } }],
    legend: d => [{ label: 'Weather station, Taiwan: dark 5 °C to bright 33 °C', color: I(d)[2], shape: 'dot' }],
    pick: p => ({ title: `${p.name} weather station`, rows: [['Temperature', `${p.t} °C`], ...has('Weather', p.wx), ...has('Rain today', p.rain != null ? `${p.rain} mm` : null), ...has('Wind', p.wind != null ? `${p.wind} m/s` : null),
      ...has('Humidity', p.rh != null ? `${p.rh}%` : null), ['Where', `${p.county} ${p.town}, ${p.alt} m`], ['Observed', fmt(p.at)]] }) },
  { id: 'L-tw-age', view: 'people', area: TW, minzoom: 5, what: 'Taiwan counties',
    name: 'Ministry of the Interior (Taiwan), village population by single year of age (ODRP014) and education (ODRP020)', href: 'https://www.ris.gov.tw/app/portal/346', licence: OGDL,
    load: async () => {
      const y = new Date().getFullYear() - 1911
      const [age, edu] = await Promise.all([ris('ODRP014', rocMonths()), ris('ODRP020', [String(y - 1), String(y - 2)]).catch(() => null)])
      const by: Record<string, any> = {}
      for (const r of age.rows) {
        const c = (by[String(r.site_id).replace(/台/g, '臺').slice(0, 3)] ||= { pop: 0, kids: 0, old: 0, ages: new Array(101).fill(0) })
        c.pop += +r.people_total
        for (const [k, v] of Object.entries(r)) if (k.startsWith('people_age_')) { const a = +k.slice(11, 14); c.ages[Math.min(a, 100)] += +(v as any) || 0 }
      }
      for (const r of edu?.rows || []) { const c = by[String(r.site_id).replace(/台/g, '臺').slice(0, 3)]; if (!c) continue
        c.adults = (c.adults || 0) + +r.edu_age_15up_total
        c.degree = (c.degree || 0) + Object.entries(r).filter(([k]) => /^edu_(doctor|master|university)_graduated_/.test(k)).reduce((s, [, v]) => s + (+(v as any) || 0), 0) }
      const median = (ages: number[]) => { const half = ages.reduce((a, b) => a + b, 0) / 2; let s = 0; for (let i = 0; i < ages.length; i++) if ((s += ages[i]) >= half) return i; return 100 }
      return Object.entries(by).filter(([k]) => TW_COUNTY[k]).map(([k, c]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [TW_COUNTY[k][1], TW_COUNTY[k][2]] },
        properties: { county: TW_COUNTY[k][0], zh: k, pop: c.pop, kids: (100 * c.ages.slice(0, 15).reduce((a: number, b: number) => a + b, 0)) / c.pop, old: (100 * c.ages.slice(65).reduce((a: number, b: number) => a + b, 0)) / c.pop,
          median: median(c.ages), degree: c.adults ? (100 * c.degree) / c.adults : null, month: `${+age.per.slice(0, 3) + 1911}-${age.per.slice(3)}`, eduYear: edu ? +edu.per + 1911 : null } }))
    },
    layers: d => [circle('L-tw-age', ramp(['get', 'old'], [14, 17, 20, 23, 26], RAMPS.cividis[d ? 'dark' : 'light']), ['interpolate', ['linear'], ['sqrt', ['get', 'pop']], 0, 6, 2000, 26], d),
      { id: 'L-tw-age-label', type: 'symbol', minzoom: 7, layout: { 'text-field': ['concat', ['get', 'county'], '\n', ['to-string', ['round', ['get', 'old']]], '% 65+'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 2.4] },
        paint: { 'text-color': d ? '#e6ebe8' : '#1d2120', 'text-halo-color': d ? '#151918' : '#fbfcfa', 'text-halo-width': 1.5 } }],
    summary: all => { const pop = all.reduce((x, f) => x + f.properties.pop, 0), w = (k: string) => all.reduce((x, f) => x + f.properties[k] * f.properties.pop, 0) / pop
      return `Taiwan, household registration ${all[0]?.properties.month}: ${nf.format(pop / 1e6)} million people, ${nf.format(w('kids'))}% aged 0 to 14, ${nf.format(w('old'))}% aged 65 and over. Click a county for its ages and education` },
    legend: d => [{ label: 'Taiwan county: colour = share aged 65+ (14% to 26%), size = people', color: RAMPS.cividis[d ? 'dark' : 'light'][3], shape: 'dot' }],
    pick: p => ({ title: `${p.county} ${p.zh}`, rows: [['People', nf.format(p.pop)], ['Aged 0 to 14', `${nf.format(p.kids)}%`], ['Aged 65 and over', `${nf.format(p.old)}%`], ['Median age', `${p.median}`],
      ...has(`University degree or higher, aged 15+ (${p.eduYear})`, p.degree != null ? `${nf.format(p.degree)}%` : null), ['Month', p.month]] }) },
]
