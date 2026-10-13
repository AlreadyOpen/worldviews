// Hong Kong: aircraft within 250 nm, from AlreadyOpen world-flights' 15-minute snapshot (adsb.lol, ODbL). Altitude is kept
// (alt_m, metres above the ellipsoid where the aircraft reports it, else barometric), so the 3D marks can fly them at height.
import { json } from './data'
import { type Bbox, type Local, circle, has, icon, nf, ramp } from './local-kit'
import { RAMPS } from './views'

export const FLIGHTS = 'https://huggingface.co/buckets/alreadyopen/world-flights/resolve'
const HK250: Bbox = [109.6, 17.8, 118.7, 26.8]
export const ALT_M_STOPS = [0, 1000, 3000, 7000, 12000]
let asOf = 0

export const HK_LAYERS: Local[] = [
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
