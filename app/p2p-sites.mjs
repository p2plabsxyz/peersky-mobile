// The hyper:// sites this phone has opened, for peersky://p2p: one line per
// site, under its title rather than its key, newest first. They come from
// browser history, so a private tab adds nothing and clearing history clears
// them. The pages opened stay in the phone's Hyper storage, so they open again
// without a connection.

const MAX_P2P_SITE_QUERY_LENGTH = 128

export function normalizeP2pSiteQuery (value) {
  return String(value || '').trim().toLocaleLowerCase().slice(0, MAX_P2P_SITE_QUERY_LENGTH)
}

// The site a page belongs to: its drive's root, and a short name for one with
// no title yet.
export function p2pSiteOf (url) {
  let parsed
  try {
    parsed = new URL(String(url || ''))
  } catch {
    return null
  }
  if (parsed.protocol !== 'hyper:' || !parsed.host) return null
  const host = parsed.host.toLowerCase()
  const label = host.length > 24 ? `${host.slice(0, 8)}…${host.slice(-4)}` : host
  return { url: `hyper://${host}/`, label, isRoot: parsed.pathname === '/' || parsed.pathname === '' }
}

// A title worth showing: history keeps the address when a page had none.
function realTitle (title, url) {
  const value = String(title || '').trim()
  if (!value || value === url || /^hyper:\/\//i.test(value)) return ''
  return value
}

/**
 * Each site once, newest first. A site is named by its home page's title when
 * that was opened, otherwise by the newest page's, otherwise by a short form of
 * its key. Its line opens the page it is named by, or the newest page: a phone
 * only keeps the pages it opened, so the home page of a site seen only through
 * one inner page would not open offline. Searching matches the names shown.
 */
export function listP2pSites (historyItems, query = '') {
  const sites = new Map()
  for (const item of Array.isArray(historyItems) ? historyItems : []) {
    const site = p2pSiteOf(item?.url)
    if (!site) continue
    const title = realTitle(item.title, item.url)
    const known = sites.get(site.url)
    if (!known) {
      sites.set(site.url, {
        url: site.url,
        label: site.label,
        newestUrl: item.url,
        pageTitle: title,
        pageUrl: title ? item.url : '',
        homeTitle: site.isRoot ? title : '',
        visitedAt: Number(item.visitedAt) || 0
      })
      continue
    }
    if (!known.pageTitle && title) {
      known.pageTitle = title
      known.pageUrl = item.url
    }
    if (site.isRoot && !known.homeTitle) known.homeTitle = title
    known.visitedAt = Math.max(known.visitedAt, Number(item.visitedAt) || 0)
  }

  const wanted = normalizeP2pSiteQuery(query)
  return [...sites.values()]
    .map((site) => ({
      url: site.homeTitle ? site.url : site.pageUrl || site.newestUrl,
      title: site.homeTitle || site.pageTitle || site.label,
      visitedAt: site.visitedAt
    }))
    .filter((site) => !wanted || site.title.toLocaleLowerCase().includes(wanted))
    .sort((a, b) => b.visitedAt - a.visitedAt)
}
