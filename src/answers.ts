// What each view answers right now, for the current camera: one number, what it counts, and the state behind it.
import * as D from './data'
import { LAYERS, type World } from './engine'
import { HEIGHT_STOPS, HK, INDICATORS_NOTE, MAG_STOPS, RAMPS, VIEWS, inHK, type ViewId } from './views'
import type { LegendSpec } from './legend'

export type Answer = {
  status: 'loading' | 'ok' | 'empty' | 'error' | 'outside' | 'zoom'
  value?: string; counts?: string; detail?: string
  updated?: string; stale?: boolean; errors?: string[]
  jump?: { label: string; center: [number, number]; zoom: number }
  legend?: LegendSpec
}

const nf = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
const big = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const time = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th')
const km = (a: number[], b: number[]) => {
  const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r), y = (b[1] - a[1]) * r
  return Math.round(Math.sqrt(x * x + y * y) * 6371)
}

export async function answer(w: World, v: ViewId): Promise<Answer> {
  const m = w.map, c = m.getCenter().toArray(), z = m.getZoom(), th = w.theme, b = m.getBounds()
  const inView = (p: number[]) => b.contains(p as any)
  if (v === 'height') {
    const sub = w.state.sub.height || 'all'
    const legend: LegendSpec = { kind: 'ramp', title: 'Height above ground', colors: RAMPS.viridis[th], ticks: HEIGHT_STOPS.map((h, i) => i === HEIGHT_STOPS.length - 1 ? `${h} m+` : `${h}`),
      note: z >= 14 ? 'Pale grey: no height in the data.' : 'Below street zoom, only buildings 30 m and taller are drawn.' }
    if (z < 5.5) return { status: 'zoom', legend, detail: 'Skylines draw from regional zoom. Every building with a height appears at street zoom.', jump: { label: 'Fly to Hong Kong', ...HK } }
    const layers = (w.state.views.includes('height') ? LAYERS.height : LAYERS.base).filter(id => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') === 'visible')
    const fs = layers.length ? m.queryRenderedFeatures({ layers }) : []
    const seen = new Map<string, any>()
    for (const f of fs) { const p: any = f.properties, k = String(f.id ?? p.id ?? JSON.stringify(f.geometry).slice(0, 80)); if (!seen.has(k)) seen.set(k, p) }
    const all = [...seen.values()].filter(p => p.height != null)
    if (!all.length) return { status: w.pending.size ? 'loading' : 'empty', legend,
      detail: sub === 'all' ? 'No buildings with a height in view. Most of the world has heights only in the bigger cities.' : `Nothing ${sub === 'super' ? '300 m' : '150 m'} or taller in view.`,
      jump: { label: 'Fly to Hong Kong', ...HK } }
    const top = all.reduce((a, p) => (p.height > a.height ? p : a))
    return { status: 'ok', legend, value: `${Math.round(top.height)} m`, counts: 'tallest in view',
      detail: `${top.name || top['names.primary'] || 'Unnamed building'}. ${nf.format(all.length)} ${sub === 'super' ? 'buildings 300 m and taller' : sub === 'tall' ? 'buildings 150 m and taller' : z < 14 ? 'buildings 30 m and taller' : 'buildings with a height'} drawn in view.` }
  }
  if (v === 'hazards') {
    const span = w.state.time === 't3' ? 'month' : 'day'
    const q = await D.quakes(span), g: D.Feed<any> = D.peek('gdacs') || {}, e: D.Feed<any> = D.peek('eonet') || {}
    const errors = [q.error && `USGS: ${q.error}`, g.error && `GDACS: ${g.error}`, e.error && `NASA EONET: ${e.error}`].filter(Boolean) as string[]
    const waiting = [!D.peek('gdacs') && 'GDACS alerts', !D.peek('eonet') && 'NASA EONET events'].filter(Boolean).join(' and ')
    const I = RAMPS.inferno[th]
    const legend: LegendSpec = { kind: 'items', title: 'Size and colour: how strong', items: [
      { label: 'Earthquake, M2.5 to M4', color: I[0], shape: 'dot' }, { label: 'Earthquake, M5.5+', color: I[2], shape: 'dot' },
      { label: 'GDACS alert, larger for orange and red', color: I[2], shape: 'dot' }, { label: 'Other NASA EONET event', color: th === 'dark' ? '#d8dedb' : '#2c3330', shape: 'ring' }],
      note: 'Labels mark M5 and stronger.' }
    if (!q.data) return { status: 'error', legend, errors }
    const cut = w.cutoff() || Infinity, sub = w.state.sub.hazards || 'all'
    const qs = q.data.features.filter((f: any) => f.properties.time <= cut)
    const here = qs.filter((f: any) => inView(f.geometry.coordinates))
    const alerts = (g.data?.features || []).filter((f: any) => inView(f.geometry.coordinates) && f.properties.alertlevel !== 'Green')
    const gen = q.data.metadata?.generated as number
    const base = { legend, errors, updated: `${gen ? `USGS feed ${time(gen)}` : ''}${waiting ? `. Still loading ${waiting}` : ''}`, stale: gen ? Date.now() - gen > 30 * 60e3 : false }
    const window = span === 'day' ? 'in the last 24 h' : 'in the last 30 days'
    if (z < 3) {
      const top = qs.reduce((a: any, f: any) => (!a || f.properties.mag > a.properties.mag ? f : a), null)
      const red = (g.data?.features || []).filter((f: any) => f.properties.alertlevel !== 'Green').length
      return { ...base, status: qs.length ? 'ok' : 'empty', value: nf.format(qs.length), counts: `earthquakes M2.5+ worldwide ${window}`,
        detail: `${top ? `Strongest: M${top.properties.mag}, ${top.properties.place}. ` : ''}${g.data ? `${red} GDACS orange or red alerts open. ` : ''}Zoom in to count a region.` }
    }
    if (sub !== 'all' && sub !== 'quakes') {
      const ev = [...(g.data?.features || []), ...(e.data?.features || [])].filter((f: any) =>
        inView(f.geometry.coordinates) && ((f.properties.eventtype && ({ TC: 'storms', FL: 'floods', DR: 'floods', WF: 'fire', VO: 'fire' } as any)[f.properties.eventtype] === sub) ||
          ({ severeStorms: 'storms', floods: 'floods', drought: 'floods', wildfires: 'fire', volcanoes: 'fire' } as any)[f.properties.categories?.[0]?.id] === sub))
      return ev.length ? { ...base, status: 'ok', value: nf.format(ev.length), counts: 'open events in view' }
        : { ...base, status: 'empty', detail: 'No open events of this kind in view. Zoom out to the world to see all of them.', jump: { label: 'Show the world', center: [60, 15], zoom: 1.4 } }
    }
    if (!here.length) {
      const top = qs.reduce((a: any, f: any) => (!a || f.properties.mag > a.properties.mag ? f : a), null)
      return { ...base, status: 'empty', value: '0', counts: `earthquakes M2.5+ in view ${window}`,
        detail: top ? `${nf.format(qs.length)} worldwide. The strongest is M${top.properties.mag}, ${top.properties.place}, ${nf.format(km(c, top.geometry.coordinates))} km from here.` : 'None worldwide either.',
        jump: top ? { label: `Go to the M${top.properties.mag}`, center: top.geometry.coordinates.slice(0, 2), zoom: 5 } : undefined }
    }
    const top = here.reduce((a: any, f: any) => (f.properties.mag > a.properties.mag ? f : a))
    return { ...base, status: 'ok', value: nf.format(here.length), counts: `earthquakes M2.5+ in view ${window}`,
      detail: `Strongest here: M${top.properties.mag}, ${top.properties.place}. ${nf.format(qs.length)} worldwide.${alerts.length ? ` ${alerts.length} GDACS orange or red alerts in view.` : ''}` }
  }
  if (v === 'transit') {
    const legend: LegendSpec = { kind: 'items', title: 'Lines', items: [
      { label: 'MTR line, in its own colour', color: '#00888e', shape: 'line' }, { label: 'MTR station', color: '#00888e', shape: 'ring' },
      { label: 'Bus and minibus route (darker where routes overlap)', color: th === 'dark' ? '#c9d1cd' : '#2c3330', shape: 'line' }] }
    if (!inHK(c)) return { status: 'outside', legend, detail: 'Transit is mapped for Hong Kong so far. Other cities need their GTFS feeds turned into pipelines first.', jump: { label: 'Go to Hong Kong', ...HK } }
    const mt = await D.mtr()
    if (!mt.data) return { status: 'error', legend, errors: [`hk-transit MTR: ${mt.error}`] }
    const stations = new Set<string>()
    for (const l of mt.data.lines) for (const s of l.stations) if (inView([s[4], s[5]])) stations.add(s[0])
    const updated = `hk-transit built ${mt.data.built.replace('T', ' ').slice(0, 16)}`
    if (z < 11) return { status: 'ok', legend, updated, value: String(new Set(mt.data.lines.map((l: any) => l.line)).size), counts: 'MTR lines', detail: 'Zoom in to see bus and minibus routes.' }
    if (!w.state.views.includes('transit')) return { status: 'ok', legend, updated, value: String(stations.size), counts: 'MTR stations in view', detail: 'Open this view to load bus routes.' }
    const routes = new Set(w.busLines.filter(f => f.geometry.coordinates.some(inView)).map(f => `${f.properties.op} ${f.properties.route}`))
    return { status: routes.size || stations.size ? 'ok' : w.pending.size ? 'loading' : 'empty', legend, updated, value: nf.format(routes.size), counts: 'bus and minibus routes in view',
      detail: `${stations.size} MTR stations in view.`, ...(routes.size || stations.size ? {} : { detail: 'No routes here. Try the harbour front.', jump: { label: 'Go to Central', ...HK } }) }
  }
  if (v === 'rules' && !(import.meta.env.PUBLIC_EDITION === 'full' && w.state.sub.rules === 'bg')) {
    const t = w.state.sub.rules || 'BEC', label = D.RISE_LABEL[t]
    const [cs, r] = await Promise.all([D.countries(), D.rise(t)])
    const legend: LegendSpec = { kind: 'ramp', title: `${label}, RISE score`, colors: RAMPS.viridis[th], ticks: ['0', '25', '50', '75', '100'],
      note: 'Grey: not covered by RISE (140 economies).' }
    if (!cs.data || !r.data) return { status: 'error', legend, errors: [cs.error && `Natural Earth: ${cs.error}`, r.error && `World Bank Data360: ${r.error}`].filter(Boolean) as string[] }
    const ranked = Object.entries(r.data.by).sort((a, b) => b[1].v - a[1].v)
    const latest = ranked.reduce((m, [, x]) => (x.year > m ? x.year : m), '')
    const updated = `World Bank RISE, scores to ${latest}`
    const name = (k: string) => cs.data.features.find((f: any) => f.properties.ISO3_CODE === k)?.properties.NAME_ENGL || k
    if (z < 3 && ranked.length) {
      const end = (w: string, v: number) => { const n = ranked.filter(([, y]) => y.v === v); return n.length > 1 ? `${w}: ${nf.format(v)}, shared by ${n.length} economies.` : `${w}: ${name(n[0][0])}, ${nf.format(v)}.` }
      const mean = (y: number) => { const xs = Object.values(r.data!.series).map(s => s.find(p => p[0] === y)?.[1]).filter(x => x != null) as number[]; return xs.reduce((a, b) => a + b, 0) / xs.length }
      return { status: 'ok', legend, updated, value: nf.format(mean(+latest)), counts: `of 100, average of ${ranked.length} economies (${latest})`,
        detail: `${nf.format(mean(2010))} in 2010. ${end('Highest', ranked[0][1].v)} ${end('Lowest', ranked.at(-1)![1].v)} Click a country, or zoom in, for its score.` }
    }
    const place = await D.placeAt(cs.data, c)
    if (!place) return { status: 'empty', legend, updated, detail: 'The centre of the map is over the sea. Move it onto land, or click a country.' }
    const x = r.data.by[place.ISO3_CODE], ser = r.data.series[place.ISO3_CODE]
    if (!x) return { status: 'empty', legend, updated, detail: `${place.NAME_ENGL}: not covered by RISE.` }
    const rank = 1 + ranked.filter(([, y]) => y.v > x.v).length
    return { status: 'ok', legend, updated, value: nf.format(x.v), counts: `of 100, ${label.toLowerCase()}, ${place.NAME_ENGL} (${x.year})`,
      detail: `${ordinal(rank)} of ${ranked.length} economies scored. Trend: ${nf.format(ser[0][1])} in ${ser[0][0]}, ${nf.format(x.v)} in ${x.year}.` }
  }
  if (import.meta.env.PUBLIC_EDITION === 'full' && v === 'rules') {
    const V = RAMPS.viridis[th], col = [V[3], V[2], V[1], V[0]]
    const legend: LegendSpec = { kind: 'items', title: 'Building energy code', items: [...D.BG_STATUS.map((label, i) => ({ label, color: col[i], shape: 'dot' as const })),
      { label: 'Not covered by Building Green', color: th === 'dark' ? '#2f3432' : '#e4e6e3', shape: 'dot' as const }],
      note: 'Each economy is measured in one city; the panel names it.' }
    const [cs, bg] = await Promise.all([D.countries(), D.buildingGreen()])
    if (!cs.data || !bg.data) return { status: 'error', legend, errors: [cs.error && `Natural Earth: ${cs.error}`, bg.error && `Building Green: ${bg.error}`].filter(Boolean) as string[] }
    const updated = 'World Bank Building Green dataset, 2024'
    const all = Object.values(bg.data.countries) as any[]
    if (z < 3) return { status: 'ok', legend, updated, value: String(all.filter(c => D.bgStatus(c) === 0).length), counts: `of ${all.length} economies enforce a unified building energy code`,
      detail: `${all.filter(c => D.bgStatus(c) === 3).length} have some standards but no unified code. Click a country, or zoom in, for what its rules require.` }
    const place = await D.placeAt(cs.data, c)
    if (!place) return { status: 'empty', legend, updated, detail: 'The centre of the map is over the sea. Move it onto land, or click a country.' }
    const b = bg.data.countries[place.ISO3_CODE]
    if (!b) return { status: 'empty', legend, updated, detail: `${place.NAME_ENGL}: not covered by Building Green.` }
    const has = (k: string) => String(b[k] ?? '..').trim().startsWith('Yes'), rep = (k: string) => !['..', '', 'undefined'].includes(String(b[k] ?? '..').trim())
    const list = (m: [string, string][]) => m.filter(([k]) => has(k)).map(([, n]) => n).join(', ') || 'none reported'
    const covers = list([['BEC-PROJ-02', 'new buildings'], ['BEC-PROJ-03', 'renovations'], ['BEC-PROJ-04', 'additions'], ['BEC-PROJ-05', 'alterations'], ['BEC-PROJ-06', 'repairs'], ['BEC-PROJ-07', 'change of use']])
    const reqs = list([['REQ-PAS-01', 'passive design'], ['REQ-PAS-09', 'insulation (U-values)'], ['REQ-HVAC-01', 'space heating'], ['REQ-HVAC-02', 'water heating'], ['REQ-HVAC-03', 'cooling'], ['REQ-LIGH-01', 'lighting']])
    const yn = (k: string) => (rep(k) ? (has(k) ? 'yes' : 'no') : 'not reported')
    const enf = `Enforced in practice: ${rep('ENF-INFO-01') ? String(b['ENF-INFO-01']).toLowerCase() : 'not reported'}${rep('ENF-INFO-02') ? `, since ${b['ENF-INFO-02']}` : ''}. ` +
      `Design checked for a building permit: ${yn('ENF-PERM-01')}. Checked before occupancy: ${yn('ENF-POST-01')}. Energy performance disclosed publicly: ${yn('ENF-DISC-01')}.`
    return { status: 'ok', legend, updated, value: D.BG_SHORT[D.bgStatus(b)], counts: `${place.NAME_ENGL}, measured in ${b['DEM-INFO-03']}`,
      detail: `${rep('BEC-INFO-02') ? b['BEC-INFO-02'] : 'Code name not reported'}. Approach: ${rep('BEC-INFO-04') ? String(b['BEC-INFO-04']).replace(/\s+\)/, ')').toLowerCase() : 'not reported'}. ` +
        `Covers ${covers}. Requirements on ${reqs}. ${enf}` }
  }
  if (v === 'business') {
    const t = w.state.sub.business || 'BE', label = VIEWS.business.subs.find(x => x.id === t)!.label
    const [cs, os, ...ps] = await Promise.all([D.countries(), ...['OS', 'P1', 'P2', 'P3'].map(k => D.bready(`IC.BRE.${t}.${k}`))])
    const legend: LegendSpec = { kind: 'ramp', title: `${label}, B-READY score`, colors: RAMPS.viridis[th], ticks: ['0', '25', '50', '75', '100'],
      note: 'Grey: not covered by B-READY yet (about 100 economies so far).' }
    if (!cs.data || !os.data) return { status: 'error', legend, errors: [cs.error && `Natural Earth: ${cs.error}`, os.error && `World Bank: ${os.error}`].filter(Boolean) as string[] }
    const updated = `World Bank, updated ${os.data.updated}`
    const ranked = Object.entries(os.data.by).filter(([k]) => /^[A-Z]{3}$/.test(k)).sort((a, b) => b[1].v - a[1].v)
    const name = (k: string) => cs.data.features.find((f: any) => f.properties.ISO3_CODE === k)?.properties.NAME_ENGL || k
    if (z < 3 && ranked.length) return { status: 'ok', legend, updated, value: nf.format(ranked[0][1].v), counts: `of 100, highest: ${name(ranked[0][0])}`,
      detail: `${ranked.length} economies scored. Lowest: ${name(ranked.at(-1)![0])}, ${nf.format(ranked.at(-1)![1].v)}. Click a country, or zoom in, for its score.` }
    const place = await D.placeAt(cs.data, c)
    if (!place) return { status: 'empty', legend, updated, detail: 'The centre of the map is over the sea. Move it onto land, or click a country.' }
    const r = os.data.by[place.ISO3_CODE]
    if (!r) return { status: 'empty', legend, updated, detail: `${place.NAME_ENGL}: not covered by B-READY yet.` }
    const pillars = ps.map((p, i) => `${D.BREADY_PILLARS[i]} ${p.data?.by[place.ISO3_CODE] ? nf.format(p.data.by[place.ISO3_CODE].v) : 'None'}`).join(', ')
    return { status: 'ok', legend, updated, value: nf.format(r.v), counts: `of 100, ${label.toLowerCase()}, ${place.NAME_ENGL} (${r.year})`,
      detail: `${ordinal(ranked.findIndex(([k]) => k === place.ISO3_CODE) + 1)} of ${ranked.length} economies scored. Pillars: ${pillars}.` }
  }
  const ind = (w.state.sub.people || 'density') as D.Indicator
  const meta = D.INDICATORS[ind]
  const [cs, wb] = await Promise.all([D.countries(), D.worldBank(ind)])
  const legend: LegendSpec = { kind: 'ramp', title: `${meta.label}, ranked`, colors: RAMPS.cividis[th], ticks: ['Lowest', 'Middle', 'Highest'], note: INDICATORS_NOTE }
  if (!cs.data || !wb.data) return { status: 'error', legend, errors: [cs.error && `Natural Earth: ${cs.error}`, wb.error && `World Bank: ${wb.error}`].filter(Boolean) as string[] }
  const sortedAll = [...new Set(cs.data.features.map((f: any) => f.properties.ISO3_CODE))].map(k => ({ k, r: wb.data!.by[k as string] })).filter(x => x.r).sort((a, b) => b.r.v - a.r.v)
  const fmt = (v: number) => ind === 'population' ? big.format(v) : nf.format(v)
  if (z < 3 && sortedAll.length) {
    const name = (k: any) => cs.data.features.find((f: any) => f.properties.ISO3_CODE === k)?.properties.NAME_ENGL
    const world = wb.data.by.WLD
    return { status: 'ok', legend, updated: `World Bank, updated ${wb.data.updated}`, value: fmt(sortedAll[0].r.v), counts: `${meta.unit}, highest: ${name(sortedAll[0].k)}`,
      detail: `${world ? `World: ${fmt(world.v)}. ` : ''}Lowest: ${name(sortedAll.at(-1)!.k)}, ${fmt(sortedAll.at(-1)!.r.v)}. Click a country, or zoom in, for its number.` }
  }
  const place = await D.placeAt(cs.data, c)
  if (!place) return { status: 'empty', legend, updated: `World Bank, updated ${wb.data.updated}`, detail: 'The centre of the map is over the sea. Move it onto land, or click a country.' }
  const r = wb.data.by[place.ISO3_CODE]
  if (!r) return { status: 'empty', legend, detail: `No published figure for ${place.NAME_ENGL}.` }
  const sorted = [...new Set(cs.data.features.map((f: any) => f.properties.ISO3_CODE))].map(k => wb.data!.by[k as string]?.v).filter(x => x != null).sort((a, b) => b - a)
  return { status: 'ok', legend, updated: r.src ? `${r.src}, ${r.year}` : `World Bank, updated ${wb.data.updated}`, value: ind === 'population' ? big.format(r.v) : nf.format(r.v),
    counts: `${meta.unit}, ${place.NAME_ENGL} (${r.year})`, detail: `${ordinal(sorted.indexOf(r.v) + 1)} of ${sorted.length} countries and territories with a value.` }
}

export { MAG_STOPS }
