// Sites with cookies or data on the phone, as Settings lists them. The app's
// own loopback pages are never among them: PeerTunes keeps its library there.
const APP_OWN_HOSTS = new Set(['127.0.0.1', 'localhost'])
export const MAX_SITE_DATA_HOSTS = 500

/**
 * The sites Android is asked about, since it keeps no list of the ones with
 * cookies: the websites in history, open tabs and bookmarks, by host. iOS
 * lists its own and needs none of these.
 */
export function getSiteDataHosts (urls) {
  const hosts = []
  const seen = new Set()
  for (const url of urls || []) {
    let host = ''
    try {
      const parsed = new URL(String(url || ''))
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue
      host = parsed.hostname.toLowerCase()
    } catch {
      continue
    }
    if (!host || APP_OWN_HOSTS.has(host) || seen.has(host)) continue
    seen.add(host)
    hosts.push(host)
    if (hosts.length === MAX_SITE_DATA_HOSTS) break
  }
  return hosts
}

/** What the phone answered, once each, in order by name. */
export function normalizeSiteDataList (value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const sites = []
  for (const item of value) {
    const name = typeof item?.name === 'string' ? item.name.trim().toLowerCase() : ''
    if (!/^[\p{L}\p{N}._-]{1,253}$/u.test(name) || APP_OWN_HOSTS.has(name) || seen.has(name)) continue
    seen.add(name)
    sites.push({ name, cookies: item.cookies === true, storage: item.storage === true })
  }
  return sites.sort((a, b) => sortName(a.name).localeCompare(sortName(b.name)))
}

export function describeSiteData (site) {
  if (site.cookies && site.storage) return 'Cookies and site data'
  if (site.cookies) return 'Cookies'
  if (site.storage) return 'Site data'
  return 'Cached files'
}

export function filterSiteData (sites, query) {
  const text = String(query || '').trim().toLowerCase()
  return text ? sites.filter((site) => site.name.includes(text)) : sites
}

// www.example.com sits with example.com.
function sortName (name) {
  return name.replace(/^www[.]/, '')
}
