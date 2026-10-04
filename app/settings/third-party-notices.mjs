// Reads assets/licenses/third-party-notices.txt, which
// scripts/generate-third-party-notices.mjs writes. Kept apart from the screen
// so a test can check the shipped file the way the app reads it.

// Sections whose libraries ship on one platform only. Each app lists its own,
// and the App Store turns down an iOS app that names other mobile platforms.
const PLATFORM_ONLY_SECTIONS = { ios: 'ios', android: 'android', rust: 'android' }

/**
 * The sections of the licenses screen, each item with its license text,
 * or an error when the file is not what the generator writes. Given a
 * platform, sections for the other platform are left out.
 */
export function parseThirdPartyNotices (text, platform) {
  const parsed = JSON.parse(text)
  if (parsed?.version !== 1 || !Array.isArray(parsed.sections) || !Array.isArray(parsed.texts)) {
    throw new Error('The licenses file is not one PeerSky can read.')
  }
  const shipped = parsed.sections.filter((section) => {
    const only = PLATFORM_ONLY_SECTIONS[section.id]
    return !platform || !only || only === platform
  })
  const sections = shipped.map((section) => ({
    id: String(section.id),
    title: String(section.title),
    data: section.items.map((item) => {
      const text = parsed.texts[item.text]
      if (typeof text !== 'string' || !text) throw new Error(`No license text for ${item.name}`)
      return {
        key: `${section.id}:${item.name}@${item.version}`,
        name: String(item.name),
        version: String(item.version || ''),
        license: String(item.license || ''),
        url: typeof item.url === 'string' && /^https:\/\//.test(item.url) ? item.url : '',
        text
      }
    })
  }))
  const count = sections.reduce((total, section) => total + section.data.length, 0)
  return { sections, count }
}

/** "1.2.3 · MIT", or just the license when there is no version. */
export function describeNotice (item) {
  return item.version ? `${item.version} · ${item.license}` : item.license
}

/**
 * A license text in pieces of about `size` characters, split between
 * paragraphs or lines. One text view hundreds of thousands of characters tall
 * can draw blank on iOS, and a few of these notices are that long.
 */
export function splitNoticeText (text, size = 2000) {
  const pieces = []
  let current = ''
  for (const line of String(text).split('\n')) {
    if (current && current.length + line.length + 1 > size) {
      pieces.push(current)
      current = ''
    }
    current = current ? `${current}\n${line}` : line
    while (current.length > size) {
      pieces.push(current.slice(0, size))
      current = current.slice(size)
    }
  }
  if (current) pieces.push(current)
  return pieces
}
