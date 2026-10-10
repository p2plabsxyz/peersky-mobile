import type { ComponentType } from 'react'
import type { SvgProps } from 'react-native-svg'

import type { AddressBarButton } from './settings/useBrowserPreferences'
import BookmarkFillIcon from '../assets/icons/bootstrap/bookmark-fill.svg'
import BookmarkIcon from '../assets/icons/bootstrap/bookmark.svg'
import DashIcon from '../assets/icons/bootstrap/dash-lg.svg'
import DisplayIcon from '../assets/icons/bootstrap/display.svg'
import FileTextIcon from '../assets/icons/bootstrap/file-text.svg'
import PhoneIcon from '../assets/icons/bootstrap/phone.svg'
import PlusIcon from '../assets/icons/bootstrap/plus-lg.svg'
import PrinterIcon from '../assets/icons/bootstrap/printer.svg'
import ShareIcon from '../assets/icons/bootstrap/arrow-bar-up.svg'
import StarFillIcon from '../assets/icons/bootstrap/star-fill.svg'
import StarIcon from '../assets/icons/bootstrap/star.svg'
import ZoomIcon from '../assets/icons/bootstrap/zoom-in.svg'

// The glyphs the menu uses for each, so a button moved to the address bar is
// recognisably the one from the menu. Share keeps the address bar's own arrow.
export const ADDRESS_BAR_BUTTON_ICONS: Record<AddressBarButton, ComponentType<SvgProps>> = {
  share: ShareIcon,
  bookmark: BookmarkIcon,
  favourite: StarIcon,
  reader: FileTextIcon,
  send: PhoneIcon,
  zoom: ZoomIcon,
  desktop: DisplayIcon,
  print: PrinterIcon,
  'new-tab': PlusIcon,
  none: DashIcon
}

// Filled once the page is bookmarked or a favourite, as in the menu.
export const ADDRESS_BAR_BUTTON_ACTIVE_ICONS: Partial<Record<AddressBarButton, ComponentType<SvgProps>>> = {
  bookmark: BookmarkFillIcon,
  favourite: StarFillIcon
}
