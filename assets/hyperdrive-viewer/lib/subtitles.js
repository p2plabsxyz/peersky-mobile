// Subtitles beside a video, and SRT turned into WebVTT for <track>. Pure.
import { baseName, extensionOf, fileName, folderIndex, folderOf, kindOf, naturalCompare } from './kinds.js'

// ISO 639-1 code, then other codes and names people put in subtitle names.
const LANGUAGES = `en eng english|fr fre fra french français francais|de ger deu german deutsch|es spa spanish español
espanol castellano latino|it ita italian italiano|pt por portuguese português portugues brazilian|nl dut nld dutch
nederlands flemish|sv swe swedish svenska|no nor norwegian norsk|nb nob bokmål bokmal|nn nno nynorsk|da dan danish
dansk|fi fin finnish suomi|is ice isl icelandic íslenska|pl pol polish polski|cs cze ces czech čeština cestina|sk slo
slk slovak slovenčina|sl slv slovenian slovene|hu hun hungarian magyar|ro rum ron romanian română romana|bg bul
bulgarian български|ru rus russian русский|uk ukr ukrainian українська|be bel belarusian|sr srp serbian srpski
српски|hr hrv croatian hrvatski|bs bos bosnian|mk mac mkd macedonian|sq alb sqi albanian|el gre ell greek
ελληνικά|tr tur turkish türkçe turkce|he heb iw hebrew עברית|ar ara arabic العربية|fa per fas persian farsi
فارسی|ur urd urdu|hi hin hindi हिन्दी|bn ben bengali bangla|pa pan punjabi|gu guj gujarati|mr mar marathi
मराठी|ta tam tamil|te tel telugu|kn kan kannada|ml mal malayalam|si sin sinhala sinhalese|ne nep nepali|th tha thai
ไทย|vi vie vietnamese|id ind indonesian|ms may msa malay melayu|tl tgl fil tagalog filipino|zh chi zho chs cht
chinese mandarin cantonese 中文|ja jpn japanese 日本語|ko kor korean 한국어|et est estonian eesti|lv lav latvian|lt
lit lithuanian|ca cat catalan català|eu baq eus basque euskara|gl glg galician galego|cy wel cym welsh cymraeg|ga
gle irish gaeilge|hy arm hye armenian|ka geo kat georgian|az aze azerbaijani|kk kaz kazakh|uz uzb uzbek|sw swa
swahili kiswahili|af afr afrikaans|am amh amharic|km khm khmer|lo lao|my bur mya burmese|mn mon mongolian|la lat
latin|eo epo esperanto`

const LANGUAGE_OF = new Map()
for (const row of LANGUAGES.replace(/\n/g, ' ').split('|')) {
  const [code, ...names] = row.trim().split(/\s+/)
  for (const name of [code, ...names]) LANGUAGE_OF.set(name, code)
}

const SUBS_FOLDER = /^(subs|subtitles|sub)$/i
const PLAYABLE = new Set(['srt', 'vtt'])
const MAX_TEXT = 8 * 1024 * 1024
// No cue line is this long; a longer one is cut, which keeps every pattern cheap.
const MAX_LINE = 4096

// en, eng, english, en-US, zh-Hans: the ISO 639-1 code, or null.
function languageOf (tag) {
  const word = tag.toLowerCase()
  if (LANGUAGE_OF.has(word)) return LANGUAGE_OF.get(word)
  const region = /^([a-z]{2,3})[-_][a-z0-9]{2,4}$/.exec(word)
  return region && LANGUAGE_OF.has(region[1]) ? LANGUAGE_OF.get(region[1]) : null
}

// The language and flags in what follows a video's name: ".eng.forced",
// "2_English", "English (SDH)".
function describe (rest) {
  const tags = rest.replace(/^\d+[_. -]+/, '').split(/[\s._()[\]-]+/).filter(Boolean).slice(0, 12)
  let language = null
  let forced = false
  let sdh = false
  for (const tag of tags) {
    const word = tag.toLowerCase()
    if (word === 'forced' || word === 'foreign') forced = true
    else if (word === 'sdh' || word === 'cc' || (word === 'hi' && language)) sdh = true
    else if (!language) language = languageOf(word)
  }
  if (!language && /hearing.?impaired/i.test(rest)) sdh = true
  return { language, forced, sdh }
}

/**
 * The subtitles a <video> can show for a video: <base>.srt, <base>.en.srt,
 * <base>.eng.forced.srt, <base>.English.sdh.vtt, Subs/<base>/*.srt and
 * Subs/*.srt. Only SRT and WebVTT; label is left for the UI.
 */
export function subtitlesFor (videoPath, entries) {
  const video = String(videoPath ?? '')
  const folder = folderOf(video)
  const base = baseName(video).toLowerCase()
  if (!base || !Array.isArray(entries)) return []
  const index = folderIndex(entries)
  const here = index.files.get(folder) || []
  // This folder, its Subs folders and the folders in those. concat, not
  // push(...list): a long list would pass too many arguments.
  let nearby = here
  for (const name of index.folders.get(folder) || []) {
    if (!SUBS_FOLDER.test(name)) continue
    const subs = folder + name + '/'
    nearby = nearby.concat(index.files.get(subs) || [])
    for (const inner of index.folders.get(subs) || []) nearby = nearby.concat(index.files.get(subs + inner + '/') || [])
  }
  const videoBases = [base]
  const found = []
  const seen = new Set()
  for (const entry of here) {
    if (entry.path !== video && kindOf(entry.path, entry.size) === 'video') videoBases.push(baseName(entry.path).toLowerCase())
  }
  // The video a subtitle is named after: the longest video name it starts with.
  const videos = new Set(videoBases)
  const owner = (name) => {
    if (videos.has(name)) return name
    for (let dot = name.lastIndexOf('.'), tries = 0; dot > 0 && tries < 16; dot = name.lastIndexOf('.', dot - 1), tries++) {
      if (videos.has(name.slice(0, dot))) return name.slice(0, dot)
    }
    return undefined
  }
  const add = (path, rest) => {
    if (seen.has(path)) return
    seen.add(path)
    found.push({ path, ...describe(rest), format: extensionOf(path), label: null })
  }
  for (const entry of nearby) {
    const path = entry.path
    if (!PLAYABLE.has(extensionOf(path))) continue
    const inner = path.slice(folder.length).split('/')
    const lower = baseName(fileName(path)).toLowerCase()
    if (inner.length === 1) {
      if (owner(lower) === base) add(path, lower.slice(base.length))
    } else if (SUBS_FOLDER.test(inner[0]) && inner.length === 2) {
      // Subs/<base>.en.srt, or Subs/English.srt when this is the only video.
      if (owner(lower) === base) add(path, lower.slice(base.length))
      else if (!owner(lower) && videos.size === 1) add(path, lower)
    } else if (SUBS_FOLDER.test(inner[0]) && inner.length === 3 && inner[1].toLowerCase() === base) {
      add(path, lower)
    }
  }
  return found.sort((a, b) => {
    const plainA = baseName(fileName(a.path)).toLowerCase() === base
    const plainB = baseName(fileName(b.path)).toLowerCase() === base
    return plainA !== plainB ? (plainA ? -1 : 1) : naturalCompare(a.path, b.path)
  })
}

const TIMING = /^\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/

function milliseconds (hours, minutes, seconds, fraction) {
  const m = Number(minutes)
  const s = Number(seconds)
  if (m > 59 || s > 59) return null
  return ((Number(hours || 0) * 60 + m) * 60 + s) * 1000 + Number(fraction.padEnd(3, '0'))
}

function timestamp (ms) {
  const pad = (value, size = 2) => String(value).padStart(size, '0')
  const hours = Math.floor(ms / 3600000)
  return `${pad(hours)}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`
}

// Cue text for WebVTT: keep <i>, <b> and <u>, drop {\an8} and <font>, and
// escape what WebVTT would read as markup.
function cueText (line) {
  return line
    .replace(/\{\\[^}]{0,200}\}/g, '')
    .replace(/<\/?font\b[^>]{0,200}>/gi, '')
    .replace(/&(?!(amp|lt|gt|nbsp|lrm|rlm);)/g, '&amp;')
    .replace(/<(?!\/?[ibu]>)/gi, '&lt;')
    .replace(/-->/g, '->')
}

/** SRT text as WebVTT. Cues that do not parse are left out. */
export function srtToVtt (text) {
  const source = String(text ?? '').slice(0, MAX_TEXT).replace(/^\ufeff/, '')
  const lines = source.split(/\r\n|\r|\n/)
  const cues = []
  let cue = null
  const close = () => {
    if (cue && cue.text.length) cues.push(`${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text.join('\n')}`)
    cue = null
  }
  for (const whole of lines) {
    const line = whole.length > MAX_LINE ? whole.slice(0, MAX_LINE) : whole
    const timing = TIMING.exec(line)
    if (timing) {
      // A cue with no blank line before the next one: its last line was the
      // next cue's number.
      if (cue && cue.text.length && /^\s*\d+\s*$/.test(cue.text[cue.text.length - 1])) cue.text.pop()
      close()
      const start = milliseconds(timing[1], timing[2], timing[3], timing[4])
      const end = milliseconds(timing[5], timing[6], timing[7], timing[8])
      if (start !== null && end !== null && end >= start) cue = { start, end, text: [] }
    } else if (!line.trim()) {
      close()
    } else if (cue) {
      const cleaned = cueText(line)
      if (cleaned.trim()) cue.text.push(cleaned)
    }
  }
  close()
  return `WEBVTT\n\n${cues.join('\n\n')}${cues.length ? '\n' : ''}`
}
