// Country layers read straight from official open sources in the browser (Australia with South Australia deepest, Taiwan,
// the United States). Each one: keyless, CORS-open (probed 2026-10-11, country-probe-*-2026-10-11.md), open licence, so both
// editions carry it. Loaded only while its view is on and the view meets its area (and, for big services, only the grid cells
// in view). A source that is down shows as "source unavailable" in the answer, never as a console error.
import type { Local } from './local-kit'
import { AU_LAYERS } from './local-au'
import { TW_LAYERS } from './local-tw'
import { US_LAYERS } from './local-us'
import { HK_LAYERS } from './local-hk'
import { SPACE_LAYERS } from './local-space'
export * from './local-kit'
export { AADT_STOPS, DENSITY_STOPS, NEM_REGION, aemo, auState } from './local-au'

export const LOCAL: Local[] = [...AU_LAYERS, ...TW_LAYERS, ...US_LAYERS, ...HK_LAYERS, ...SPACE_LAYERS]
// layer id -> the country layer that owns it, for clicks and sub-maps
export const layerOwner = (layerId: string) => LOCAL.find(l => layerId === l.id || layerId.startsWith(l.id + '-'))
