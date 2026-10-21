import { getHyperFetchPath, parseHyperUrl } from '../hyper/url.mjs'

// PeerTunes keeps a shared playlist on the device song by song. Its folder is
// kept the usual way, through the offline list, but a playlist can name songs
// that sit in other drives, and keeping the folder never saved those. Here
// each song is checked on its own, fetched in the background while it is
// missing, and only called saved once every block of it is on the device.

export const MAX_KEEP_SONGS_PER_REQUEST = 20
// Songs being fetched at once. Each is one range request on its drive.
const MAX_SONG_DOWNLOADS = 1000
// A check reads what is already here. A drive or a header that would have to
// come from the network first does not get to hold it up.
const CHECK_TIMEOUT_MS = 4000
// How often a drive that nobody is sharing right now is looked for again.
const LOOK_AGAIN_MS = 30 * 1000
// Separate drives one keeper opens. A playlist can name songs in any drive,
// and each drive opened joins its swarm and stays open.
export const MAX_KEEP_DRIVES = 100

/**
 * @param {object} options
 * @param {(address: string, task: (drive: object) => Promise<any>) => Promise<any>} options.openDrive
 *   Runs task with the drive at a hyper:// drive address.
 * @param {(url: string) => Promise<any>} [options.refreshNetwork]
 *   Looks for the peers of the drive behind url again.
 * @param {() => boolean} [options.mayDownload] False while Download only on
 *   Wi-Fi is on and the phone is on cellular.
 */
export function createSongKeeper ({ openDrive, refreshNetwork = async () => {}, mayDownload = () => true, now = Date.now }) {
  const downloads = new Map()
  const lookedAt = new Map()
  const drives = new Set()

  /**
   * Which of these songs are on the device. One that is not is fetched, and
   * reported as saving (part of it is here and someone has the rest) or
   * waiting (nobody who has it is online). One it cannot tell yet is in no
   * list.
   */
  async function keep (urls) {
    // On cellular with Download only on Wi-Fi, nothing new starts and what
    // was going stops, as the kept folders' downloads do.
    const allowed = mayDownload() !== false
    if (!allowed) stopDownloads()
    const songs = []
    for (const url of Array.isArray(urls) ? urls : []) {
      if (songs.length >= MAX_KEEP_SONGS_PER_REQUEST) break
      const target = typeof url === 'string' ? parseHyperUrl(url) : { error: 'Not a song' }
      if (target.error || target.driveAddress === 'default' || target.pathname.endsWith('/')) continue
      if (!drives.has(target.driveAddress)) {
        if (drives.size >= MAX_KEEP_DRIVES) continue
        drives.add(target.driveAddress)
      }
      songs.push({ url, target })
    }

    const states = await Promise.all(songs.map((song) => check(song, allowed)))
    const answer = { ok: true, saved: [], saving: [], waiting: [] }
    songs.forEach((song, index) => {
      // A song that is not all here waits for Wi-Fi.
      const state = allowed || states[index] === 'saved' || states[index] === 'unknown' ? states[index] : 'waiting'
      if (answer[state]) answer[state].push(song.url)
      // Whoever shares it may be back: look for them again, now and then.
      if (allowed && state === 'waiting') lookAgain(song)
    })
    return answer
  }

  async function check ({ url, target }, allowed) {
    const path = getHyperFetchPath(target.pathname)
    try {
      return await openDrive(target.driveAddress, async (drive) => {
        const state = await songState(drive, path)
        if (state !== 'saved' && allowed) fetchSong(url, drive, path)
        return state
      })
    } catch {
      return 'unknown'
    }
  }

  function stopDownloads () {
    for (const download of downloads.values()) {
      try {
        download.destroy?.()
      } catch {}
    }
    downloads.clear()
  }

  function fetchSong (url, drive, path) {
    if (downloads.has(url) || downloads.size >= MAX_SONG_DOWNLOADS) return
    let download
    try {
      download = drive.download(path)
    } catch {
      return
    }
    downloads.set(url, download)
    // Done, failed or stopped, the next check looks again and starts over
    // whatever is still missing.
    Promise.resolve()
      .then(() => download.done())
      .catch(() => {})
      .finally(() => {
        if (downloads.get(url) === download) downloads.delete(url)
      })
  }

  function lookAgain ({ url, target }) {
    const last = lookedAt.get(target.driveAddress)
    if (last !== undefined && now() - last < LOOK_AGAIN_MS) return
    lookedAt.set(target.driveAddress, now())
    Promise.resolve().then(() => refreshNetwork(url)).catch(() => {})
  }

  return {
    keep,
    get downloading () { return downloads.size }
  }
}

/**
 * Where one song of a drive stands: 'saved', 'saving', 'waiting', or
 * 'queued' when someone has it but none of it has arrived yet.
 */
export async function songState (drive, path) {
  // What is on the device only. A song whose entry is not here yet is not
  // here, and asking the network for it is the download's job.
  const entry = await within(drive.entry(path, { wait: false, update: false }), CHECK_TIMEOUT_MS)
  const blob = entry?.value?.blob || null
  const blobs = blob ? drive.blobs || await within(drive.getBlobs(), CHECK_TIMEOUT_MS) : null
  if (blob && blobs && await within(drive.has(path), CHECK_TIMEOUT_MS) === true) return 'saved'
  if (!hasPeers(drive)) return 'waiting'
  const started = blob && blobs ? await within(blobs.core.has(blob.blockOffset), CHECK_TIMEOUT_MS) : false
  return started === true ? 'saving' : 'queued'
}

function hasPeers (drive) {
  const count = (core) => (Array.isArray(core?.peers) ? core.peers.length : 0)
  return count(drive.core) > 0 || count(drive.blobs?.core) > 0
}

// The value, or undefined once ms have gone by. A promise left over settles
// on its own and is ignored.
export function within (promise, ms) {
  let timer = null
  const late = new Promise((resolve) => { timer = setTimeout(resolve, ms) })
  return Promise.race([Promise.resolve(promise).catch(() => undefined), late])
    .finally(() => clearTimeout(timer))
}
