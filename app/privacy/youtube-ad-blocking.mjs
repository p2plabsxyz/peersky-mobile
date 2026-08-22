import {
  YOUTUBE_AD_BREAK_PATH,
  YOUTUBE_ISOLATED_SCRIPTLETS,
  YOUTUBE_MAIN_SCRIPTLETS
} from './generated/youtube-ad-blocking-scriptlets.mjs'

const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtube-nocookie.com'])

export function isYoutubeUrl (value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    return [...YOUTUBE_HOSTS].some((host) => (
      url.hostname === host || url.hostname.endsWith(`.${host}`)
    ))
  } catch {
    return false
  }
}

export function createYoutubeAdBlockingScript ({ enabled = false, url = '' } = {}) {
  if (!enabled || !isYoutubeUrl(url)) return 'true'
  return `${YOUTUBE_MAIN_SCRIPTLETS};\n${YOUTUBE_ISOLATED_SCRIPTLETS};\ntrue`
}

export { YOUTUBE_AD_BREAK_PATH }
