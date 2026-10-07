import type { ComponentType } from 'react'
import type { SvgProps } from 'react-native-svg'

import type { ToolbarButton } from './settings/useBrowserPreferences'
import BookmarkFillIcon from '../assets/icons/bootstrap/bookmark-fill.svg'
import BookmarkIcon from '../assets/icons/bootstrap/bookmark.svg'
import BookmarksIcon from '../assets/icons/bootstrap/bookmarks.svg'
import DownloadIcon from '../assets/icons/bootstrap/download.svg'
import FireIcon from '../assets/icons/bootstrap/fire.svg'
import GearIcon from '../assets/icons/bootstrap/gear.svg'
import HistoryIcon from '../assets/icons/bootstrap/clock-history.svg'
import HouseIcon from '../assets/icons/bootstrap/house.svg'
import IncognitoIcon from '../assets/icons/bootstrap/incognito.svg'
import PlusIcon from '../assets/icons/bootstrap/plus-lg.svg'
import ShareIcon from '../assets/icons/bootstrap/share.svg'
import StarFillIcon from '../assets/icons/bootstrap/star-fill.svg'
import StarIcon from '../assets/icons/bootstrap/star.svg'
import ZoomIcon from '../assets/icons/bootstrap/zoom-in.svg'

// The same glyphs the menu uses for each of these, so a button moved to the
// bar is recognisably the one from the menu.
export const TOOLBAR_BUTTON_ICONS: Record<ToolbarButton, ComponentType<SvgProps>> = {
  bookmark: BookmarkIcon,
  favourite: StarIcon,
  bookmarks: BookmarksIcon,
  burn: FireIcon,
  downloads: DownloadIcon,
  history: HistoryIcon,
  home: HouseIcon,
  incognito: IncognitoIcon,
  'new-tab': PlusIcon,
  settings: GearIcon,
  share: ShareIcon,
  zoom: ZoomIcon
}

// Filled once the page is bookmarked or a favourite, as in the menu.
export const TOOLBAR_BUTTON_ACTIVE_ICONS: Partial<Record<ToolbarButton, ComponentType<SvgProps>>> = {
  bookmark: BookmarkFillIcon,
  favourite: StarFillIcon
}
