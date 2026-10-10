// United States: NWS and SPC, NIFC, FEMA/ORNL USA Structures, FAA airspace and airports.
import { json } from './data'
import { type Bbox, type Local, OI, arcgis, circle, env, fc, fill, fmt, has, heights, icon, line, nf } from './local-kit'

export const US: Bbox = [-180, 17, -64, 72]
const SIG: Record<string, [string, string]> = { W: ['Warning', OI.red], A: ['Watch', OI.orange], Y: ['Advisory', OI.yellow], S: ['Statement', OI.sky] }
const CLASS_COL: Record<string, string> = { B: OI.blue, C: OI.pink, D: OI.sky, E: '#8d938f' }

export const US_LAYERS: Local[] = [
  { id: 'L-nws', view: 'hazards', cat: 'storms', area: US, minzoom: 3, what: 'NWS watches, warnings and advisories',
    name: 'National Weather Service, watches, warnings and advisories', href: 'https://www.weather.gov/disclaimer', licence: 'US public domain (NWS)',
    load: async () => (await arcgis('https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1', 'where=1%3D1&outFields=objectid,prod_type,sig,expiration,url,wfo,issuance&outSR=4326&maxAllowableOffset=0.01&geometryPrecision=3'))   // all of the US at once, about 3 MB
      .map(f => ({ ...f, id: f.properties.objectid })),
    layers: d => [fill('L-nws', ['match', ['get', 'sig'], ...Object.entries(SIG).flatMap(([k, [, c]]) => [k, c]), '#8d938f'], 0.22),
      line('L-nws-line', ['match', ['get', 'sig'], ...Object.entries(SIG).flatMap(([k, [, c]]) => [k, c]), '#8d938f'], 1)],
    legend: () => Object.values(SIG).map(([l, c]) => ({ label: `NWS ${l.toLowerCase()}`, color: c, shape: 'dot' as const })),
    pick: p => ({ title: p.prod_type, href: p.url || undefined, rows: [['Kind', SIG[p.sig]?.[0] || 'Statement'], ['Issued', fmt(p.issuance)], ['Expires', fmt(p.expiration)], ...has('Office', p.wfo)] }) },
  { id: 'L-spc', view: 'hazards', cat: 'storms', area: [-130, 20, -60, 52], minzoom: 2, what: 'SPC day 1 storm-risk areas',
    name: 'NOAA Storm Prediction Center, day 1 convective outlook', href: 'https://www.spc.noaa.gov/products/outlook/', licence: 'US public domain (NOAA)',
    load: async () => fc((await json('https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson')).features),
    layers: () => [fill('L-spc', ['get', 'fill'], 0.3), line('L-spc-line', ['get', 'stroke'], 1.2)],
    legend: () => [{ label: 'SPC storm risk, day 1 (its own colours, green to magenta)', color: '#66A366', shape: 'dot' }],
    pick: p => ({ title: p.LABEL2, href: 'https://www.spc.noaa.gov/products/outlook/day1otlk.html', rows: [['Valid', `${fmt(p.VALID_ISO)} to ${fmt(p.EXPIRE_ISO)}`], ['Issued', fmt(p.ISSUE_ISO)], ...has('Forecaster', p.FORECASTER)] }) },
  { id: 'L-nifc', view: 'hazards', cat: 'fire', area: US, minzoom: 3, what: 'current US wildfire incidents (NIFC)',
    name: 'National Interagency Fire Center, WFIGS current incidents', href: 'https://data-nifc.opendata.arcgis.com', licence: 'US federal data, no licence stated (public domain)',
    load: () => arcgis('https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0',
      "where=IncidentTypeCategory%3D'WF'&outFields=IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime,POOState,POOCounty,FireCause,ModifiedOnDateTime_dt&outSR=4326"),
    layers: d => [circle('L-nifc', OI.red, ['interpolate', ['linear'], ['coalesce', ['get', 'IncidentSize'], 0], 0, 5, 1000, 8, 100000, 16], d), icon('L-nifc-icon', 'i-fire', 0.18)],
    legend: () => [{ label: 'US wildfire (NIFC), larger for more acres', color: OI.red, shape: 'dot' }],
    pick: p => ({ title: `${p.IncidentName} fire`, rows: [...has('Size', p.IncidentSize != null ? `${nf.format(p.IncidentSize)} acres` : null), ...has('Contained', p.PercentContained != null ? `${p.PercentContained}%` : null),
      ['Discovered', fmt(p.FireDiscoveryDateTime)], ...has('Where', [p.POOCounty, String(p.POOState || '').replace('US-', '')].filter(Boolean).join(', ')), ...has('Cause', p.FireCause)] }) },
  { id: 'L-nifc-per', view: 'hazards', cat: 'fire', area: US, minzoom: 6, cell: 2, what: 'US wildfire perimeters (NIFC)',
    name: 'NIFC, WFIGS current perimeters', href: 'https://data-nifc.opendata.arcgis.com', licence: 'US federal data, no licence stated (public domain)',
    load: async c => (await arcgis('https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0',
      `${env(c!)}&where=1%3D1&outFields=OBJECTID,poly_IncidentName,poly_GISAcres,attr_PercentContained,poly_DateCurrent&maxAllowableOffset=0.0003&geometryPrecision=5`)).map(f => ({ ...f, id: f.properties.OBJECTID })),
    layers: () => [fill('L-nifc-per', OI.red, 0.3), line('L-nifc-per-line', OI.red, 1.5)],
    pick: p => ({ title: `${p.poly_IncidentName} fire perimeter`, rows: [...has('Area', p.poly_GISAcres != null ? `${nf.format(p.poly_GISAcres)} acres` : null), ...has('Contained', p.attr_PercentContained != null ? `${p.attr_PercentContained}%` : null), ['Mapped', fmt(p.poly_DateCurrent)]] }) },
  { id: 'L-usa-str', view: 'height', area: US, minzoom: 15, cell: 0.01, dedupe: true, what: 'USA Structures buildings with a LiDAR height',
    name: 'FEMA/ORNL USA Structures', href: 'https://gis-fema.hub.arcgis.com/pages/usa-structures', licence: 'CC BY 4.0',
    load: async c => (await arcgis('https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0',
      `${env(c!)}&where=HEIGHT%3E0&outFields=OBJECTID,HEIGHT,OCC_CLS,PRIM_OCC,SQMETERS,IMAGE_DATE,SOURCE,PROP_ADDR&geometryPrecision=6`))
      .map(f => ({ ...f, id: f.properties.OBJECTID, properties: { height: f.properties.HEIGHT, use: f.properties.OCC_CLS, prim: f.properties.PRIM_OCC, m2: f.properties.SQMETERS, img: f.properties.IMAGE_DATE, src: f.properties.SOURCE, addr: f.properties.PROP_ADDR } })),
    layers: d => [heights('L-usa-str', d)],
    pick: p => ({ title: p.addr || 'Building (USA Structures)', rows: [['Height', `${Math.round(p.height)} m`], ...has('Use', [p.use, p.prim].filter(Boolean).join(', ')), ...has('Floor area', p.m2 ? `${nf.format(p.m2)} m²` : null),
      ...has('Imagery', p.img ? new Date(p.img).getFullYear() : null), ...has('Footprint from', p.src)] }) },
  { id: 'L-faa-air', view: 'satellites', area: US, minzoom: 7, cell: 1, what: 'controlled airspace areas (FAA)',
    name: 'FAA Aeronautical Information Services, class airspace', href: 'https://adds-faa.opendata.arcgis.com', licence: 'US public domain ("for public use", FAA)',
    load: async c => (await arcgis('https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0',
      `${env(c!)}&where=CLASS%20IS%20NOT%20NULL&outFields=OBJECTID,NAME,CLASS,LOCAL_TYPE,LOWER_VAL,LOWER_UOM,LOWER_CODE,UPPER_VAL,UPPER_UOM,UPPER_CODE,ICAO_ID,WKHR_CODE&maxAllowableOffset=0.0005&geometryPrecision=5`)).map(f => ({ ...f, id: f.properties.OBJECTID })),
    layers: () => [fill('L-faa-air', ['match', ['get', 'CLASS'], ...Object.entries(CLASS_COL).flat(), '#8d938f'], ['match', ['get', 'CLASS'], 'E', 0.04, 0.12]),
      line('L-faa-air-line', ['match', ['get', 'CLASS'], ...Object.entries(CLASS_COL).flat(), '#8d938f'], ['match', ['get', 'CLASS'], 'E', 0.8, 1.6])],
    legend: () => Object.entries(CLASS_COL).map(([k, c]) => ({ label: `Class ${k} airspace (FAA)`, color: c, shape: 'line' as const })),
    pick: p => { const lim = (v: any, u: any, c: any) => (c === 'SFC' ? 'surface' : v != null && v !== -9998 ? `${nf.format(v)} ${String(u).toLowerCase()} ${c === 'MSL' ? 'above sea level' : c || ''}`.trim() : 'not published')
      return { title: p.NAME, rows: [['Class', p.CLASS], ['From', lim(p.LOWER_VAL, p.LOWER_UOM, p.LOWER_CODE)], ['Up to', lim(p.UPPER_VAL, p.UPPER_UOM, p.UPPER_CODE)], ...has('Airport', p.ICAO_ID), ...has('Hours', p.WKHR_CODE === 'H24' ? '24 hours' : p.WKHR_CODE)] } } },
  { id: 'L-faa-apt', view: 'airports', area: US, minzoom: 8, cell: 1, what: 'FAA landing facilities',
    name: 'FAA Aeronautical Information Services, airports', href: 'https://adds-faa.opendata.arcgis.com', licence: 'US public domain ("for public use", FAA)',
    load: async c => (await arcgis('https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer/0',
      `${env(c!)}&where=1%3D1&outFields=OBJECTID,IDENT,ICAO_ID,NAME,TYPE_CODE,SERVCITY,STATE,OPERSTATUS,PRIVATEUSE,IAPEXISTS,ELEVATION,MIL_CODE`)).map(f => ({ ...f, id: f.properties.OBJECTID })),
    layers: d => [{ id: 'L-faa-apt', type: 'circle', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 9, 14, 13], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': d ? '#e6ebe8' : '#1d2120', 'circle-stroke-width': 1.2, 'circle-stroke-opacity': 0.7 } }],
    legend: d => [{ label: 'FAA landing facility (US), ring', color: d ? '#e6ebe8' : '#1d2120', shape: 'ring' }],
    pick: p => ({ title: p.NAME, href: `https://adip.faa.gov/agis/public/#/airportData/${p.IDENT}`, rows: [['FAA id', p.IDENT], ...has('ICAO', p.ICAO_ID), ['Kind', ({ AD: 'Aerodrome', HP: 'Heliport', SP: 'Seaplane base', UL: 'Ultralight', GL: 'Gliderport', BP: 'Balloonport' } as any)[p.TYPE_CODE] || p.TYPE_CODE],
      ['Use', p.PRIVATEUSE === 1 || p.PRIVATEUSE === '1' ? 'Private' : 'Public'], ...has('Status', p.OPERSTATUS), ...has('Instrument approach', p.IAPEXISTS === 1 || p.IAPEXISTS === '1' ? 'Yes' : null),
      ...has('Elevation', p.ELEVATION != null ? `${nf.format(p.ELEVATION)} ft` : null), ...has('Serves', [p.SERVCITY, p.STATE].filter(Boolean).join(', '))] }) },
]
