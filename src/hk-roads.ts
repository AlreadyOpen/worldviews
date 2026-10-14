// Hong Kong road rules from the Transport Department's Road Network (2nd generation), via AlreadyOpen hk-roads (one PMTiles
// file, a tile layer per TD layer): the "Road rules (Hong Kong)" map of "How busy are the roads?" (Helen 2026-10-14, option B),
// and the whole-road highlight of the TD traffic alerts (option A, a toggle, off by default). Codes from TD's data
// specification (rdnet_dataspec_fgdb.pdf): TRAVEL_DIRECTION 1 both ways, 3 one way in the drawn direction; NSR vehicle type
// and hours; traffic features 1 zebra, 2 yellow box, 3 toll, 4 cul-de-sac. The tiles keep codes as numbers (the Parquet
// files as text), so styles and cards compare them as text.
export const HKR_TILES = 'pmtiles://https://huggingface.co/buckets/alreadyopen/hk-roads/resolve/roads.pmtiles'
export const HKR_SRC = 'hkr'
export const HKR_HL = 'hr-alert'
export const HKR_BOX: [number, number, number, number] = [113.8, 22.13, 114.45, 22.57]

const T = (id: string, layer: string, type: string, minzoom: number, paint: any, extra: any = {}) =>
  ({ id, type, source: HKR_SRC, 'source-layer': layer, minzoom, paint, ...extra })
const SPEED = ['30 km/h', '50 km/h', '70 km/h', '80 km/h', '100 km/h', '110 km/h']
const SPEED_C = ['#5e3c99', '#3b528b', '#21918c', '#5ec962', '#c8d43a', '#fde725']
const NSR_VEH: Record<string, string> = { 1: 'All motor vehicles', 2: 'Taxis', 3: 'Public light buses', 4: 'Goods vehicles', 5: 'Others' }
const NSR_TIME: Record<string, string> = { 1: '24 hours', 2: '8 am to 10 am and 5 pm to 7 pm', 3: '7 am to 7 pm', 4: '7 am to midnight', 5: 'Other hours' }
const NSR_DAY: Record<string, string> = { 1: 'All days', 2: 'All days except Sundays and public holidays', 3: 'Sundays and public holidays', 4: 'Other days' }
const TF: Record<string, [string, string]> = { 1: ['Zebra crossing', '#ffffff'], 2: ['Yellow box', '#F0E442'], 3: ['Toll', '#0072B2'], 4: ['Cul-de-sac', '#9a9a9a'] }
const VEH: Record<string, string> = { ALL: 'all motor vehicles', FB: 'franchised buses', GMB: 'green minibuses', GV: 'goods vehicles', NFB: 'non-franchised buses', TX: 'taxis' }
const veh = (v?: string) => !v || v === 'NA' ? '' : v.split(/[,;/ ]+/).filter(Boolean).map(x => VEH[x] || x).join(', ')

// Draw order: roads, then rules on them, then points; all start hidden (the engine shows them with their view)
export function hkRoadLayers(dark: boolean) {
  const road = dark ? '#6f7a76' : '#9aa3a0'
  return [
    T('hr-centre', 'centerline', 'line', 10, { 'line-color': road, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 2.5],
      'line-opacity': ['case', ['==', ['to-string', ['get', 'ELEVATION']], '0'], 0.8, 1] }, { layout: { 'line-cap': 'round', 'line-join': 'round' } }),
    T('hr-speed', 'speed_limit', 'line', 12, { 'line-color': ['match', ['get', 'SPEED_LIMIT'], ...SPEED.flatMap((s, i) => [s, SPEED_C[i]]), '#888'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 5], 'line-opacity': 0.85 }, { layout: { 'line-cap': 'round' } }),
    T('hr-bus', 'bus_only_lane', 'line', 12, { 'line-color': '#D55E00', 'line-width': 3, 'line-dasharray': [2, 1], 'line-offset': 3 }),
    T('hr-ped', 'pedestrian_zone', 'line', 12, { 'line-color': '#CC79A7', 'line-width': 4, 'line-opacity': 0.8 }),
    T('hr-nsr', 'nsr', 'line', 14, { 'line-color': ['case', ['==', ['to-string', ['get', 'TIME_ZONE']], '1'], '#F0E442', '#E69F00'], 'line-width': 2, 'line-dasharray': [1, 1], 'line-offset': -3 }),
    T('hr-turn', 'turn', 'line', 14, { 'line-color': '#e0453a', 'line-width': 2, 'line-opacity': 0.75 }),
    T('hr-oneway', 'centerline', 'symbol', 15, { 'icon-color': dark ? '#e6ebe8' : '#3a4240', 'icon-opacity': 0.85 },
      { filter: ['==', ['to-string', ['get', 'TRAVEL_DIRECTION']], '3'], layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'i-arrow', 'icon-size': 0.3,
        'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true } }),
    T('hr-tf', 'traffic_features', 'circle', 14, { 'circle-color': ['match', ['to-string', ['get', 'FEATURE_TYPE']], ...Object.entries(TF).flatMap(([k, [, c]]) => [k, c]), '#888'],
      'circle-radius': 4, 'circle-stroke-color': '#151918', 'circle-stroke-width': 1 }),
    T('hr-proh', 'prohibition', 'circle', 14, { 'circle-color': '#ffffff', 'circle-radius': 5, 'circle-stroke-color': '#d7191c', 'circle-stroke-width': 2.5 }),
    T('hr-vr', 'vehicle_restriction', 'circle', 14, { 'circle-color': '#ffffff', 'circle-radius': 5, 'circle-stroke-color': '#E69F00', 'circle-stroke-width': 2.5 }),
    T('hr-permit', 'permit', 'circle', 14, { 'circle-color': '#ffffff', 'circle-radius': 5, 'circle-stroke-color': '#0072B2', 'circle-stroke-width': 2.5 }),
    T('hr-park', 'gisp_on_street_parking', 'circle', 15, { 'circle-color': '#009E73', 'circle-radius': 3, 'circle-opacity': 0.85 }),
  ]
}
export const HKR_RULES = hkRoadLayers(false).map(l => l.id)

// The TD alerts' roads, whole, under the alert pins (option A): one glowing line, filtered to the named streets
export const hkAlertRoadLayer = () => T(HKR_HL, 'centerline', 'line', 8, { 'line-color': '#E69F00', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 16, 9],
  'line-opacity': 0.55, 'line-blur': 2 }, { filter: ['in', ['get', 'STREET_ENAME'], ['literal', []]], layout: { 'line-cap': 'round', 'line-join': 'round' } })

export const hkRoadLegend = () => [
  ...SPEED.filter(s => s !== '50 km/h').map((s, i) => ({ label: `Speed limit ${s}`, color: SPEED_C[SPEED.indexOf(s)] ?? SPEED_C[i], shape: 'line' as const })),
  { label: 'Other roads: 50 km/h unless signed (Hong Kong\'s general limit)', color: '#9aa3a0', shape: 'line' as const },
  { label: 'Bus-only lane', color: '#D55E00', shape: 'line' as const }, { label: 'Pedestrian zone', color: '#CC79A7', shape: 'line' as const },
  { label: 'No stopping, 24 hours', color: '#F0E442', shape: 'line' as const }, { label: 'No stopping, part of the day', color: '#E69F00', shape: 'line' as const },
  { label: 'Restricted turn', color: '#e0453a', shape: 'line' as const },
  { label: 'Prohibition sign', color: '#d7191c', shape: 'ring' as const }, { label: 'Vehicle size or weight limit', color: '#E69F00', shape: 'ring' as const },
  { label: 'Permit-only access', color: '#0072B2', shape: 'ring' as const },
  ...Object.values(TF).map(([label, color]) => ({ label, color, shape: 'dot' as const })),
  { label: 'On-street parking', color: '#009E73', shape: 'dot' as const },
]

type Row = [string, string]
const has = (k: string, v: any): Row[] => (v == null || v === '' || v === 'NA' ? [] : [[k, String(v)]])
// EFFECTIVE_DAY: 8 flags, Monday to Sunday then public holidays (which take precedence)
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'public holidays']
const days = (m?: string) => !m || m.length !== 8 ? m : m === 'YYYYYYYY' ? 'Every day' : m === 'YYYYYYNN' ? 'Monday to Saturday, not Sundays or public holidays'
  : `${DAYS.filter((_, i) => m[i] === 'Y').join(', ')}${m[7] === 'N' ? ' (not public holidays)' : ''}`
const title = (s?: string) => (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
export function hkRoadPick(id: string, p: any): { title: string; rows: Row[] } | null {
  p = Object.fromEntries(Object.entries(p || {}).map(([k, v]) => [k, v == null ? v : String(v)]))   // tiles keep TD's numbers, the cards compare text
  switch (id) {
    case 'hr-centre': case 'hr-oneway': case HKR_HL: return { title: title(p.STREET_ENAME) || 'Road', rows: [...has('中文', p.STREET_CNAME),
      ['Traffic', p.TRAVEL_DIRECTION === '3' ? 'One way (arrows show the direction)' : 'Both directions'], ['Level', p.ELEVATION === '0' ? 'At ground level' : `Above ground (level ${p.ELEVATION})`],
      ...has('Route', p.ROUTE_NUM), ...has('Exit', p.EXIT_NUM), ...has('Also called', title(p.ALIAS_ENAME))] }
    case 'hr-speed': return { title: `Speed limit ${p.SPEED_LIMIT}`, rows: has('Remarks', p.REMARKS) }
    case 'hr-bus': case 'hr-ped': return { title: id === 'hr-bus' ? 'Bus-only lane' : 'Pedestrian zone', rows: [...has('Hours', p.TIME_ZONE === '0000-2400' ? '24 hours' : p.TIME_ZONE),
      ...has('Days', days(p.EFFECTIVE_DAY)), ...has('Remarks', p.REMARKS)] }
    case 'hr-nsr': return { title: 'No stopping', rows: [['Applies to', NSR_VEH[p.VEHICLE_TYPE] || p.VEHICLE_TYPE], ['Hours', NSR_TIME[p.TIME_ZONE] || p.TIME_ZONE],
      ['Days', NSR_DAY[p.EFFECTIVE_DAY] || p.EFFECTIVE_DAY], ...has('Remarks', p.REMARKS)] }
    case 'hr-turn': return { title: 'Restricted turn', rows: [...has('Applies to', veh(p.INC_VEH_TYPE)), ...has('Except', veh(p.EXC_VEH_TYPE)), ...has('Part time', p.PART_TIME_REST), ...has('Remarks', p.REMARKS)] }
    case 'hr-proh': return { title: 'Prohibition sign', rows: [...has('Applies to', veh(p.INC_VEH_TYPE)), ...has('Except', veh(p.EXC_VEH_TYPE)),
      ...has('Part time', p.PART_TIME_PROHIBITION === 'Y' ? 'Yes' : p.PART_TIME_PROHIBITION === 'N' ? 'No' : p.PART_TIME_PROHIBITION), ...has('Remarks', p.REMARKS)] }
    case 'hr-vr': return { title: 'Vehicle restriction', rows: [...has('Max height', p.MAX_HEIGHT && `${p.MAX_HEIGHT} m`), ...has('Max width', p.MAX_WIDTH && `${p.MAX_WIDTH} m`),
      ...has('Max length', p.MAX_LENGTH && `${p.MAX_LENGTH} m`), ...has('Max weight', p.MAX_WEIGHT && `${p.MAX_WEIGHT} t`), ...has('Max axle weight', p.MAX_AXLE_WEIGHT && `${p.MAX_AXLE_WEIGHT} t`), ...has('Remarks', p.REMARKS)] }
    case 'hr-permit': return { title: 'Access with permit only', rows: has('Remarks', p.REMARKS) }
    case 'hr-tf': return { title: TF[p.FEATURE_TYPE]?.[0] || 'Traffic feature', rows: has('Remarks', p.REMARKS) }
    case 'hr-park': return { title: `On-street parking, ${title(p.STREET_NAME_ENG)}`, rows: [...has('Spaces', p.CAPACITY), ...has('Metered', p.METER_NONMETER === 'M' ? 'Yes' : p.METER_NONMETER === 'N' ? 'No' : p.METER_NONMETER),
      ...has('Vehicles', [p.VEHICLE_TYPE_DESCRIPTION_1, p.VEHICLE_TYPE_DESCRIPTION_2].filter(Boolean).join(', ')), ...has('Meter period', p.PARK_METER_PERIOD_DESC),
      ...has('Hours', p.OPERATIVE_HOUR_ENG), ...has('Remarks', p.IRNP_REMARKS_ENG)] }
  }
  return null
}
