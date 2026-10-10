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

Object.entries({ buildings, 'warning-circle': warning, train, 'users-three': users, 'squares-four': squares, x, 'sliders-horizontal': sliders,
  'arrow-right': arrow, sun, moon, desktop, 'magnifying-glass': search, 'globe-hemisphere-east': globe, 'check-bold': check }).forEach(([n, d]) => addIcon('ph:' + n, d))
