// Titles, shows, episodes and dates read from file and folder names. Pure.
import { KINDS, extensionOf, fileName } from './kinds.js'

// Names longer than this are cut first, so a hostile name costs little.
const MAX_NAME = 512

const KNOWN_EXTENSIONS = new Set([...Object.values(KINDS).flat(), 'nfo'])

// A strong tag ends the title: everything after it is release detail.
const STRONG_TAGS = new Set(('2160p 1080p 720p 576p 480p 360p 4k uhd hdr10 hdr10+ x264 x265 h264 h265 h.264 h.265 ' +
  'hevc av1 10bit web-dl webdl webrip web-rip bluray blu-ray brrip bdrip bdremux remux dvdrip hdtv hdrip ' +
  'ddp5.1 ddp2.0 dd5.1 dd2.0 eac3 ac3 dts-hd truehd aac2.0 aac5.1 xvid divx').split(' '))
// A weak tag is also an ordinary word ("Charlotte's Web"), so it only goes
// after a year or a strong tag, or at the end of a name that has one.
const WEAK_TAGS = new Set(('web hdr dv avc aac dts atmos proper repack extended remastered unrated directors.cut ' +
  'multi subs imax internal limited').split(' '))

const BRACKETS = /\[[^\]]*\]|\{[^}]*\}|【[^】]*】/g

function stripExtension (name) {
  const extension = extensionOf(name)
  return extension && KNOWN_EXTENSIONS.has(extension) ? name.slice(0, -(extension.length + 1)) : name
}

const tokensOf = (text) => text.split(/[\s._]+/).filter(Boolean)
const core = (token) => token.replace(/^[-([{]+|[)\]}]+$/g, '').toLowerCase()
const isDash = (token) => /^-+$/.test(token)

function tagKind (word) {
  // x264-GROUP is a tag followed by the group that made the release.
  for (let depth = 0; word && depth < 4; depth++) {
    if (STRONG_TAGS.has(word) || /^\d{3,4}p$/.test(word)) return 'strong'
    if (WEAK_TAGS.has(word)) return 'weak'
    const dash = word.lastIndexOf('-')
    if (dash <= 0) return null
    word = word.slice(0, dash)
  }
  return null
}

// The tag at tokens[i], also one the dots split in two: H.264, DDP5.1.
function tagAt (tokens, i) {
  if (i + 1 < tokens.length) {
    const kind = tagKind(core(tokens[i]) + '.' + core(tokens[i + 1]))
    if (kind) return { kind, span: 2 }
  }
  const kind = tagKind(core(tokens[i]))
  return kind ? { kind, span: 1 } : null
}

function yearOf (token) {
  const match = /^[([]?((?:19|20)\d{2})[)\]]?$/.exec(token)
  if (!match) return null
  const year = Number(match[1])
  return year <= new Date().getUTCFullYear() + 1 ? year : null
}

// The first strong tag after the first word, or the end. What follows an
// episode number may start with one: there is no episode title then.
function tagCut (tokens, from = 1) {
  for (let i = from; i < tokens.length; i++) {
    const tag = tagAt(tokens, i)
    if (tag && tag.kind === 'strong') return i
  }
  return tokens.length
}

function cleanWords (text, from = 1) {
  const tokens = tokensOf(String(text).replace(BRACKETS, ' '))
  const cut = tagCut(tokens, from)
  let words = tokens.slice(0, cut)
  let yearIndex = -1
  for (let i = 1; i < words.length; i++) if (yearOf(words[i])) yearIndex = i
  if (yearIndex > 0) {
    const kept = []
    for (let i = 0; i < words.length;) {
      const tag = i > yearIndex ? tagAt(words, i) : null
      if (tag) {
        i += tag.span
        continue
      }
      kept.push(words[i++])
    }
    words = kept
  }
  // What follows an episode number is release detail too.
  if (cut < tokens.length || yearIndex > 0 || from === 0) {
    // A title keeps its first word, but an episode's may be only tags.
    const keep = Math.min(from, 1)
    for (;;) {
      const n = words.length
      const pair = n >= keep + 2 ? tagAt(words, n - 2) : null
      if (pair && pair.span === 2) words.length -= 2
      else if (n >= keep + 1 && (isDash(words[n - 1]) || tagKind(core(words[n - 1])))) words.length -= 1
      else break
    }
  }
  while (words.length && isDash(words[0])) words.shift()
  while (words.length && isDash(words[words.length - 1])) words.pop()
  return words.join(' ')
}

/**
 * A readable title from a file name: no extension, no release tags (1080p,
 * x264, WEB-DL, ...), no [group] tags, dots and underscores as spaces, the
 * case as it was.
 */
export function cleanTitle (name) {
  const base = stripExtension(fileName(name)).slice(0, MAX_NAME)
  return cleanWords(base) || base.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim() || base
}

// A show name, with a year at its end taken off: "Show (2019)".
function showOf (text) {
  const words = tokensOf(cleanWords(text))
  const year = words.length > 1 ? yearOf(words[words.length - 1]) : null
  if (year) words.pop()
  const name = words.join(' ')
  return name ? { name, year } : null
}

const SEASON_FOLDER = /^(?:season|series|s)[ ._-]*(\d{1,3})$/i

function seasonOfFolder (folder) {
  const text = String(folder ?? '').trim()
  if (/^specials$/i.test(text)) return 0
  const match = SEASON_FOLDER.exec(text)
  return match ? Number(match[1]) : null
}

const SEASON_EPISODE = /(^|[^a-z0-9])s(\d{1,3})[ ._-]?e(\d{1,4})((?:-?e\d{1,4}|-\d{1,4})*)(?![0-9a-z])/i
const CROSS = /(^|[^a-z0-9])(\d{1,2})x(\d{2,3})((?:-x?\d{2,3})*)(?![0-9a-z])/i
const ANIME = /^\s*\[[^\]]{0,100}\]\s*(.+?)\s+-\s+(\d{1,4})(?:v\d)?((?:\s*-\s*\d{1,4}(?=$|[\s[(]))?)(?=$|[\s[(])/
const EPISODE_WORD = /(^|[^a-z0-9])(?:episode|ep)[ ._-]*(\d{1,4})(?![0-9a-z])/i
const BARE_EPISODE = /(^|[^a-z0-9])e(\d{2,3})(?![0-9a-z])/i
const SEASON_WORD = /(^|[^a-z0-9])(?:season|series)[ ._-]*(\d{1,3})(?![0-9a-z])/i
const NUMBER_FIRST = /^(\d{1,3})(?:[ ._-]+(.*))?$/

function lastNumber (text) {
  const match = /(\d+)\D*$/.exec(text || '')
  return match ? Number(match[1]) : null
}

function around (name, match) {
  const start = match.index + match[1].length
  return { before: name.slice(0, start), after: name.slice(match.index + match[0].length) }
}

function matchEpisode (name, inSeasonFolder) {
  let match = SEASON_EPISODE.exec(name)
  if (match) return { ...around(name, match), season: Number(match[2]), episode: Number(match[3]), episodeEnd: lastNumber(match[4]) }
  match = CROSS.exec(name)
  if (match) return { ...around(name, match), season: Number(match[2]), episode: Number(match[3]), episodeEnd: lastNumber(match[4]) }
  match = ANIME.exec(name)
  if (match) {
    // "[Group] Show S2 - 03": the season is at the end of the show's name.
    const season = /\sS(\d{1,2})$/i.exec(match[1])
    return {
      before: season ? match[1].slice(0, season.index) : match[1],
      after: name.slice(match[0].length),
      season: season ? Number(season[1]) : null,
      episode: Number(match[2]),
      episodeEnd: lastNumber(match[3])
    }
  }
  match = EPISODE_WORD.exec(name) || (inSeasonFolder ? BARE_EPISODE.exec(name) : null)
  if (match) {
    const { before, after } = around(name, match)
    const season = SEASON_WORD.exec(before)
    return {
      before: season ? before.slice(0, season.index + season[1].length) : before,
      after,
      season: season ? Number(season[2]) : null,
      episode: Number(match[2]),
      episodeEnd: null
    }
  }
  match = inSeasonFolder ? NUMBER_FIRST.exec(name) : null
  if (match) return { before: '', after: match[2] || '', season: null, episode: Number(match[1]), episodeEnd: null }
  return null
}

/**
 * What a video's name and folders say about it: a movie's title and year, or
 * an episode's show, season, episode (and the last one, for a file holding
 * two) and title. Every field may be null.
 */
export function parseVideoName (path) {
  const parts = String(path ?? '').split('/').filter(Boolean)
  const name = stripExtension(parts.pop() || '').slice(0, MAX_NAME)
  const parent = parts.length ? parts[parts.length - 1].slice(0, MAX_NAME) : ''
  const grandparent = parts.length > 1 ? parts[parts.length - 2].slice(0, MAX_NAME) : ''
  const folderSeason = seasonOfFolder(parent)
  const result = { title: null, year: null, show: null, season: null, episode: null, episodeEnd: null, episodeTitle: null, isEpisode: false }

  const found = matchEpisode(name, folderSeason !== null)
  if (found || folderSeason !== null) {
    // A show folder holding season folders names the show best; then the
    // file's own name; then the folder the file is in.
    const show = (folderSeason !== null && showOf(grandparent)) || (found && showOf(found.before)) ||
      (folderSeason === null && parent ? showOf(parent) : null)
    result.isEpisode = true
    result.show = show ? show.name : null
    result.year = show ? show.year : null
    result.season = found && found.season !== null ? found.season : folderSeason
    result.episode = found ? found.episode : null
    result.episodeEnd = found && found.episodeEnd > found.episode ? found.episodeEnd : null
    result.episodeTitle = found ? cleanWords(found.after, 0) || null : cleanTitle(name) || null
    result.title = result.episodeTitle || result.show || cleanTitle(name)
    return result
  }

  const tokens = tokensOf(name)
  const cut = tagCut(tokens)
  for (let i = cut - 1; i >= 1; i--) {
    const year = yearOf(tokens[i])
    if (!year) continue
    const title = cleanWords(tokens.slice(0, i).join(' '))
    if (title) {
      result.title = title
      result.year = year
      return result
    }
  }
  result.title = cleanTitle(name)
  return result
}

function wallClock (year, month, day, hour, minute, second) {
  const values = [year, month, day, hour, minute, second].map(Number)
  const [y, mo, d, h, mi, s] = values
  if (values.some((value) => !Number.isInteger(value))) return null
  if (y < 1900 || y > new Date().getUTCFullYear() + 1) return null
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null
  const time = Date.UTC(y, mo - 1, d, h, mi, s)
  // Date.UTC rolls 30 February over into March.
  return new Date(time).getUTCDate() === d ? time : null
}

const NAME_TIME_12H = /(?:^|[^0-9])((?:19|20)\d{2})-(\d{2})-(\d{2}) at (\d{1,2})[.:](\d{2})[.:](\d{2})\s*([ap])\.?m\b/i
const NAME_TIME = /(?:^|[^0-9])((?:19|20)\d{2})([-_.]?)(\d{2})\2(\d{2})(?:[ _T-]|[ _-]?at[ _]|)(\d{2})([-_.:]?)(\d{2})\6(\d{2})(?:[-_.]?\d{3})?(?![0-9])/i
const NAME_WHATSAPP = /(?:^|[^0-9])((?:19|20)\d{2})(\d{2})(\d{2})-WA\d{1,6}/i
const NAME_DAY = /(?:^|[^0-9])((?:19|20)\d{2})-(\d{2})-(\d{2})(?![0-9])/

// Pixel phones write the time in UTC: PXL_20250322_073000123.jpg.
const UTC_NAME = /^PXL_\d{8}_\d{9}(?!\d)/i

/**
 * Whether the time in this name is UTC rather than wall-clock time. For
 * these, dateFromName() gives a real instant: turn it into wall-clock time
 * like a Takeout time (wallClockOf in sidecars.js), with the EXIF offset when
 * known, else this device's own.
 */
export function isUtcName (name) {
  return UTC_NAME.test(fileName(name))
}

/**
 * The time a phone or app wrote into a file name, as Date.UTC() of what the
 * name says, or null. That is wall-clock time, except for names isUtcName()
 * accepts (Pixel's), where it is a real UTC instant. A name with only a date
 * is taken at noon.
 */
export function dateFromName (name) {
  const text = fileName(name).slice(0, MAX_NAME)
  let match = NAME_TIME_12H.exec(text)
  if (match) {
    const hour = Number(match[4])
    if (hour >= 1 && hour <= 12) {
      const time = wallClock(match[1], match[2], match[3], (hour % 12) + (/p/i.test(match[7]) ? 12 : 0), match[5], match[6])
      if (time !== null) return time
    }
  }
  match = NAME_TIME.exec(text)
  if (match) {
    const time = wallClock(match[1], match[3], match[4], match[5], match[7], match[8])
    if (time !== null) return time
  }
  match = NAME_WHATSAPP.exec(text) || NAME_DAY.exec(text)
  return match ? wallClock(match[1], match[2], match[3], 12, 0, 0) : null
}
