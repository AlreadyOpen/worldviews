// The info views: one question each, with its sub-maps (V5 topics), legend ramp and copy. Ramps are colour-blind safe
// (viridis, inferno, cividis families) and every ramp has a second channel: height, size or a label.
export type ViewId = 'height' | 'hazards' | 'transit' | 'people'
export const VIEW_IDS: ViewId[] = ['height', 'hazards', 'transit', 'people']

export const VIEWS: Record<ViewId, {
  question: string; noun: string; topic: string; icon: string
  subs: { id: string; label: string }[]
}> = {
  height: { question: 'How tall is it?', noun: 'Height', topic: 'Built city', icon: 'ph:buildings',
    subs: [{ id: 'all', label: 'Every height' }, { id: 'tall', label: '150 m and taller' }, { id: 'super', label: 'Supertall, 300 m and taller' }] },
  hazards: { question: 'What is happening now?', noun: 'Hazards', topic: 'Safety', icon: 'ph:warning-circle',
    subs: [{ id: 'all', label: 'All events' }, { id: 'quakes', label: 'Earthquakes' }, { id: 'storms', label: 'Cyclones and storms' },
      { id: 'floods', label: 'Floods and drought' }, { id: 'fire', label: 'Wildfires and volcanoes' }] },
  transit: { question: 'Where can I ride?', noun: 'Transit', topic: 'Moving', icon: 'ph:train',
    subs: [{ id: 'all', label: 'Rail and bus' }, { id: 'rail', label: 'MTR rail' }, { id: 'bus', label: 'Bus and minibus' }] },
  people: { question: 'Who lives here?', noun: 'People', topic: 'People', icon: 'ph:users-three',
    subs: [{ id: 'density', label: 'Density' }, { id: 'population', label: 'Population' }, { id: 'aged', label: 'Aged 65 and over' },
      { id: 'urban', label: 'Living in towns and cities' }] },
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
    { name: 'AlreadyOpen world-skylines', href: 'https://huggingface.co/datasets/alreadyopen/world-skylines', licence: 'Overture ODbL, © OpenStreetMap contributors; HK: Lands Department (CSDI); NL: © 3DBAG by tudelft3d and 3DGI (CC BY 4.0)' },
    { name: 'Overture Maps buildings', href: 'https://docs.overturemaps.org/attribution', licence: 'ODbL' },
  ],
  hazards: [
    { name: 'USGS earthquakes, M2.5+', href: 'https://earthquake.usgs.gov/earthquakes/feed/', licence: 'Public domain' },
    { name: 'GDACS alerts', href: 'https://www.gdacs.org', licence: 'GDACS terms' },
    { name: 'NASA EONET', href: 'https://eonet.gsfc.nasa.gov', licence: 'NASA open data' },
  ],
  transit: [{ name: 'AlreadyOpen hk-transit', href: 'https://huggingface.co/datasets/alreadyopen/hk-transit', licence: 'Government of the HKSAR data (DATA.GOV.HK, CSDI terms); TD, KMB, Citybus, MTR' }],
  people: [
    { name: 'World Bank indicators', href: 'https://data.worldbank.org', licence: 'CC BY 4.0' },
    { name: 'Natural Earth countries', href: 'https://www.naturalearthdata.com', licence: 'Public domain' },
    { name: 'Taiwan Ministry of the Interior, household registration', href: 'https://www.ris.gov.tw/app/portal/346', licence: 'Open Government Data License, version 1.0' },
  ],
}

export const HK = { center: [114.165, 22.29] as [number, number], zoom: 13.6, pitch: 58, bearing: -18 }
export const HK_BOX = [113.82, 22.13, 114.44, 22.57]
export const inHK = ([x, y]: number[]) => x > HK_BOX[0] && x < HK_BOX[2] && y > HK_BOX[1] && y < HK_BOX[3]

export const INDICATORS_NOTE = 'Colour shows rank, so a few very dense city-states do not wash out every other country.'
