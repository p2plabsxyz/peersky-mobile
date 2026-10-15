/* eslint-env browser */
/* eslint-disable import/no-absolute-path */
import { h, icon, iconButton, button, toast, copyWithToast, openMenu, stateView, skeleton, lazyChunks, debounce, replace, kindBadge, prefersReducedMotion } from '/hyperdrive/viewer/ui.js'
import { t, tp, formatBytes, formatRuntime, formatNumber, formatList, formatDate, compareText, languageName, getLanguage } from '/hyperdrive/viewer/i18n.js'
import { kindOf, isJunk, isImageKind, sidecarsOf, livePhotoPairs, naturalCompare, baseName, fileName, folderOf, extensionOf, folderIndex } from '/hyperdrive/viewer/lib/kinds.js'
import { parseVideoName, cleanTitle, dateFromName, isUtcName } from '/hyperdrive/viewer/lib/names.js'
import { nfoFor, parseNfo, wallClockOf } from '/hyperdrive/viewer/lib/sidecars.js'
import { subtitlesFor } from '/hyperdrive/viewer/lib/subtitles.js'
import { canPlay } from '/hyperdrive/viewer/player.js'

// Videos: a library like a streaming app's, made only from the folder's own
// files and what they say about themselves.
//
// - Shows come from file names and season folders (lib/names.js), the show,
//   season and episode written inside MP4 and MKV files (lib/video-meta.js)
//   and Kodi .nfo files (lib/sidecars.js).
// - Movies are single files with a title and a year, an .nfo, artwork of
//   their own or a home in a Movies folder.
// - What is left is grouped by the top-level folder it is in.
//
// Titles take what the file says first, then its .nfo, then its cleaned
// name. A hero shows the newest show or movie, rows below it scroll
// sideways, and each show and movie has a page of its own in the address
// (#show=, #movie=), so Back works. Watching goes through the shell's
// player (#item=), which keeps the progress the rows show.
//
// What is read from inside the files goes through the thumbs queues and is
// kept in the store, which keeps nothing on disk for a private drive.

const STYLE_HREF = '/hyperdrive/viewer/videos.css'
// Cards a row makes at a time, as it is scrolled.
const BATCH = 24
const RECENT_MAX = 20
const CONTINUE_MAX = 20
// Files read in the background for their details; others when seen.
const BACKGROUND_META = 300
const FIRST_META = 60
const MAX_NFO = 300
const NFO_BYTES = 256 * 1024
const NFO_VERSION = 1
// How long the first screen waits for details that are kept already.
const FIRST_WAIT = 450
// The same rule as the player's: far enough in, not at the very end.
const RESUME_FROM = 15
const RESUME_UNTIL = 20

const PICTURES = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'])
const MOVIE_FOLDER = /^(?:movies?|films?)$/i
const SEASON_FOLDER = /^(?:season|series|s)[ ._-]*(\d{1,3})$/i
const SPECIALS_FOLDER = /^specials$/i
// Artwork that belongs to a whole folder rather than one video in it.
const FOLDER_ART = new Set(['poster', 'folder', 'cover', 'fanart', 'backdrop', 'background', 'landscape', 'banner', 'logo', 'clearart', 'clearlogo', 'thumb', 'disc', 'discart'])
const SHAPES = { frame: 16 / 9, poster: 2 / 3, tall: 9 / 16 }

// Codec names people know, by the code the file gives.
const CODECS = {
  avc1: 'H.264',
  avc3: 'H.264',
  hvc1: 'HEVC',
  hev1: 'HEVC',
  av01: 'AV1',
  vp09: 'VP9',
  vp8: 'VP8',
  mp4v: 'MPEG-4',
  mp2v: 'MPEG-2',
  theora: 'Theora',
  mp4a: 'AAC',
  'ac-3': 'AC-3',
  'ec-3': 'E-AC-3',
  opus: 'Opus',
  alac: 'ALAC',
  flac: 'FLAC',
  mp3: 'MP3',
  mp2: 'MP2',
  dts: 'DTS',
  truehd: 'TrueHD',
  lpcm: 'PCM',
  vorbis: 'Vorbis'
}

function codecName (code) {
  if (!code) return ''
  return CODECS[code] || String(code).toUpperCase().slice(0, 16)
}

// 4K or HD by the picture's size, whichever way up it is.
function qualityOf (width, height) {
  const long = Math.max(Number(width) || 0, Number(height) || 0)
  const short = Math.min(Number(width) || 0, Number(height) || 0)
  if (long >= 3200 || short >= 2000) return '4k'
  if (long >= 1280 || short >= 720) return 'hd'
  return null
}

function qualityLabel (quality) {
  if (quality === '4k') return t('4K')
  if (quality === 'hd') return t('HD')
  return ''
}

// A name to compare by: no case, no year at the end, letters and digits only.
function nameKey (text) {
  return String(text || '').toLowerCase().replace(/[([]?\b(?:19|20)\d{2}\b[)\]]?\s*$/, '').replace(/[^\p{L}\p{N}]+/gu, '')
}

// A folder's name as a title: "Show (2019)" reads "Show".
const folderTitles = new Map()
function folderTitleOf (folder) {
  let title = folderTitles.get(folder)
  if (title === undefined) {
    const name = fileName(folder)
    title = cleanTitle(name).replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/, '').trim() || name
    if (folderTitles.size > 5000) folderTitles.clear()
    folderTitles.set(folder, title)
  }
  return title
}

// Words phones and apps put around the date in a video's name.
const NAME_WORDS = new Set(['vid', 'img', 'pxl', 'mov', 'mvimg', 'video', 'whatsapp', 'screen', 'recording', 'screenrecording', 'screenrecorder', 'rpreplay', 'final', 'signal', 'trim', 'at', 'wa'])

// A name that is only a date, like VID_20250412_183005, reads as the time
// it was filmed.
function datedTitle (name) {
  const when = dateFromName(name)
  if (when === null) return null
  const words = baseName(name).toLowerCase().split(/[^a-z]+/).filter(Boolean)
  if (!words.every((word) => NAME_WORDS.has(word))) return null
  const time = isUtcName(name) ? wallClockOf(when, null) : when
  return formatDate(time, { utc: true, style: /-wa\d+/i.test(name) ? 'date' : 'datetime' })
}

function firstNumber (...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value
  }
  return null
}

// The value most of them have, the first one on a tie.
function mostCommon (values) {
  const counts = new Map()
  let best = null
  let bestCount = 0
  for (const value of values) {
    if (!value) continue
    const count = (counts.get(value) || 0) + 1
    counts.set(value, count)
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

function yearText (year) {
  return Number.isFinite(year) ? formatNumber(year, { useGrouping: false }) : ''
}

function resumable (progress) {
  return Boolean(progress) && !progress.done && progress.position > RESUME_FROM &&
    (!(progress.duration > 0) || progress.position < progress.duration - RESUME_UNTIL)
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The view's own styles, once per page.
let styles = null
function loadStyles () {
  if (styles) return styles
  const link = h('link', { rel: 'stylesheet', href: STYLE_HREF })
  styles = new Promise((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true })
    link.addEventListener('error', () => resolve(), { once: true })
    setTimeout(resolve, 2000)
  })
  document.head.append(link)
  return styles
}

function subtitleLabel (sub, index) {
  const name = (sub.language && languageName(sub.language)) || t('Subtitles {number}', { number: index + 1 })
  if (sub.forced) return t('{language} (forced)', { language: name })
  if (sub.sdh) return t('{language} (SDH)', { language: name })
  return name
}

export async function mount (ctx) {
  const { source, store, thumbs, listing, route, shell } = ctx
  const host = route.host
  const base = route.path
  const entries = listing.entries
  const html = document.documentElement
  const phone = source.platform !== 'desktop'
  const rtl = () => html.dir === 'rtl'
  const signal = ctx.signal

  shell.setDark(true)
  const waiting = h('div', { class: 'hd-vid-waiting' }, skeleton({ count: 8 }))
  ctx.root.append(waiting)
  await loadStyles()
  if (signal.aborted) return {}

  // ---------- What is in the folder ----------

  const sidecars = sidecarsOf(entries, base)
  const livePairs = livePhotoPairs(entries, base)
  const motions = new Set(livePairs.values())
  const videos = []
  const strays = []
  const byPath = new Map()
  for (const entry of entries) {
    if (!entry.path.startsWith(base) || isJunk(entry.path.slice(base.length - 1))) continue
    byPath.set(entry.path, entry)
    if (sidecars.has(entry.path) || motions.has(entry.path)) continue
    const kind = kindOf(entry.path, entry.size)
    if (kind === 'video') videos.push(entry)
    else if (isImageKind(kind)) strays.push(entry)
  }
  videos.sort((a, b) => naturalCompare(a.path, b.path))
  strays.sort((a, b) => naturalCompare(a.path, b.path))
  const otherPaths = ((ctx.classification && ctx.classification.others) || []).filter((path) => byPath.has(path))
  const index = folderIndex(entries)

  // How many of the library's videos sit directly in each folder.
  const videoCount = new Map()
  for (const video of videos) {
    const folder = folderOf(video.path)
    videoCount.set(folder, (videoCount.get(folder) || 0) + 1)
  }

  // ---------- What each video says about itself ----------

  const parsedNames = new Map()
  const nfoPaths = new Map()
  const metas = new Map()
  const nfos = new Map()
  const described = new Map()

  function parsedOf (path) {
    let parsed = parsedNames.get(path)
    if (!parsed) {
      parsed = parseVideoName(path)
      parsedNames.set(path, parsed)
    }
    return parsed
  }

  // Folders with an .nfo in them; only their videos are looked up, which
  // keeps a big flat folder from being searched once per video.
  const nfoFolders = new Set()
  for (const entry of byPath.values()) {
    if (extensionOf(entry.path) === 'nfo') nfoFolders.add(folderOf(entry.path))
  }

  function nfoPathsOf (path) {
    let found = nfoPaths.get(path)
    if (!found) {
      const folder = folderOf(path)
      found = nfoFolders.has(folder) || nfoFolders.has(folderOf(folder)) ? nfoFor(path, entries) : { path: null, showPath: null }
      nfoPaths.set(path, found)
    }
    return found
  }

  /**
   * Everything known about one video: its name, what the file holds and
   * its .nfo, merged in that order of trust (the file, the .nfo, the name).
   */
  function describe (video) {
    let info = described.get(video.path)
    if (info) return info
    const parsed = parsedOf(video.path)
    const meta = metas.get(video.path) || null
    const paths = nfoPathsOf(video.path)
    const nfo = (paths.path && nfos.get(paths.path)) || null
    const showNfo = (paths.showPath && nfos.get(paths.showPath)) || null
    const name = fileName(video.path)
    // Some tools write the file's name as its title, which says nothing.
    const ownTitle = meta && meta.title && meta.title.toLowerCase() !== baseName(name).toLowerCase() ? meta.title : null
    const metaEpisode = Boolean(meta && (meta.show || (Number.isFinite(meta.season) && Number.isFinite(meta.episode))))
    const nfoEpisode = Boolean(nfo && (Number.isFinite(nfo.episode) || (nfo.show && Number.isFinite(nfo.season))))
    const isEpisode = metaEpisode || nfoEpisode || parsed.isEpisode
    info = {
      entry: video,
      path: video.path,
      name,
      parsed,
      meta,
      nfo,
      showNfo,
      isEpisode,
      showName: (meta && meta.show) || (nfo && nfo.show) || (showNfo && showNfo.title) || parsed.show || null,
      season: firstNumber(meta && meta.season, nfo && nfo.season, parsed.season),
      episode: firstNumber(meta && meta.episode, nfo && nfo.episode, parsed.episode),
      episodeEnd: parsed.episodeEnd,
      // An episode's own title, when anything says it.
      episodeTitle: isEpisode ? ownTitle || (nfo && nfo.title) || parsed.episodeTitle || null : null,
      title: ownTitle || (nfo && nfo.title) || (isEpisode ? parsed.episodeTitle : datedTitle(name)) || parsed.title || cleanTitle(name) || name,
      year: firstNumber(meta && meta.year, nfo && nfo.year, parsed.year),
      description: (meta && meta.description) || (nfo && nfo.plot) || null,
      genre: (meta && meta.genre) || (nfo && nfo.genre) || null,
      originalTitle: nfo && nfo.originalTitle && nfo.originalTitle !== nfo.title ? nfo.originalTitle : null,
      duration: meta && Number.isFinite(meta.duration) && meta.duration > 0 ? meta.duration : null,
      width: (meta && meta.width) || null,
      height: (meta && meta.height) || null,
      mtime: Number.isFinite(video.mtime) ? video.mtime : null
    }
    described.set(video.path, info)
    return info
  }

  function infoAt (path) {
    const entry = byPath.get(path)
    return entry ? describe(entry) : null
  }

  // ---------- Artwork beside the videos ----------

  const folderPictures = new Map()
  function picturesIn (folder) {
    let found = folderPictures.get(folder)
    if (!found) {
      found = (index.files.get(folder) || []).filter((entry) => PICTURES.has(extensionOf(entry.path)))
      folderPictures.set(folder, found)
    }
    return found
  }

  // The first picture in a folder named one of names, by their order.
  function artNamed (folder, names) {
    if (!folder) return null
    const wanted = names.filter(Boolean).map((name) => name.toLowerCase())
    let best = null
    let rank = Infinity
    for (const entry of picturesIn(folder)) {
      const at = wanted.indexOf(baseName(entry.path).toLowerCase())
      if (at !== -1 && at < rank) {
        best = entry
        rank = at
      }
    }
    return best
  }

  // A movie's or a clip's own artwork: named after it, or the folder's when
  // it is the only video there.
  const ownArt = new Map()
  function ownArtOf (path) {
    let art = ownArt.get(path)
    if (!art) {
      art = findOwnArt(path)
      ownArt.set(path, art)
    }
    return art
  }

  function findOwnArt (path) {
    const folder = folderOf(path)
    const stem = baseName(path)
    const alone = (videoCount.get(folder) || 0) <= 1
    return {
      poster: artNamed(folder, [`${stem}-poster`, alone && 'poster', alone && 'folder', alone && 'cover']),
      backdrop: artNamed(folder, [`${stem}-fanart`, `${stem}-backdrop`, `${stem}-landscape`, alone && 'fanart', alone && 'backdrop', alone && 'background', alone && 'landscape']),
      thumb: artNamed(folder, [`${stem}-thumb`, stem])
    }
  }

  // What thumbs.js may look through for a video's artwork. A folder of
  // several videos keeps its folder-wide pictures to itself.
  const folderEntries = new Map()
  function artEntries (info) {
    const folder = folderOf(info.path)
    if (info.isEpisode || (videoCount.get(folder) || 0) <= 1) return entries
    let list = folderEntries.get(folder)
    if (!list) {
      list = (index.files.get(folder) || []).filter((entry) => !(PICTURES.has(extensionOf(entry.path)) && FOLDER_ART.has(baseName(entry.path).toLowerCase())))
      folderEntries.set(folder, list)
    }
    return list
  }

  function inMovieFolder (path) {
    if (MOVIE_FOLDER.test(fileName(base))) return true
    const parts = path.slice(base.length).split('/')
    parts.pop()
    return parts.some((part) => MOVIE_FOLDER.test(part))
  }

  function isMovie (info) {
    if (Number.isFinite(info.year)) return true
    if (info.nfo && info.nfo.title) return true
    if (inMovieFolder(info.path)) return true
    const art = ownArtOf(info.path)
    if (art.poster || art.backdrop) return true
    if (info.meta && (info.meta.cover || (info.meta.title && info.meta.description))) return true
    // A folder of its own with the movie's name: Inception/Inception.mkv.
    const folder = folderOf(info.path)
    return folder !== base && (videoCount.get(folder) || 0) === 1 && nameKey(folderTitleOf(folder)) === nameKey(info.parsed.title || info.title)
  }

  // Where a show lives: the folder above its season folders, a folder named
  // like it, or only its name when its episodes sit among other things.
  function showPlaceOf (info) {
    const folder = folderOf(info.path)
    const folderName = fileName(folder)
    if (folder !== base && (SEASON_FOLDER.test(folderName) || SPECIALS_FOLDER.test(folderName))) {
      const above = folderOf(folder)
      const home = above.startsWith(base) ? above : folder
      return { id: home, folder: home }
    }
    const name = info.showName
    if (!name) return folder !== base ? { id: folder, folder } : null
    if (folder !== base && nameKey(folderTitleOf(folder)) === nameKey(name)) return { id: folder, folder }
    return { id: `name:${nameKey(name)}`, folder: null }
  }

  // ---------- The library: shows, movies and folders of videos ----------

  const playable = new Map()
  function playsHere (path) {
    const extension = extensionOf(path)
    if (!playable.has(extension)) playable.set(extension, canPlay(path))
    return playable.get(extension)
  }

  // Specials after the numbered seasons; episodes without a number last.
  function seasonRank (number) {
    if (number === null) return 1
    return number === 0 ? 1e9 : number
  }

  function makeShow (place, list, single) {
    const numbered = list.some((info) => info.season !== null)
    const seasonOf = (info) => (info.season !== null ? info.season : numbered ? 1 : null)
    const episodes = list.slice().sort((a, b) =>
      seasonRank(seasonOf(a)) - seasonRank(seasonOf(b)) ||
      (a.episode === null ? 1e9 : a.episode) - (b.episode === null ? 1e9 : b.episode) ||
      naturalCompare(a.path, b.path))
    const seasons = []
    const bySeason = new Map()
    for (const info of episodes) {
      const number = seasonOf(info)
      let season = bySeason.get(number)
      if (!season) {
        season = { number, episodes: [], folder: null, poster: null }
        bySeason.set(number, season)
        seasons.push(season)
      }
      season.episodes.push(info)
      const folder = folderOf(info.path)
      if (!season.folder && folder !== base && (SEASON_FOLDER.test(fileName(folder)) || SPECIALS_FOLDER.test(fileName(folder)))) season.folder = folder
    }
    const showNfo = episodes.map((info) => info.showNfo).find(Boolean) || null
    // A show's folder artwork, or the library's own when it is all one show.
    const artFolder = place.folder || (single ? base : null)
    for (const season of seasons) {
      const number = season.number
      const names = number === 0
        ? ['season-specials-poster', 'season00-poster', 'season0-poster']
        : Number.isFinite(number) ? [`season${String(number).padStart(2, '0')}-poster`, `season${number}-poster`] : []
      season.poster = artNamed(artFolder, names) || artNamed(season.folder, ['poster', 'folder', 'cover'])
    }
    let mtime = null
    for (const info of episodes) {
      if (info.mtime !== null && (mtime === null || info.mtime > mtime)) mtime = info.mtime
    }
    const title = (showNfo && showNfo.title) ||
      mostCommon(episodes.map((info) => info.meta && info.meta.show)) ||
      mostCommon(episodes.map((info) => info.nfo && info.nfo.show)) ||
      mostCommon(episodes.map((info) => info.parsed.show)) ||
      (place.folder ? folderTitleOf(place.folder) : '') ||
      episodes[0].title || cleanTitle(episodes[0].name)
    return {
      type: 'show',
      id: place.id,
      folder: place.folder,
      title,
      episodes,
      seasons,
      seasonOf,
      mtime,
      year: (showNfo && showNfo.year) || mostCommon(episodes.map((info) => info.parsed.year)) || null,
      description: (showNfo && showNfo.plot) || null,
      genre: (showNfo && showNfo.genre) || mostCommon(episodes.map((info) => info.genre)),
      poster: artNamed(artFolder, ['poster', 'folder', 'cover', 'season-all-poster']),
      backdrop: artNamed(artFolder, ['fanart', 'backdrop', 'background', 'landscape'])
    }
  }

  function makeTitle (info, type) {
    const art = ownArtOf(info.path)
    return { type, id: info.path, title: info.title, mtime: info.mtime, poster: art.poster, backdrop: art.backdrop, thumb: art.thumb }
  }

  // The top-level folder a path is in, or null when it is directly here.
  function topFolderOf (path) {
    const rest = path.slice(base.length)
    const slash = rest.indexOf('/')
    return slash === -1 ? null : base + rest.slice(0, slash + 1)
  }

  // Tall cards for a folder of mostly upright phone videos.
  function clipShape (items) {
    let tall = 0
    let wide = 0
    for (const item of items) {
      const info = infoAt(item.id)
      if (!info || !info.width || !info.height) continue
      if (info.height > info.width) tall++
      else wide++
    }
    return tall > wide ? 'tall' : 'frame'
  }

  function buildLibrary () {
    const places = new Map()
    const movieInfos = []
    const clipInfos = []
    for (const video of videos) {
      const info = describe(video)
      const place = info.isEpisode ? showPlaceOf(info) : null
      if (place) {
        let group = places.get(place.id)
        if (!group) {
          group = { place, list: [] }
          places.set(place.id, group)
        }
        group.list.push(info)
      } else if (isMovie(info)) {
        movieInfos.push(info)
      } else {
        clipInfos.push(info)
      }
    }

    // A show known only by its name joins the one show of that name that
    // has a folder of its own.
    const withFolder = new Map()
    for (const group of places.values()) {
      if (!group.place.folder) continue
      const key = nameKey(mostCommon(group.list.map((info) => info.showName)) || folderTitleOf(group.place.folder))
      withFolder.set(key, withFolder.has(key) ? null : group)
    }
    for (const [id, group] of places) {
      if (group.place.folder) continue
      const home = withFolder.get(id.slice(5))
      if (!home) continue
      for (const info of group.list) home.list.push(info)
      places.delete(id)
    }

    const singleShow = places.size === 1 && !movieInfos.length && !clipInfos.length
    const shows = [...places.values()].map((group) => makeShow(group.place, group.list, singleShow))
      .sort((a, b) => compareText(a.title, b.title))
    const movies = movieInfos.map((info) => makeTitle(info, 'movie'))
      .sort((a, b) => compareText(a.title, b.title) || (infoAt(a.id).year || 0) - (infoAt(b.id).year || 0))
    const clips = clipInfos.map((info) => makeTitle(info, 'clip'))

    const groups = new Map()
    for (const clip of clips) {
      const folder = topFolderOf(clip.id)
      const key = folder || base
      let group = groups.get(key)
      if (!group) {
        group = { id: key, folder, name: folder ? fileName(folder) : '', items: [], shape: 'frame' }
        groups.set(key, group)
      }
      group.items.push(clip)
    }
    const folders = [...groups.values()].sort((a, b) => Number(Boolean(a.folder)) - Number(Boolean(b.folder)) || naturalCompare(a.name, b.name))
    for (const group of folders) {
      group.items.sort((a, b) => naturalCompare(a.id, b.id))
      group.shape = clipShape(group.items)
    }

    const showById = new Map(shows.map((show) => [show.id, show]))
    const showOfPath = new Map()
    for (const show of shows) {
      for (const info of show.episodes) showOfPath.set(info.path, show.id)
    }
    const titleOfPath = new Map()
    for (const item of movies) titleOfPath.set(item.id, item)
    for (const item of clips) titleOfPath.set(item.id, item)

    const showShape = shows.some((show) => show.poster) ? 'poster' : 'frame'
    const movieShape = movies.some((movie) => movie.poster || (infoAt(movie.id).meta && infoAt(movie.id).meta.cover)) ? 'poster' : 'frame'

    // The hero: the newest show or movie with artwork or a frame to show.
    const candidates = [
      ...shows.map((show) => ({ type: 'show', id: show.id, mtime: show.mtime, art: Boolean(show.backdrop || show.poster), plays: playsHere(show.episodes[0].path) })),
      ...movies.map((movie) => ({ type: 'movie', id: movie.id, mtime: movie.mtime, art: Boolean(movie.backdrop || movie.poster || movie.thumb), plays: playsHere(movie.id) }))
    ].sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
    const kept = featuredId && candidates.find((candidate) => candidate.id === featuredId)
    const featured = kept || candidates.find((candidate) => candidate.art || candidate.plays) || candidates[0] || null

    const signature = [
      shows.map((show) => `${show.id}:${show.episodes.map((info) => `${info.path}@${show.seasonOf(info)}.${info.episode}`).join(',')}`).join('|'),
      movies.map((movie) => movie.id).join('|'),
      folders.map((group) => `${group.id}:${group.shape}:${group.items.length}`).join('|'),
      showShape,
      movieShape
    ].join('#')

    return {
      shows,
      movies,
      clips,
      folders,
      showById,
      showOfPath,
      titleOfPath,
      showShape,
      movieShape,
      featured,
      signature,
      clipsOnly: !shows.length && !movies.length,
      single: shows.length + movies.length + clips.length === 1
    }
  }

  // The hero's title stays the same while details arrive.
  let featuredId = null
  let library = buildLibrary()

  function currentShow (id) {
    return library.showById.get(id) || null
  }

  function showFor (path) {
    const id = library.showOfPath.get(path)
    return id ? currentShow(id) : null
  }

  function titleAt (path) {
    return library.titleOfPath.get(path) || null
  }

  // ---------- How far each video was watched ----------

  let progress = new Map()
  let progressSeen = ''

  async function loadProgress () {
    let records = []
    try {
      records = await store.listProgress()
    } catch {
      records = []
    }
    const next = new Map()
    for (const record of records || []) {
      if (record && record.value && typeof record.value === 'object') next.set(record.key, { ...record.value, at: record.at || 0 })
    }
    progress = next
    progressSeen = [...next].map(([key, value]) => `${key}:${Math.round(Number(value.position) || 0)}:${Boolean(value.done)}`).join('|')
  }

  function progressOf (path) {
    const entry = byPath.get(path)
    return entry ? progress.get(store.keyOf(entry)) || null : null
  }

  function timeLeft (saved) {
    const minutes = Math.max(1, Math.round((saved.duration - saved.position) / 60))
    return tp({ one: '{count} min left', other: '{count} min left' }, minutes)
  }

  // The next episode in the same run: the numbered seasons, or the specials.
  function nextEpisode (show, path) {
    const at = show.episodes.findIndex((info) => info.path === path)
    if (at === -1) return null
    const special = show.seasonOf(show.episodes[at]) === 0
    for (let i = at + 1; i < show.episodes.length; i++) {
      const info = show.episodes[i]
      if ((show.seasonOf(info) === 0) === special) return info
    }
    return null
  }

  // What Play starts in a show: the episode left halfway, the one after the
  // last one finished, or the first.
  function upNextOf (show) {
    let latest = null
    for (const info of show.episodes) {
      const saved = progressOf(info.path)
      if (saved && (!latest || saved.at > latest.saved.at)) latest = { info, saved }
    }
    const first = show.episodes.find((info) => show.seasonOf(info) !== 0) || show.episodes[0]
    if (!latest) return { info: first, resume: false, started: false }
    if (resumable(latest.saved)) return { info: latest.info, resume: true, started: true }
    if (latest.saved.done) {
      const next = nextEpisode(show, latest.info.path)
      if (next) return { info: next, resume: resumable(progressOf(next.path)), started: true }
      return { info: first, resume: false, started: false }
    }
    return { info: latest.info, resume: false, started: true }
  }

  // ---------- Words ----------

  function seasonLabel (number) {
    if (number === 0) return t('Specials')
    if (number === null) return t('Episodes')
    return t('Season {number}', { number: formatNumber(number) })
  }

  function episodeCode (show, info) {
    const season = show ? show.seasonOf(info) : info.season
    const episode = info.episode
    if (episode === null) return ''
    if (season === 0) return t('Special {number}', { number: formatNumber(episode) })
    if (season === null) return t('Episode {number}', { number: formatNumber(episode) })
    if (info.episodeEnd) return t('S{season} E{episode}-{last}', { season: formatNumber(season), episode: formatNumber(episode), last: formatNumber(info.episodeEnd) })
    return t('S{season} E{episode}', { season: formatNumber(season), episode: formatNumber(episode) })
  }

  function episodeName (info) {
    if (info.episodeTitle) return info.episodeTitle
    if (info.episode !== null) return t('Episode {number}', { number: formatNumber(info.episode) })
    return cleanTitle(info.name) || info.name
  }

  function seasonsLine (show) {
    return show.seasons.length > 1
      ? tp({ one: '{count} season', other: '{count} seasons' }, show.seasons.length)
      : tp({ one: '{count} episode', other: '{count} episodes' }, show.episodes.length)
  }

  function playerWords (info, show) {
    if (show) return { title: episodeName(info), subtitle: [show.title, episodeCode(show, info)].filter(Boolean).join(' · ') }
    return { title: info.title, subtitle: yearText(info.year) }
  }

  // ---------- Playing ----------

  let player = null

  /** Plays a video in the shell's player; an episode offers the next one. */
  function play (path, { resume, fromHash = false } = {}) {
    const info = infoAt(path)
    if (!info) return
    const show = showFor(path)
    const words = playerWords(info, show)
    let handle = null
    const options = {
      fromHash,
      title: words.title,
      subtitle: words.subtitle,
      onClose: () => {
        if (player === handle) player = null
        afterPlayer()
      }
    }
    if (show) {
      options.next = (current) => {
        const now = currentShow(show.id) || show
        const next = nextEpisode(now, current.path)
        if (!next) return null
        const nextWords = playerWords(next, now)
        return { entry: next.entry, title: nextWords.title, subtitle: nextWords.subtitle }
      }
    }
    // 'auto': Resume was pressed, so the player does not ask again.
    if (resume === 'auto' || resume === false) options.resume = resume
    handle = ctx.openPlayer(info.entry, options)
    player = handle
  }

  function download (info) {
    source.download(host, info.path, info.name)
    if (!phone) toast(t('Download started'))
  }

  function copyLink (path) {
    copyWithToast(source, source.hyperUrl(host, path))
  }

  // ---------- Details read in the background ----------

  const nfoQueue = thumbs.queue(2)
  const metaAsked = new Map()

  async function readNfo (path) {
    const entry = byPath.get(path)
    if (!entry || nfos.has(path)) return
    const key = `${store.keyOf(entry)}|nfo${NFO_VERSION}`
    let value
    const kept = await store.getMeta(key).catch(() => null)
    if (kept && 'value' in kept) {
      value = kept.value
    } else {
      const text = await source.text(host, path, { maxBytes: NFO_BYTES, signal })
      value = parseNfo(text)
      store.putMeta(key, { value }).catch(() => {})
    }
    nfos.set(path, value || null)
  }

  // Every .nfo the videos have, few and small: they name shows and episodes.
  function readNfos () {
    const paths = new Set()
    for (const video of videos) {
      const found = nfoPathsOf(video.path)
      if (found.path) paths.add(found.path)
      if (found.showPath) paths.add(found.showPath)
      if (paths.size >= MAX_NFO) break
    }
    if (!paths.size) return Promise.resolve()
    return Promise.all([...paths].map((path) => nfoQueue.push(() => readNfo(path), { signal }).then(() => {
      described.clear()
      infoChanged()
    }, () => {})))
  }

  /** What a video file holds (lib/video-meta.js), read once, in the queue. */
  function wantMeta (entry, priority = 'low') {
    if (!entry || metas.has(entry.path)) return Promise.resolve()
    const asked = metaAsked.get(entry.path)
    if (asked && (asked.priority === 'high' || priority === 'low')) return asked.promise
    const promise = Promise.resolve(thumbs.videoMeta(entry, { signal, priority })).then((meta) => {
      if (metas.has(entry.path)) return
      metas.set(entry.path, meta || null)
      infoChanged(entry.path)
    }, () => {
      // Not this time; asked again when it is seen again.
      if (metaAsked.get(entry.path) === record) metaAsked.delete(entry.path)
    })
    const record = { priority, promise }
    metaAsked.set(entry.path, record)
    return promise
  }

  // Newest first: the hero and Recently added come from those.
  function byNewest (a, b) {
    return (b.mtime || 0) - (a.mtime || 0) || naturalCompare(a.path, b.path)
  }

  // ---------- Pictures ----------

  // An <img> filled from the thumbs queues once it nears the screen. A
  // picture of another shape sits whole on a blurred copy of itself.
  function fillArt (art, want, ratio) {
    if (!want || !want.entry) {
      art.classList.add('is-missing')
      return
    }
    const img = h('img', { class: 'hd-vid-img', alt: '', draggable: 'false', decoding: 'async' })
    art.prepend(img)
    thumbs.attach(img, want.entry, {
      kind: want.kind,
      size: 'grid',
      entries: want.entries,
      prefer: want.prefer,
      onResult: (url) => showPicture(art, img, url, ratio)
    })
  }

  function showPicture (box, img, url, ratio) {
    if (!url) {
      box.classList.add('is-missing')
      return
    }
    img.addEventListener('load', () => {
      const own = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0
      if (ratio && own && Math.abs(Math.log(own / ratio)) > 0.18) {
        box.classList.add('is-fit')
        box.prepend(h('img', { class: 'hd-vid-fill', alt: '', draggable: 'false', src: url }))
      }
      box.classList.add('is-loaded')
    }, { once: true })
    img.addEventListener('error', () => box.classList.add('is-missing'), { once: true })
    img.setAttribute('src', url)
  }

  // A big picture for a hero or a page: the first of wants that can be made.
  async function fillBackdrop (box, wants, abort) {
    for (const want of wants) {
      if (!want || !want.entry) continue
      let url = null
      try {
        url = want.kind === 'photo'
          ? await thumbs.photo(want.entry, { size: 'hero', signal: abort })
          : await thumbs.video(want.entry, { size: 'hero', prefer: want.prefer || 'frame', entries: want.entries, signal: abort })
      } catch {
        url = null
      }
      if (abort.aborted) return
      if (url) {
        const img = h('img', { class: 'hd-vid-backdrop-img', alt: '', draggable: 'false' })
        box.append(img)
        showPicture(box, img, url, 16 / 9)
        return
      }
    }
    box.classList.add('is-missing')
  }

  function showWants (show, { poster = false } = {}) {
    const first = show.episodes[0]
    return [
      poster && show.poster ? { kind: 'photo', entry: show.poster } : null,
      show.backdrop ? { kind: 'photo', entry: show.backdrop } : null,
      { kind: 'video', entry: first.entry, prefer: 'frame', entries },
      !poster && show.poster ? { kind: 'photo', entry: show.poster } : null
    ]
  }

  function titleWants (path, { poster = false } = {}) {
    const info = infoAt(path)
    const item = titleAt(path)
    if (!info) return []
    const own = artEntries(info)
    return [
      poster && item && item.poster ? { kind: 'photo', entry: item.poster } : null,
      poster ? { kind: 'video', entry: info.entry, prefer: 'poster', entries: own } : null,
      !poster && item && item.backdrop ? { kind: 'photo', entry: item.backdrop } : null,
      { kind: 'video', entry: info.entry, prefer: 'frame', entries: own },
      !poster && item && item.poster ? { kind: 'photo', entry: item.poster } : null
    ]
  }

  // ---------- Cards ----------

  // Each card's and episode's text is redrawn from the library when details
  // arrive or progress changes.
  const refreshers = new WeakMap()

  function refreshCards () {
    for (const node of content.querySelectorAll('.hd-vid-card, .hd-vid-episode')) {
      const refresh = refreshers.get(node)
      if (refresh) refresh()
    }
  }

  function setBar (bar, saved) {
    const shown = resumable(saved) && saved.duration > 0
    bar.hidden = !shown
    if (shown) bar.firstChild.style.width = `${Math.min(100, Math.max(3, (saved.position / saved.duration) * 100)).toFixed(1)}%`
  }

  function cardWords (item) {
    if (item.type === 'show') {
      const show = currentShow(item.id)
      return show ? { title: show.title, meta: [yearText(show.year), seasonsLine(show)].filter(Boolean).join(' · ') } : { title: '', meta: '' }
    }
    const info = infoAt(item.id)
    if (!info) return { title: '', meta: '' }
    const saved = progressOf(item.id)
    const left = item.continuing && resumable(saved) && saved.duration > 0 ? timeLeft(saved) : ''
    if (item.type === 'episode') {
      const show = showFor(item.id)
      return { title: show ? show.title : episodeName(info), meta: [show ? episodeCode(show, info) : '', episodeName(info)].filter(Boolean).join(' · ') }
    }
    if (left) return { title: info.title, meta: left }
    const runtime = info.duration ? formatRuntime(info.duration) : ''
    return { title: info.title, meta: [item.type === 'movie' ? yearText(info.year) : '', runtime].filter(Boolean).join(' · ') }
  }

  function pictureFor (item, shape) {
    const wants = item.type === 'show'
      ? showWants(currentShow(item.id), { poster: shape === 'poster' })
      : item.type === 'movie' ? titleWants(item.id, { poster: shape === 'poster' }) : []
    const first = wants.find(Boolean)
    if (first) return first
    const info = infoAt(item.id)
    return info ? { kind: 'video', entry: info.entry, prefer: 'frame', entries: artEntries(info) } : null
  }

  /**
   * A card in a row or a grid. item: { type: 'show' | 'movie' | 'clip' |
   * 'episode', id, continuing }, shape: 'frame', 'poster' or 'tall'.
   */
  function card (item, shape) {
    const fallback = h('span', { class: 'hd-vid-art-title', 'aria-hidden': 'true', dir: 'auto' })
    const bar = h('span', { class: 'hd-vid-bar', hidden: true }, h('span', { class: 'hd-vid-bar-fill' }))
    const art = h('span', { class: 'hd-vid-art' }, fallback, bar)
    if (item.type !== 'show' && !playsHere(item.id)) {
      const entry = byPath.get(item.id)
      art.append(h('span', { class: 'hd-vid-format' }, entry ? thumbs.badge(entry) : ''))
    }
    const titleNode = h('span', { class: 'hd-vid-card-title', dir: 'auto' })
    const metaNode = h('span', { class: 'hd-vid-card-meta' })
    const node = h('button', {
      type: 'button',
      class: ['hd-vid-card', `hd-vid-card--${shape}`],
      'data-item': item.id,
      onClick: () => activate(item),
      onContextMenu: (event) => {
        if (item.type === 'show') return
        event.preventDefault()
        itemMenu(node, item.id)
      }
    }, art, h('span', { class: 'hd-vid-card-text' }, titleNode, metaNode))
    const refresh = () => {
      const words = cardWords(item)
      titleNode.textContent = words.title
      fallback.textContent = words.title
      metaNode.textContent = words.meta
      metaNode.hidden = !words.meta
      node.setAttribute('title', words.title)
      setBar(bar, item.type === 'show' ? null : progressOf(item.id))
    }
    refreshers.set(node, refresh)
    refresh()
    fillArt(art, pictureFor(item, shape), SHAPES[shape])
    const show = item.type === 'show' ? currentShow(item.id) : null
    wantMeta(show ? show.episodes[0].entry : byPath.get(item.id), 'high')
    return node
  }

  function activate (item) {
    if (item.type === 'show') openShow(item.id)
    else if (item.continuing) play(item.id, { resume: 'auto' })
    else if (item.type === 'movie') openMovie(item.id)
    else play(item.id)
  }

  function itemMenu (anchor, path) {
    const info = infoAt(path)
    if (!info) return
    openMenu(anchor, [
      { label: t('Play'), icon: 'play', onSelect: () => play(path) },
      titleAt(path) ? { label: t('More info'), icon: 'info', onSelect: () => openMovie(path) } : null,
      { label: t('Download'), icon: 'download', onSelect: () => download(info) },
      { label: t('Copy link'), icon: 'link', onSelect: () => copyLink(path) },
      phone ? { label: t('Share'), icon: 'share', onSelect: () => source.share(host, path, info.name) } : null
    ], { label: t('More actions') })
  }

  // ---------- Rows and grids ----------

  // Rows make their cards only near the screen and drop them far from it.
  const rowStates = new Map()
  let rowNear = null
  let rowFar = null
  let rowCount = 0

  function watchRow (section, state) {
    if (!rowNear) {
      rowNear = new IntersectionObserver((records) => {
        for (const record of records) {
          const found = rowStates.get(record.target)
          if (found && record.isIntersecting) found.fill()
        }
      }, { rootMargin: '900px 0px' })
      rowFar = new IntersectionObserver((records) => {
        for (const record of records) {
          const found = rowStates.get(record.target)
          if (found && !record.isIntersecting) found.release()
        }
      }, { rootMargin: '3200px 0px' })
    }
    rowStates.set(section, state)
    rowNear.observe(section)
    rowFar.observe(section)
  }

  // Arrow keys move along a row of cards, as the eye does.
  function moveFocus (event, grow) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const cell = event.target && event.target.closest ? event.target.closest('.hd-vid-cell') : null
    if (!cell) return
    const forward = (event.key === 'ArrowRight') !== rtl()
    let target = forward ? cell.nextElementSibling : cell.previousElementSibling
    if (forward && (!target || !target.classList.contains('hd-vid-cell')) && grow) {
      grow()
      target = cell.nextElementSibling
    }
    if (!target || !target.classList.contains('hd-vid-cell')) return
    event.preventDefault()
    target.firstElementChild.focus()
  }

  /**
   * A row that scrolls sideways: arrow buttons on a desktop, snapping under a
   * finger. items are cards' items; onTitle makes the title a link.
   */
  function rowSection ({ id, title, items, shape, onTitle }) {
    const titleId = `hd-vid-row-${++rowCount}`
    const heading = onTitle
      ? h('h2', { class: 'hd-vid-row-title', id: titleId },
        h('button', { type: 'button', class: 'hd-vid-row-link', onClick: onTitle }, h('span', { dir: 'auto' }, title), icon(rtl() ? 'back' : 'forward')))
      : h('h2', { class: 'hd-vid-row-title', id: titleId }, title)
    const scroller = h('div', { class: 'hd-vid-scroller', role: 'list', 'aria-labelledby': titleId })
    const prev = iconButton(rtl() ? 'forward' : 'back', t('Scroll back'), () => scrollRow(-1), { className: 'hd-vid-arrow hd-vid-arrow--prev' })
    const next = iconButton(rtl() ? 'back' : 'forward', t('Scroll forward'), () => scrollRow(1), { className: 'hd-vid-arrow hd-vid-arrow--next' })
    prev.tabIndex = -1
    next.tabIndex = -1
    const section = h('section', { class: ['hd-vid-row', `hd-vid-row--${shape}`], 'data-row': id, 'aria-labelledby': titleId },
      h('div', { class: 'hd-vid-row-head' }, heading),
      h('div', { class: 'hd-vid-row-body' }, prev, scroller, next))
    const sentinel = h('span', { class: 'hd-vid-sentinel', 'aria-hidden': 'true' })
    let rendered = 0
    let filled = false

    const ahead = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) grow()
    }, { root: scroller, rootMargin: '0px 900px' })

    function grow () {
      if (!filled || rendered >= items.length) return
      const end = Math.min(items.length, rendered + BATCH)
      const cells = []
      for (; rendered < end; rendered++) cells.push(h('div', { class: 'hd-vid-cell', role: 'listitem' }, card(items[rendered], shape)))
      sentinel.before(...cells)
      // Back from a page, the card that opened it has the focus again.
      if (comeBack && comeBack.row === id) {
        const again = cells.find((cell) => cell.firstChild.dataset.item === comeBack.item)
        if (again) {
          comeBack = null
          again.firstChild.focus()
        }
      }
      if (rendered >= items.length) {
        ahead.unobserve(sentinel)
        sentinel.remove()
      }
      updateArrows()
    }

    function updateArrows () {
      const max = scroller.scrollWidth - scroller.clientWidth
      const at = Math.abs(scroller.scrollLeft)
      prev.disabled = at <= 4
      next.disabled = at >= max - 4
      section.classList.toggle('is-scrollable', max > 4)
    }

    function scrollRow (direction) {
      const step = Math.max(240, scroller.clientWidth * 0.85)
      scroller.scrollBy({ left: (rtl() ? -direction : direction) * step, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    }

    let tick = 0
    scroller.addEventListener('scroll', () => {
      if (tick) return
      tick = requestAnimationFrame(() => {
        tick = 0
        updateArrows()
      })
    }, { passive: true })
    scroller.addEventListener('keydown', (event) => moveFocus(event, grow))

    const state = {
      id,
      wantScroll: 0,
      fill () {
        if (filled) return
        filled = true
        scroller.append(sentinel)
        grow()
        ahead.observe(sentinel)
        // Back where it was before the row was made again.
        if (state.wantScroll) {
          while (rendered < items.length && scroller.scrollWidth - scroller.clientWidth < Math.abs(state.wantScroll)) grow()
          scroller.scrollLeft = state.wantScroll
          state.wantScroll = 0
        }
      },
      release () {
        if (!filled) return
        filled = false
        state.wantScroll = scroller.scrollLeft
        ahead.unobserve(sentinel)
        thumbs.detachWithin(scroller)
        scroller.replaceChildren()
        rendered = 0
      },
      scrollLeft () {
        return filled ? scroller.scrollLeft : state.wantScroll
      },
      destroy () {
        ahead.disconnect()
        if (tick) cancelAnimationFrame(tick)
      }
    }
    watchRow(section, state)
    return section
  }

  function gutter () {
    return parseFloat(getComputedStyle(html).getPropertyValue('--hd-gutter')) || 16
  }

  function gridColumns (shape) {
    const width = Math.max(280, (content.clientWidth || window.innerWidth) - 2 * gutter())
    const min = shape === 'tall' ? (width < 600 ? 104 : 170) : shape === 'poster' ? (width < 600 ? 104 : 160) : (width < 600 ? 150 : 270)
    return Math.max(shape === 'frame' ? 2 : 3, Math.floor(width / min))
  }

  const grids = []

  /** All of one group's videos at once, row after row, for a library of one folder. */
  function gridSection ({ id, title, items, shape }) {
    const wrap = h('div', { class: 'hd-vid-grid-wrap' })
    const section = h('section', { class: 'hd-vid-gridsec', 'data-row': id },
      title ? h('h2', { class: 'hd-vid-row-title' }, title) : null,
      wrap)
    const columns = gridColumns(shape)
    const width = Math.max(280, (content.clientWidth || window.innerWidth) - 2 * gutter())
    const cellHeight = width / columns / SHAPES[shape] + 64
    wrap.style.setProperty('--hd-cols', String(columns))
    const lazy = lazyChunks({
      container: wrap,
      count: items.length,
      size: columns * 6,
      className: `hd-chunk hd-vid-grid hd-vid-grid--${shape}`,
      estimate: (start, end) => Math.ceil((end - start) / columns) * cellHeight,
      render: (chunk, start, end) => {
        for (let at = start; at < end; at++) chunk.append(h('div', { class: 'hd-vid-cell' }, card(items[at], shape)))
      },
      release: (chunk) => thumbs.detachWithin(chunk),
      eager: 2
    })
    grids.push({ shape, columns })
    cleanups.push(() => lazy.destroy())
    wrap.addEventListener('keydown', (event) => moveFocus(event, null))
    return section
  }

  // ---------- Pieces of a page's head ----------

  function metaLine (items, quality) {
    const words = items.filter(Boolean)
    // The dot goes after a word, so a line that wraps does not start with one.
    const parts = words.map((text, at) => h('span', { class: ['hd-vid-meta-item', at < words.length - 1 && 'has-dot'] }, text))
    if (quality) parts.push(h('span', { class: 'hd-vid-quality' }, qualityLabel(quality)))
    return parts.length ? h('p', { class: 'hd-vid-head-meta' }, parts) : null
  }

  // A long description shows a few lines, and More shows the rest.
  function description (text) {
    if (!text) return null
    const body = h('p', { class: 'hd-vid-head-desc', dir: 'auto' }, text)
    const more = h('button', { type: 'button', class: 'hd-link-btn hd-vid-more', hidden: true }, t('More'))
    more.addEventListener('click', () => {
      const open = body.classList.toggle('is-open')
      more.textContent = open ? t('Less') : t('More')
    })
    requestAnimationFrame(() => {
      if (body.isConnected && body.scrollHeight > body.clientHeight + 2) more.hidden = false
    })
    return h('div', { class: 'hd-vid-desc' }, body, more)
  }

  function playButton (label, onClick) {
    return button({ label, icon: 'play', variant: 'primary', className: 'hd-vid-play', onClick })
  }

  function backButton () {
    if (library.single) return null
    return button({ label: t('Back'), icon: rtl() ? 'forward' : 'back', variant: 'overlay', small: true, className: 'hd-vid-back', onClick: () => goHome() })
  }

  // Keeps the focus on the same button when a head is drawn again.
  function redraw (box, parts) {
    const focused = box.contains(document.activeElement) ? document.activeElement.className : null
    replace(box, parts)
    if (focused) {
      const again = [...box.querySelectorAll('button')].find((node) => node.className === focused)
      if (again) again.focus({ preventScroll: true })
    }
  }

  function qualityOfInfo (info) {
    return info ? qualityOf(info.width, info.height) : null
  }

  // ---------- Home ----------

  function heroFor (featured) {
    const backdrop = h('div', { class: 'hd-vid-backdrop', 'aria-hidden': 'true' })
    const body = h('div', { class: 'hd-vid-head-text' })
    const head = h('header', { class: 'hd-vid-head hd-vid-head--hero' }, backdrop, h('div', { class: 'hd-vid-head-body' }, body))
    const abort = screenAbort.signal
    if (featured.type === 'show') {
      const show = currentShow(featured.id)
      fillBackdrop(backdrop, showWants(show), abort)
      wantMeta(show.episodes[0].entry, 'high')
    } else {
      fillBackdrop(backdrop, titleWants(featured.id), abort)
    }
    const draw = () => {
      if (featured.type === 'show') {
        const show = currentShow(featured.id)
        if (!show) return
        const next = upNextOf(show)
        wantMeta(next.info.entry, 'high')
        redraw(body, [
          h('p', { class: 'hd-vid-kicker' }, t('Show')),
          h('h2', { class: 'hd-vid-head-title', dir: 'auto' }, show.title),
          metaLine([yearText(show.year), seasonsLine(show), show.genre], qualityOfInfo(next.info)),
          next.started ? h('p', { class: 'hd-vid-head-line' }, [episodeCode(show, next.info), episodeName(next.info)].filter(Boolean).join(' · ')) : null,
          description(show.description),
          h('div', { class: 'hd-vid-head-actions' },
            playButton(next.resume ? t('Resume') : t('Play'), () => play(next.info.path, { resume: next.resume ? 'auto' : undefined })),
            button({ label: t('More info'), icon: 'info', variant: 'overlay', className: 'hd-vid-info', onClick: () => openShow(show.id) }))
        ])
      } else {
        const info = infoAt(featured.id)
        if (!info) return
        const saved = progressOf(info.path)
        redraw(body, [
          h('p', { class: 'hd-vid-kicker' }, t('Movie')),
          h('h2', { class: 'hd-vid-head-title', dir: 'auto' }, info.title),
          metaLine([yearText(info.year), info.duration ? formatRuntime(info.duration) : '', info.genre], qualityOfInfo(info)),
          description(info.description),
          h('div', { class: 'hd-vid-head-actions' },
            playButton(resumable(saved) ? t('Resume') : t('Play'), () => play(info.path, { resume: resumable(saved) ? 'auto' : undefined })),
            button({ label: t('More info'), icon: 'info', variant: 'overlay', className: 'hd-vid-info', onClick: () => openMovie(info.path) }))
        ])
      }
    }
    draw()
    return { head, draw }
  }

  // What was left halfway, and the episode after the last one finished.
  function continueItems () {
    const items = []
    const shows = new Set()
    const records = [...progress.entries()].sort((a, b) => b[1].at - a[1].at)
    for (const [key, saved] of records) {
      if (items.length >= CONTINUE_MAX) break
      const entry = typeof saved.path === 'string' ? byPath.get(saved.path) : null
      // Another version of the file is another video.
      if (!entry || store.keyOf(entry) !== key) continue
      const show = showFor(entry.path)
      if (show) {
        if (shows.has(show.id)) continue
        shows.add(show.id)
        if (resumable(saved)) {
          items.push({ type: 'episode', id: entry.path, continuing: true })
        } else if (saved.done) {
          const next = nextEpisode(show, entry.path)
          const after = next && progressOf(next.path)
          if (next && !(after && after.done)) items.push({ type: 'episode', id: next.path, continuing: true })
        }
      } else if (resumable(saved) && titleAt(entry.path)) {
        items.push({ type: titleAt(entry.path).type, id: entry.path, continuing: true })
      }
    }
    return items
  }

  function recentItems () {
    const items = [
      ...library.shows.map((show) => ({ type: 'show', id: show.id, mtime: show.mtime })),
      ...library.movies.map((movie) => ({ type: 'movie', id: movie.id, mtime: movie.mtime })),
      ...library.clips.map((clip) => ({ type: 'clip', id: clip.id, mtime: clip.mtime }))
    ].filter((item) => item.mtime !== null)
    items.sort((a, b) => b.mtime - a.mtime)
    return items.slice(0, RECENT_MAX)
  }

  function continueRow () {
    const items = continueItems()
    return items.length ? rowSection({ id: 'continue', title: t('Continue watching'), items, shape: 'frame' }) : null
  }

  // Photos and other files that came along, a few of them.
  function alsoSection () {
    const paths = [...strays.map((entry) => entry.path), ...otherPaths]
    if (!paths.length) return null
    const shown = paths.slice(0, 12)
    return h('section', { class: 'hd-vid-also' },
      h('h2', { class: 'hd-vid-row-title' }, t('Also in this folder')),
      h('ul', { class: 'hd-vid-also-list' }, shown.map((path) => {
        const entry = byPath.get(path)
        return h('li', null, h('button', { type: 'button', class: 'hd-vid-also-item', title: path.slice(base.length), onClick: () => openOther(path) },
          kindBadge(kindOf(path, entry && entry.size)),
          h('span', { class: 'hd-vid-also-name', dir: 'auto' }, fileName(path))))
      })),
      paths.length > shown.length ? button({ label: t('Show all in Files'), icon: 'folder', variant: 'quiet', onClick: () => ctx.navigate({ view: 'files' }) }) : null)
  }

  function openOther (path, { fromHash = false } = {}) {
    const entry = byPath.get(path)
    if (!entry) return false
    if (isImageKind(kindOf(path, entry.size))) {
      const items = strays.map((photo) => ({
        path: photo.path,
        size: photo.size,
        mtime: photo.mtime,
        kind: 'image',
        motion: livePairs.has(photo.path) ? byPath.get(livePairs.get(photo.path)) || null : null
      }))
      ctx.openLightbox(items, Math.max(0, strays.indexOf(entry)), { fromHash })
      return true
    }
    if (!fromHash) ctx.navigate({ view: 'files', path: folderOf(path), hash: { item: path } })
    return false
  }

  function emptyState () {
    return stateView({
      icon: 'film',
      title: t('No videos here'),
      text: t('This folder has no videos. Its other files are in Files.'),
      actions: [button({ label: t('Open in Files'), icon: 'folder', variant: 'primary', onClick: () => ctx.navigate({ view: 'files' }) })]
    })
  }

  function homeScreen () {
    if (!videos.length) return emptyState()
    if (library.single) {
      if (library.shows.length) return showPage(library.shows[0], screen.season)
      return moviePage((library.movies[0] || library.clips[0]).id)
    }
    const parts = []
    const featured = library.clipsOnly ? null : library.featured
    let hero = null
    if (featured) {
      featuredId = featured.id
      hero = heroFor(featured)
      parts.push(hero.head)
    }
    const rows = h('div', { class: 'hd-vid-rows' })
    let continued = continueRow()
    if (continued) rows.append(continued)
    if (!library.clipsOnly) {
      const recent = recentItems()
      if (recent.length > 1) rows.append(rowSection({ id: 'recent', title: t('Recently added'), items: recent, shape: 'frame' }))
    }
    if (library.shows.length) rows.append(rowSection({ id: 'shows', title: t('Shows'), items: library.shows.map((show) => ({ type: 'show', id: show.id })), shape: library.showShape }))
    if (library.movies.length) rows.append(rowSection({ id: 'movies', title: t('Movies'), items: library.movies.map((movie) => ({ type: 'movie', id: movie.id })), shape: library.movieShape }))
    const oneGrid = library.clipsOnly && library.folders.length === 1
    for (const group of library.folders) {
      const title = group.folder ? group.name : t('Videos')
      const items = group.items.map((item) => ({ type: 'clip', id: item.id }))
      if (oneGrid) {
        rows.append(gridSection({ id: `folder:${group.id}`, title: continued ? title : '', items, shape: group.shape }))
      } else {
        rows.append(rowSection({
          id: `folder:${group.id}`,
          title,
          items,
          shape: group.shape,
          onTitle: group.folder ? () => ctx.navigate({ view: 'auto', path: group.folder }) : null
        }))
      }
    }
    parts.push(rows)
    const also = alsoSection()
    if (also) parts.push(also)
    if (listing.truncated) parts.push(h('p', { class: 'hd-vid-note' }, t('This folder has more files than the viewer can list, so some videos may be missing.')))

    screenApi = {
      onProgress () {
        if (hero) hero.draw()
        const fresh = continueRow()
        if (continued) {
          const state = rowStates.get(continued)
          if (state) state.destroy()
          rowStates.delete(continued)
          if (rowNear) {
            rowNear.unobserve(continued)
            rowFar.unobserve(continued)
          }
          thumbs.detachWithin(continued)
          if (fresh) continued.replaceWith(fresh)
          else continued.remove()
        } else if (fresh) {
          rows.prepend(fresh)
        }
        continued = fresh
      },
      onInfo () {
        if (hero) hero.draw()
      }
    }
    return h('div', { class: ['hd-vid-home', !featured && 'hd-vid-home--plain'] }, parts)
  }

  // ---------- A show's page ----------

  function episodeMenu (anchor, info) {
    openMenu(anchor, [
      { label: t('Play from the start'), icon: 'play', onSelect: () => play(info.path, { resume: false }) },
      { label: t('Download'), icon: 'download', onSelect: () => download(info) },
      { label: t('Copy link'), icon: 'link', onSelect: () => copyLink(info.path) },
      phone ? { label: t('Share'), icon: 'share', onSelect: () => source.share(host, info.path, info.name) } : null
    ], { label: t('More actions') })
  }

  function episodeRow (show, info) {
    const bar = h('span', { class: 'hd-vid-bar', hidden: true }, h('span', { class: 'hd-vid-bar-fill' }))
    const watched = h('span', { class: 'hd-vid-watched', role: 'img', 'aria-label': t('Watched'), title: t('Watched'), hidden: true }, icon('check'))
    const art = h('span', { class: 'hd-vid-art hd-vid-episode-art' },
      h('span', { class: 'hd-vid-art-play', 'aria-hidden': 'true' }, icon('play')),
      bar, watched)
    fillArt(art, { kind: 'video', entry: info.entry, prefer: 'frame', entries }, 16 / 9)
    const number = h('span', { class: 'hd-vid-episode-number' })
    const name = h('span', { class: 'hd-vid-episode-title', dir: 'auto' })
    const time = h('span', { class: 'hd-vid-episode-time' })
    const plot = h('span', { class: 'hd-vid-episode-plot', dir: 'auto' })
    const main = h('button', { type: 'button', class: 'hd-vid-episode-main', onClick: () => play(info.path) },
      art,
      h('span', { class: 'hd-vid-episode-text' }, h('span', { class: 'hd-vid-episode-line' }, number, name), time, plot))
    const more = iconButton('more', t('More actions'), () => episodeMenu(more, infoAt(info.path) || info), { className: 'hd-vid-episode-more' })
    more.setAttribute('aria-haspopup', 'menu')
    const row = h('div', { class: 'hd-vid-episode', role: 'listitem' }, main, more)
    const refresh = () => {
      const now = infoAt(info.path) || info
      const saved = progressOf(info.path)
      number.textContent = now.episode !== null ? formatNumber(now.episode) : ''
      number.hidden = now.episode === null
      name.textContent = episodeName(now)
      time.textContent = [now.duration ? formatRuntime(now.duration) : '', resumable(saved) && saved.duration > 0 ? timeLeft(saved) : ''].filter(Boolean).join(' · ')
      time.hidden = !time.textContent
      plot.textContent = now.description || ''
      plot.hidden = !now.description
      setBar(bar, saved)
      watched.hidden = !(saved && saved.done)
    }
    refreshers.set(row, refresh)
    refresh()
    wantMeta(info.entry, 'high')
    return row
  }

  function episodeList (show, season) {
    const list = h('div', { class: 'hd-vid-episodes', role: 'list', 'aria-label': seasonLabel(season.number) })
    const items = season.episodes
    if (items.length <= 60) {
      for (const info of items) list.append(episodeRow(show, info))
      return list
    }
    const lazy = lazyChunks({
      container: list,
      count: items.length,
      size: 30,
      className: 'hd-chunk hd-vid-episode-chunk',
      estimate: (start, end) => (end - start) * (window.innerWidth < 600 ? 150 : 130),
      render: (chunk, start, end) => {
        chunk.setAttribute('role', 'none')
        for (let at = start; at < end; at++) chunk.append(episodeRow(show, items[at]))
      },
      release: (chunk) => thumbs.detachWithin(chunk)
    })
    cleanups.push(() => lazy.destroy())
    return list
  }

  function seasonTabs (show, selected, onSelect) {
    const tabs = show.seasons.map((season) => h('button', {
      type: 'button',
      role: 'tab',
      class: 'hd-vid-season',
      'data-season': String(season.number),
      'aria-selected': String(season.number === selected),
      tabindex: season.number === selected ? '0' : '-1',
      onClick: () => onSelect(season.number)
    }, seasonLabel(season.number)))
    const list = h('div', { class: 'hd-vid-seasons', role: 'tablist', 'aria-label': t('Seasons') }, tabs)
    list.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const at = tabs.indexOf(event.target)
      if (at === -1) return
      event.preventDefault()
      const step = (event.key === 'ArrowRight') !== rtl() ? 1 : -1
      const target = tabs[(at + step + tabs.length) % tabs.length]
      target.focus()
      target.click()
    })
    return list
  }

  function showPage (show, wantedSeason) {
    if (!show) return emptyState()
    const first = upNextOf(show)
    const seasonNumbers = show.seasons.map((season) => season.number)
    let selected = seasonNumbers.includes(wantedSeason) ? wantedSeason : show.seasonOf(first.info)
    if (!seasonNumbers.includes(selected)) selected = seasonNumbers[0]

    const backdrop = h('div', { class: 'hd-vid-backdrop', 'aria-hidden': 'true' })
    fillBackdrop(backdrop, showWants(show), screenAbort.signal)
    const poster = h('span', { class: 'hd-vid-art hd-vid-head-poster', 'aria-hidden': 'true' })
    const body = h('div', { class: 'hd-vid-head-text' })
    const head = h('header', { class: 'hd-vid-head hd-vid-head--page' }, backdrop, backButton(), h('div', { class: 'hd-vid-head-body' }, poster, body))
    const seasonsBox = h('div', { class: 'hd-vid-seasons-box' })
    const episodesBox = h('div', { class: 'hd-vid-episodes-box' })

    function seasonPoster () {
      const season = show.seasons.find((item) => item.number === selected)
      return (season && season.poster) || show.poster
    }

    function drawPoster () {
      thumbs.detachWithin(poster)
      replace(poster)
      poster.classList.remove('is-loaded', 'is-fit', 'is-missing')
      const picture = seasonPoster()
      poster.hidden = !picture
      if (picture) fillArt(poster, { kind: 'photo', entry: picture }, 2 / 3)
    }

    function drawHead () {
      const now = currentShow(show.id) || show
      const next = upNextOf(now)
      redraw(body, [
        h('h2', { class: 'hd-vid-head-title', tabindex: '-1', dir: 'auto' }, now.title),
        metaLine([yearText(now.year), seasonsLine(now), now.genre], qualityOfInfo(next.info)),
        next.started ? h('p', { class: 'hd-vid-head-line' }, [episodeCode(now, next.info), episodeName(next.info)].filter(Boolean).join(' · ')) : null,
        description(now.description),
        h('div', { class: 'hd-vid-head-actions' },
          playButton(next.resume ? t('Resume') : t('Play'), () => play(next.info.path, { resume: next.resume ? 'auto' : undefined })),
          now.folder ? button({ label: t('Copy link'), icon: 'link', variant: 'overlay', className: 'hd-vid-link', onClick: () => copyLink(now.folder) }) : null)
      ])
    }

    function drawSeason () {
      const season = show.seasons.find((item) => item.number === selected) || show.seasons[0]
      thumbs.detachWithin(episodesBox)
      replace(episodesBox,
        show.seasons.length > 1 ? null : h('h3', { class: 'hd-vid-season-title' }, seasonLabel(season.number)),
        episodeList(show, season))
    }

    function selectSeason (number, { fromHash = false } = {}) {
      if (!seasonNumbers.includes(number) || number === selected) return
      selected = number
      for (const tab of seasonsBox.querySelectorAll('[role="tab"]')) {
        const on = tab.dataset.season === String(number)
        tab.setAttribute('aria-selected', String(on))
        tab.tabIndex = on ? 0 : -1
      }
      if (!fromHash) ctx.setHash(library.single ? { season: String(number) } : { show: show.id, season: String(number) })
      screen.season = number
      drawPoster()
      drawSeason()
    }

    if (show.seasons.length > 1) seasonsBox.append(seasonTabs(show, selected, (number) => selectSeason(number)))
    drawPoster()
    drawHead()
    drawSeason()
    screenApi = {
      onProgress: drawHead,
      onInfo: drawHead,
      selectSeason
    }
    return h('div', { class: 'hd-vid-page hd-vid-page--show' }, head, h('div', { class: 'hd-vid-page-body' }, seasonsBox, episodesBox))
  }

  // ---------- A movie's page, or any one video's ----------

  function subtitleNames (path) {
    let found = []
    try {
      found = subtitlesFor(path, entries) || []
    } catch {
      found = []
    }
    const language = getLanguage().split('-')[0]
    const playableSubs = found.filter((sub) => sub && (sub.format === 'srt' || sub.format === 'vtt'))
      .sort((a, b) => Number(b.language === language) - Number(a.language === language))
    return playableSubs.map((sub, at) => subtitleLabel(sub, at))
  }

  function factsOf (info) {
    const rows = []
    const add = (label, value) => {
      if (value) rows.push(h('div', { class: 'hd-vid-fact' }, h('dt', null, label), h('dd', { dir: 'auto' }, value)))
    }
    const meta = info.meta || {}
    add(t('Length'), info.duration ? formatRuntime(info.duration) : '')
    add(t('Resolution'), info.width && info.height ? `${formatNumber(info.width, { useGrouping: false })} × ${formatNumber(info.height, { useGrouping: false })}` : '')
    add(t('Video'), codecName(meta.videoCodec))
    add(t('Audio'), codecName(meta.audioCodec))
    add(t('Size'), formatBytes(info.entry.size))
    const subs = subtitleNames(info.path)
    add(t('Subtitles'), subs.length ? formatList(subs) : t('None'))
    add(t('Genre'), info.genre)
    add(t('Original title'), info.originalTitle)
    add(t('Added'), info.mtime ? formatDate(info.mtime) : '')
    add(t('File'), info.name)
    return h('dl', { class: 'hd-vid-facts' }, rows)
  }

  function moviePage (path) {
    const first = infoAt(path)
    if (!first) return emptyState()
    const item = titleAt(path)
    const backdrop = h('div', { class: 'hd-vid-backdrop', 'aria-hidden': 'true' })
    fillBackdrop(backdrop, titleWants(path), screenAbort.signal)
    const poster = h('span', { class: 'hd-vid-art hd-vid-head-poster', 'aria-hidden': 'true' })
    const hasPoster = Boolean((item && item.poster) || (first.meta && first.meta.cover))
    poster.hidden = !hasPoster
    if (hasPoster) fillArt(poster, titleWants(path, { poster: true }).find(Boolean), 2 / 3)
    const body = h('div', { class: 'hd-vid-head-text' })
    const head = h('header', { class: 'hd-vid-head hd-vid-head--page' }, backdrop, backButton(), h('div', { class: 'hd-vid-head-body' }, poster, body))
    const factsBox = h('div', { class: 'hd-vid-facts-box' })
    wantMeta(first.entry, 'high')

    function draw () {
      const info = infoAt(path) || first
      const saved = progressOf(path)
      const resume = resumable(saved)
      const canHere = playsHere(path)
      redraw(body, [
        item && item.type === 'movie' ? h('p', { class: 'hd-vid-kicker' }, t('Movie')) : null,
        h('h2', { class: 'hd-vid-head-title', tabindex: '-1', dir: 'auto' }, info.title),
        metaLine([yearText(info.year), info.duration ? formatRuntime(info.duration) : '', info.genre], qualityOfInfo(info)),
        description(info.description),
        canHere ? null : h('p', { class: 'hd-vid-head-note' }, icon('alert'), h('span', null, t("This video's format may not play here. Download it to watch it in another app."))),
        h('div', { class: 'hd-vid-head-actions' },
          playButton(resume ? t('Resume') : t('Play'), () => play(path, { resume: resume ? 'auto' : undefined })),
          resume ? button({ label: t('Start over'), icon: 'refresh', variant: 'overlay', className: 'hd-vid-again', onClick: () => play(path, { resume: false }) }) : null,
          button({ label: t('Download'), icon: 'download', variant: 'overlay', className: 'hd-vid-download', onClick: () => download(info) }),
          button({ label: t('Copy link'), icon: 'link', variant: 'overlay', className: 'hd-vid-link', onClick: () => copyLink(path) }),
          phone ? button({ label: t('Share'), icon: 'share', variant: 'overlay', className: 'hd-vid-share', onClick: () => source.share(host, path, info.name) }) : null)
      ])
      replace(factsBox, factsOf(info))
    }
    draw()
    screenApi = { onProgress: draw, onInfo: draw }
    return h('div', { class: 'hd-vid-page hd-vid-page--movie' }, head, h('div', { class: 'hd-vid-page-body' }, factsBox))
  }

  // ---------- Screens and the address ----------

  const content = h('div', { class: 'hd-vid' })
  let screen = { kind: null, id: null, season: null }
  let screenAbort = null
  let screenApi = {}
  let cleanups = []
  let homeScroll = 0
  // Where the focus was on the library when a page was opened from it.
  let comeBack = null
  // True when the page before this one in history is the library's home.
  let backable = false

  function teardownScreen () {
    for (const cleanup of cleanups) {
      try {
        cleanup()
      } catch {}
    }
    cleanups = []
    for (const [section, state] of rowStates) {
      state.destroy()
      if (rowNear) {
        rowNear.unobserve(section)
        rowFar.unobserve(section)
      }
    }
    rowStates.clear()
    grids.length = 0
    if (screenAbort) screenAbort.abort()
    screenAbort = null
    screenApi = {}
    thumbs.detachWithin(content)
  }

  /** Draws a screen: { kind: 'home' | 'show' | 'movie', id, season }. */
  function showScreen (next, { scroll = 'top', focus = false } = {}) {
    if (screen.kind === 'home' && next.kind !== 'home') {
      homeScroll = window.scrollY
      const active = document.activeElement
      const from = active && active.closest ? active.closest('.hd-vid-card') : null
      const row = from && from.closest('[data-row]')
      comeBack = row ? { row: row.dataset.row, item: from.dataset.item } : active && active.classList && active.classList.contains('hd-vid-info') ? { hero: true } : null
    }
    teardownScreen()
    screenAbort = new AbortController()
    screen = { ...next }
    let view
    if (next.kind === 'show') view = showPage(currentShow(next.id), next.season)
    else if (next.kind === 'movie') view = moviePage(next.id)
    else view = homeScreen()
    replace(content, view)
    const hasHead = Boolean(content.querySelector('.hd-vid-head'))
    shell.setOverlayBar(hasHead)
    content.classList.toggle('has-head', hasHead)
    if (scroll === 'top') window.scrollTo(0, 0)
    else if (scroll === 'home') window.scrollTo(0, homeScroll)
    else if (typeof scroll === 'number') window.scrollTo(0, scroll)
    updateBar()
    onScroll()
    if (focus) {
      const title = content.querySelector('.hd-vid-head-title[tabindex]')
      if (title) title.focus({ preventScroll: true })
    }
    if (next.kind === 'home' && comeBack && comeBack.hero) {
      comeBack = null
      const info = content.querySelector('.hd-vid-head--hero .hd-vid-info')
      if (info) info.focus({ preventScroll: true })
    } else if (next.kind === 'home' && comeBack) {
      // Only while the rows come back, not for a row drawn much later.
      const waited = comeBack
      setTimeout(() => {
        if (comeBack === waited) comeBack = null
      }, 3000)
    }
  }

  function seasonFrom (value) {
    return typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : value === 'none' ? null : undefined
  }

  function screenFor (hash) {
    const season = seasonFrom(hash.season)
    if (library.single) return { kind: 'home', id: null, season }
    if (typeof hash.show === 'string' && library.showById.has(hash.show)) return { kind: 'show', id: hash.show, season }
    if (typeof hash.movie === 'string' && library.titleOfPath.has(hash.movie)) return { kind: 'movie', id: hash.movie }
    return { kind: 'home', id: null }
  }

  function openShow (id) {
    const fromHome = screen.kind === 'home'
    ctx.setHash({ show: id }, { push: true })
    showScreen({ kind: 'show', id }, { focus: true })
    backable = fromHome
  }

  function openMovie (path) {
    const fromHome = screen.kind === 'home'
    ctx.setHash({ movie: path }, { push: true })
    showScreen({ kind: 'movie', id: path }, { focus: true })
    backable = fromHome
  }

  // Back to the library: by going Back when the library is the page before.
  function goHome () {
    if (backable) {
      backable = false
      window.history.back()
      return
    }
    ctx.setHash({})
    showScreen({ kind: 'home', id: null }, { scroll: 'home' })
  }

  // The player, or a photo of "Also in this folder", from #item=.
  function openItem (path) {
    if (player && !player.closed && player.current && player.current.path === path) return
    if (videos.some((video) => video.path === path)) {
      play(path, { fromHash: true })
      return
    }
    if (strays.some((entry) => entry.path === path)) openOther(path, { fromHash: true })
  }

  function applyHash (hash, { first = false } = {}) {
    const wanted = screenFor(hash || {})
    const same = wanted.kind === screen.kind && wanted.id === screen.id
    if (!same) {
      const fromHome = screen.kind === 'home'
      showScreen(wanted, { scroll: wanted.kind === 'home' ? 'home' : 'top' })
      backable = !first && fromHome && wanted.kind !== 'home'
    } else if (wanted.season !== undefined && wanted.season !== screen.season && screenApi.selectSeason) {
      screenApi.selectSeason(wanted.season, { fromHash: true })
    }
    if (hash && typeof hash.item === 'string') openItem(hash.item)
  }

  // The same screen drawn again for a new library, where it was.
  function redrawScreen () {
    const y = window.scrollY
    const rows = new Map()
    for (const [section, state] of rowStates) rows.set(section.dataset.row, state.scrollLeft())
    const wanted = screenFor(ctx.route.hash || {})
    if (wanted.kind === 'home') wanted.season = screen.season
    const keep = homeScroll
    showScreen(wanted, { scroll: y })
    homeScroll = keep
    for (const [section, state] of rowStates) {
      const left = rows.get(section.dataset.row)
      if (left) state.wantScroll = left
    }
  }

  // ---------- Details arriving ----------

  const applyInfo = debounce(() => {
    if (signal.aborted) return
    const next = buildLibrary()
    const changed = next.signature !== library.signature
    library = next
    if (changed) {
      redrawScreen()
    } else {
      refreshCards()
      if (screenApi.onInfo) screenApi.onInfo()
      updateBar()
    }
  }, 250)

  function infoChanged (path) {
    if (path) described.delete(path)
    applyInfo()
  }

  // Redraws what shows progress, when it changed.
  async function refreshProgress () {
    const before = progressSeen
    await loadProgress()
    if (signal.aborted || progressSeen === before) return
    refreshCards()
    if (screenApi.onProgress) screenApi.onProgress()
  }

  // The player's last save can land just after it closes, so look again.
  function afterPlayer () {
    refreshProgress()
    setTimeout(refreshProgress, 500)
    setTimeout(refreshProgress, 1500)
  }

  // ---------- The bar ----------

  function updateBar () {
    const parts = []
    if (library.shows.length) parts.push(tp({ one: '{count} show', other: '{count} shows' }, library.shows.length))
    if (library.movies.length) parts.push(tp({ one: '{count} movie', other: '{count} movies' }, library.movies.length))
    if (library.clips.length) parts.push(tp({ one: '{count} video', other: '{count} videos' }, library.clips.length))
    shell.setSubtitle(formatList(parts))
  }

  // Solid behind the bar once the head has scrolled away.
  let scrollTick = 0
  function onScroll () {
    if (scrollTick) return
    scrollTick = requestAnimationFrame(() => {
      scrollTick = 0
      const head = content.querySelector('.hd-vid-head')
      const bar = parseFloat(getComputedStyle(html).getPropertyValue('--hd-bar-h')) || 60
      const solid = !head || window.scrollY > Math.max(24, head.offsetHeight - bar - 96)
      if (solid) html.dataset.hdVidSolid = '1'
      else delete html.dataset.hdVidSolid
    })
  }

  const onResize = debounce(() => {
    if (grids.some((grid) => gridColumns(grid.shape) !== grid.columns)) redrawScreen()
    onScroll()
  }, 200)

  // Escape leaves a show's or a movie's page, as it closes a dialog. It
  // listens first, so it knows what was open before anything closes.
  function onKey (event) {
    if (event.key !== 'Escape' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (screen.kind === 'home' || library.single) return
    if (player && !player.closed) return
    if (document.querySelector('.hd-menu, .hd-layer, .hd-lightbox')) return
    event.preventDefault()
    goHome()
  }

  // ---------- Start ----------

  // Details kept from an earlier visit come first, so the first screen
  // already has the right titles; new ones are read after it is drawn.
  const newest = videos.slice().sort(byNewest)
  const firstDetails = Promise.all([
    loadProgress(),
    readNfos(),
    ...newest.slice(0, FIRST_META).map((video) => wantMeta(video, 'high'))
  ])
  await Promise.race([firstDetails, sleep(FIRST_WAIT)])
  if (signal.aborted) return {}
  applyInfo.cancel()
  library = buildLibrary()

  waiting.remove()
  ctx.root.append(content)
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)
  document.addEventListener('keydown', onKey, true)
  applyHash(route.hash, { first: true })

  // The rest in the background, newest first, a few at a time.
  for (const video of newest.slice(FIRST_META, BACKGROUND_META)) wantMeta(video, 'low')

  return {
    onHash (hash) {
      applyHash(hash)
    },
    unmount () {
      teardownScreen()
      applyInfo.cancel()
      onResize.cancel()
      if (scrollTick) cancelAnimationFrame(scrollTick)
      if (rowNear) {
        rowNear.disconnect()
        rowFar.disconnect()
      }
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('keydown', onKey, true)
      delete html.dataset.hdVidSolid
    }
  }
}
