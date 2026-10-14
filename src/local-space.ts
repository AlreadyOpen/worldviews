// Space around the Earth (Helen 2026-10-14, option S3): NOAA SWPC's aurora forecast as a layer of What is overhead?, and space
// weather (Kp, solar wind, the latest X-ray flare, alerts) for the answer, the city meter and the news feed. All keyless,
// CORS-open (probed 2026-10-14) and public domain (US Government), so both editions carry them.
import { json, once } from './data'
import { type Bbox, type Local, nf } from './local-kit'

const SWPC = 'https://services.swpc.noaa.gov'
const WORLD: Bbox = [-180, -90, 180, 90]
export const AURORA_MIN = 10   // per cent chance: below this a cell is left out (the grid holds 65,160 cells)
let forecastAt = ''

// Kp (3-hourly planetary index), solar wind speed, the latest flare: small files, fetched once per visit
export const spaceWeather = () => once('swpc', async () => {
  const [kp, wind, flare] = await Promise.all([json(`${SWPC}/products/noaa-planetary-k-index.json`), json(`${SWPC}/products/summary/solar-wind-speed.json`),
    json(`${SWPC}/json/goes/primary/xray-flares-latest.json`).catch(() => [])])
  const k = kp.at(-1), f = flare[0]
  return { kp: +k.Kp, kpAt: k.time_tag as string, wind: wind[0]?.proton_speed as number | undefined, flare: f?.max_class || f?.current_class as string | undefined }
})
export const kpWord = (kp: number) => kp >= 9 ? 'extreme storm (G5)' : kp >= 8 ? 'severe storm (G4)' : kp >= 7 ? 'strong storm (G3)' : kp >= 6 ? 'moderate storm (G2)' : kp >= 5 ? 'minor storm (G1)' : kp >= 4 ? 'active' : 'quiet'

// NOAA's alerts, watches and warnings, newest first, as one line each for the news feed
export const swpcAlerts = () => once('swpc-alerts', async () => (await json(`${SWPC}/products/alerts.json`) as any[]).map(a => {
  const head = String(a.message).split(/\r?\n/).find(l => /^(ALERT|WARNING|WATCH|SUMMARY|CANCEL)/.test(l.trim()))?.trim()
  return head && { id: a.product_id + a.issue_datetime, text: head.replace(/\s+/g, ' '), t: Date.parse(a.issue_datetime.replace(' ', 'T') + 'Z') }
}).filter(Boolean) as { id: string; text: string; t: number }[])

export const SPACE_LAYERS: Local[] = [
  { id: 'L-aurora', view: 'satellites', area: WORLD, minzoom: 0, what: `aurora forecast cells with a ${AURORA_MIN}%+ chance (NOAA OVATION)`,
    name: 'NOAA Space Weather Prediction Center, OVATION aurora forecast', href: 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast', licence: 'Public domain (US Government)',
    load: async () => {
      const d = await json(`${SWPC}/json/ovation_aurora_latest.json`)
      forecastAt = d['Forecast Time'] || ''
      return (d.coordinates as number[][]).filter(c => c[2] >= AURORA_MIN).map(([lon, lat, p]) => ({ type: 'Feature', properties: { p },
        geometry: { type: 'Point', coordinates: [lon > 180 ? lon - 360 : lon, lat] } }))
    },
    // soft blurred circles, not a heatmap: MapLibre's heatmap drew nothing on the globe (checked 2026-10-14, 6.13)
    layers: () => [{ id: 'L-aurora', type: 'circle', paint: {
      'circle-color': ['interpolate', ['linear'], ['get', 'p'], 10, '#1f9c5a', 40, '#46f08c', 80, '#d6ffe4'],
      'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, 3, 3, 10, 6, 70], 'circle-blur': 1,
      'circle-opacity': ['interpolate', ['linear'], ['get', 'p'], 10, 0.25, 60, 0.7], 'circle-pitch-alignment': 'map' } }],
    legend: () => [{ label: `Aurora chance, ${AURORA_MIN}% to 100% (NOAA OVATION)`, color: '#46f08c', shape: 'dot' }],
    summary: all => `Aurora: ${nf.format(all.length)} cells with a ${AURORA_MIN}%+ chance${forecastAt ? `, forecast for ${forecastAt.slice(11, 16)} UTC` : ''}`,
    pick: p => ({ title: 'Aurora forecast', rows: [['Chance of aurora', `${p.p}%`]] }) },
]
