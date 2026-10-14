// The info views: one question each, with its sub-maps (V5 topics), legend ramp and copy. Ramps are colour-blind safe
// (viridis, inferno, cividis families) and every ramp has a second channel: height, size or a label.
// 'rules' runs on RISE (CC BY 4.0) in both editions; the full edition adds a noncommercial detail source as one more
// sub-choice. Every branch for that source is dead code in WorldViews Libre, so its copy and URL are not in the bundle.
export type ViewId = 'height' | 'hazards' | 'transit' | 'traffic' | 'people' | 'business' | 'rules' | 'satellites' | 'airports'
export const VIEW_IDS: ViewId[] = ['height', 'hazards', 'transit', 'traffic', 'people', 'business', 'rules', 'satellites', 'airports']

export const VIEWS: Record<ViewId, {
  question: string; noun: string; topic: string; icon: string
  subs: { id: string; label: string }[]
}> = {
  height: { question: 'How tall is it?', noun: 'Height', topic: 'Built city', icon: 'ph:buildings',
    subs: [{ id: 'all', label: 'Every height' }, { id: 'tall', label: '150 m and taller' }, { id: 'super', label: 'Supertall, 300 m and taller' },
      { id: 'character', label: 'District character: what buildings are used for' }] },
  hazards: { question: 'What is happening now?', noun: 'Hazards', topic: 'Safety', icon: 'ph:warning-circle',
    subs: [{ id: 'all', label: 'All events' }, { id: 'quakes', label: 'Earthquakes' }, { id: 'storms', label: 'Cyclones and storms' },
      { id: 'floods', label: 'Floods and drought' }, { id: 'fire', label: 'Wildfires and volcanoes' }, { id: 'roads', label: 'Roads and transport (Hong Kong, South Australia)' },
      { id: 'health', label: 'Health: A&E waits and air quality (Hong Kong)' }] },
  transit: { question: 'Where can I ride?', noun: 'Transit', topic: 'Moving', icon: 'ph:train',
    subs: [{ id: 'all', label: 'Rail and bus' }, { id: 'rail', label: 'MTR rail' }, { id: 'bus', label: 'Bus and minibus' }] },
  traffic: { question: 'How busy are the roads?', noun: 'Traffic', topic: 'Roads', icon: 'ph:car',
    subs: [{ id: 'all', label: 'Traffic and crashes' }, { id: 'volume', label: 'Vehicles per day' }, { id: 'crashes', label: 'Crashes, 2020 to 2024' },
      { id: 'hkroads', label: 'Road rules (Hong Kong)' }, { id: 'hkspeed', label: 'Speeds and journey times now (Hong Kong)' },
      { id: 'hkev', label: 'EV charging (Hong Kong)' }] },
  people: { question: 'Who lives here?', noun: 'People', topic: 'People', icon: 'ph:users-three',
    subs: [{ id: 'density', label: 'Density' }, { id: 'population', label: 'Population' }, { id: 'aged', label: 'Aged 65 and over' },
      { id: 'urban', label: 'Living in towns and cities' }] },
  business: { question: 'How easy is business here?', noun: 'Business', topic: 'Business', icon: 'ph:briefcase',
    subs: [{ id: 'BE', label: 'Business entry' }, { id: 'BL', label: 'Business location' }, { id: 'US', label: 'Utility services' },
      { id: 'LB', label: 'Labor' }, { id: 'FS', label: 'Financial services' }, { id: 'IT', label: 'International trade' }, { id: 'TX', label: 'Taxation' },
      { id: 'DR', label: 'Dispute resolution' }, { id: 'MC', label: 'Market competition' }, { id: 'BI', label: 'Business insolvency' }] },
  satellites: { question: 'What is overhead?', noun: 'Satellites', topic: 'Space', icon: 'tabler:satellite',
    subs: [{ id: 'stations', label: 'Space stations' }, { id: 'visual', label: 'Brightest' }, { id: 'gnss', label: 'Navigation (GNSS)' },
      { id: 'weather', label: 'Weather' }, { id: 'starlink', label: 'Starlink' }, { id: 'active', label: 'Every active satellite' }, { id: 'debris', label: 'Debris from four breakups' }] },
  airports: { question: 'Where can I fly from?', noun: 'Airports', topic: 'Flying', icon: 'ph:airplane-takeoff',
    subs: [{ id: 'all', label: 'Every airport' }] },
  rules: { question: 'What do building energy rules require?', noun: 'Building rules', topic: 'Building rules', icon: 'ph:leaf',
    subs: [{ id: 'BEC', label: 'Building Energy Codes' }, { id: 'ELS', label: 'Energy Labeling Systems' },
      { id: 'MEEP', label: 'Minimum Energy Efficiency Performance Standards' }, { id: 'IMPS', label: 'Energy Efficiency in Public Sector' },
      { id: 'FMEE', label: 'Financing Mechanisms for Energy Efficiency' },
      ...(import.meta.env.PUBLIC_EDITION === 'full' ? [{ id: 'bg', label: 'Building Green, code and enforcement (noncommercial)' }] : [])] },
}

// Ramps per theme: the low end must stay visible on the basemap (dark purple vanishes on a dark map, pale yellow on a light one).
export const RAMPS = {
  viridis: { light: ['#440154', '#3b528b', '#21918c', '#5ec962', '#c8d93a'], dark: ['#3b528b', '#21918c', '#5ec962', '#b5de2b', '#fde725'] },
  inferno: { light: ['#420a68', '#932667', '#dd513a', '#f38a1a'], dark: ['#932667', '#dd513a', '#fca50a', '#fcffa4'] },
  cividis: { light: ['#00224e', '#3e4b6c', '#7c7b78', '#bcaf6f', '#e1cd52'], dark: ['#35456c', '#666970', '#948e77', '#c8b866', '#fee838'] },
}
export const HEIGHT_STOPS = [0, 30, 80, 150, 300]
export const MAG_STOPS = [2.5, 4, 5.5, 7]

export const SOURCES = {
  height: [
    { name: 'AlreadyOpen world-buildings', href: 'https://huggingface.co/datasets/alreadyopen/world-buildings', licence: 'Overture Maps ODbL, © OpenStreetMap contributors' },
    { name: 'AlreadyOpen hk-buildings', href: 'https://huggingface.co/datasets/alreadyopen/hk-buildings', licence: 'Lands Department via CSDI (Government of the HKSAR)' },
    { name: '3DBAG (the Netherlands)', href: 'https://3dbag.nl', licence: '© 3DBAG by tudelft3d and 3DGI, CC BY 4.0' },
  ],
  hazards: [
    { name: 'USGS earthquakes, M2.5+', href: 'https://earthquake.usgs.gov/earthquakes/feed/', licence: 'Public domain' },
    { name: 'GDACS alerts', href: 'https://www.gdacs.org', licence: 'GDACS terms' },
    { name: 'NASA EONET', href: 'https://eonet.gsfc.nasa.gov', licence: 'NASA open data' },
  ],
  traffic: [],   // per place: the country sources (local.ts) list themselves in the answer when they are in view
  transit: [{ name: 'AlreadyOpen hk-transit', href: 'https://huggingface.co/datasets/alreadyopen/hk-transit', licence: 'Government of the HKSAR data (DATA.GOV.HK, CSDI terms); TD, KMB, Citybus, MTR' }],
  people: [
    { name: 'World Bank indicators', href: 'https://data.worldbank.org', licence: 'CC BY 4.0' },
    { name: 'Natural Earth countries', href: 'https://www.naturalearthdata.com', licence: 'Public domain' },
    { name: 'AlreadyOpen world-places: official figures (Taiwan, Jersey, Åland, Pacific places)', href: 'https://huggingface.co/datasets/alreadyopen/world-places', licence: 'per source' },
  ],
  rules: [{ name: 'World Bank, RISE (Regulatory Indicators for Sustainable Energy)', href: 'https://rise.esmap.org', licence: 'CC BY 4.0', notSub: 'bg' },
    ...(import.meta.env.PUBLIC_EDITION === 'full' ? [{ name: 'World Bank, Building Green', href: 'https://www.worldbank.org/en/building-green',
    licence: 'Noncommercial use with attribution (World Bank). World Bank. 2025. Unlocking Efficiency: The Global Landscape of Building Energy Regulations and their Enforcement. © World Bank', sub: 'bg' }] : [])],
  satellites: [{ name: "CelesTrak (GP data from the US Space Force's space-track.org); positions computed with satellite.js", href: 'https://celestrak.org/NORAD/elements/',
    licence: 'Refetched at most every 2 hours, per the CelesTrak usage policy; satellite.js MIT' }],
  airports: [{ name: 'OurAirports, via AlreadyOpen world-airports', href: 'https://ourairports.com/data/', licence: 'Public domain' }],
  business: [{ name: 'World Bank, B-READY (Business Ready)', href: 'https://www.worldbank.org/en/businessready', licence: 'CC BY 4.0' }],
}

export const HK = { center: [114.165, 22.29] as [number, number], zoom: 13.6, pitch: 58, bearing: -18 }
export const ADELAIDE = { center: [138.6, -34.925] as [number, number], zoom: 12, pitch: 0, bearing: 0 }
export const HK_BOX = [113.82, 22.13, 114.44, 22.57]
export const inHK = ([x, y]: number[]) => x > HK_BOX[0] && x < HK_BOX[2] && y > HK_BOX[1] && y < HK_BOX[3]

export const INDICATORS_NOTE = 'Colour shows rank, so a few very dense city-states do not wash out every other country.'
