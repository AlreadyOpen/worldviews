// Offline icon data: no request to the Iconify API.
import { addIcon } from 'iconify-icon'
import buildings from '@iconify-icons/ph/buildings'
import warning from '@iconify-icons/ph/warning-circle'
import train from '@iconify-icons/ph/train'
import users from '@iconify-icons/ph/users-three'
import squares from '@iconify-icons/ph/squares-four'
import x from '@iconify-icons/ph/x'
import sliders from '@iconify-icons/ph/sliders-horizontal'
import arrow from '@iconify-icons/ph/arrow-right'
import sun from '@iconify-icons/ph/sun'
import moon from '@iconify-icons/ph/moon'
import desktop from '@iconify-icons/ph/desktop'
import search from '@iconify-icons/ph/magnifying-glass'
import globe from '@iconify-icons/ph/globe-hemisphere-east'
import check from '@iconify-icons/ph/check-bold'
import briefcase from '@iconify-icons/ph/briefcase'
import leaf from '@iconify-icons/ph/leaf'
import caretDown from '@iconify-icons/ph/caret-down'
import car from '@iconify-icons/ph/car'
import lightning from '@iconify-icons/ph/lightning'
import clock from '@iconify-icons/ph/clock'
import chat from '@iconify-icons/ph/chat-circle-dots'
import pin from '@iconify-icons/ph/map-pin'
import info from '@iconify-icons/ph/info'

Object.entries({ buildings, 'warning-circle': warning, train, 'users-three': users, 'squares-four': squares, x, 'sliders-horizontal': sliders,
  'arrow-right': arrow, sun, moon, desktop, 'magnifying-glass': search, 'globe-hemisphere-east': globe, 'check-bold': check, briefcase, leaf, 'caret-down': caretDown, car,
  lightning, clock, 'chat-circle-dots': chat, 'map-pin': pin, info }).forEach(([n, d]) => addIcon('ph:' + n, d))
addIcon('tabler:satellite', satellite)
addIcon('ph:airplane-takeoff', takeoffLine)

// Map point icons: the data keeps its coloured circle, and an
// Iconify icon is drawn on top as an SDF image. The <svg> is built by hand from the icon data: svgToURL(iconToHTML(...))
// produced an image Chrome refused to decode.
import pulse from '@iconify-icons/ph/pulse-bold'
import hurricane from '@iconify-icons/ph/hurricane-bold'
import drop from '@iconify-icons/ph/drop-bold'
import sunDim from '@iconify-icons/ph/sun-dim-bold'
import fire from '@iconify-icons/ph/fire-bold'
import mountains from '@iconify-icons/ph/mountains-bold'
import snowflake from '@iconify-icons/ph/snowflake-bold'
import warn from '@iconify-icons/ph/warning-bold'
import subway from '@iconify-icons/ph/subway-bold'
import satellite from '@iconify-icons/tabler/satellite'
import takeoff from '@iconify-icons/ph/airplane-takeoff-bold'
import takeoffLine from '@iconify-icons/ph/airplane-takeoff'
import helicopter from '@iconify-icons/tabler/helicopter'
import anchor from '@iconify-icons/ph/anchor-bold'
import balloon from '@iconify-icons/tabler/balloon'
import cone from '@iconify-icons/ph/traffic-cone-bold'
import school from '@iconify-icons/ph/graduation-cap-bold'
import firstAid from '@iconify-icons/ph/first-aid-bold'
import arrowR from '@iconify-icons/ph/arrow-right-bold'
import clockB from '@iconify-icons/ph/clock-bold'
import plug from '@iconify-icons/ph/plug-charging-bold'
export const MAP_ICONS: Record<string, { body: string; width?: number; height?: number }> = {
  'i-pulse': pulse, 'i-hurricane': hurricane, 'i-drop': drop, 'i-sun-dim': sunDim, 'i-fire': fire, 'i-mountains': mountains,
  'i-snowflake': snowflake, 'i-warning': warn, 'i-subway': subway, 'i-satellite': satellite,
  'i-plane': takeoff, 'i-heli': helicopter, 'i-anchor': anchor, 'i-balloon': balloon, 'i-cone': cone, 'i-school': school, 'i-first-aid': firstAid, 'i-arrow': arrowR, 'i-clock': clockB, 'i-plug': plug }

export async function iconImage(d: { body: string; width?: number; height?: number }, px = 64) {
  const w = d.width || 16, h = d.height || 16
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${w} ${h}" color="#fff">${d.body.replaceAll('currentColor', '#fff')}</svg>`
  const img = new Image(px, px)
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode()
  const c = document.createElement('canvas'); c.width = c.height = px
  const g = c.getContext('2d')!; g.drawImage(img, 0, 0, px, px)
  return g.getImageData(0, 0, px, px)
}
