// Reading a note's pictures for the preview and exports. A note can name
// pictures on any drive, and each drive it names that this phone has not
// opened is looked up on the network, so a note gets a few drives, a few
// reads at a time, and no more waiting than the preview can afford.
export const NOTE_IMAGE_READS_AT_ONCE = 4
export const MAX_NOTE_IMAGE_DRIVES = 8

/**
 * Reads urls with readFile, at most atOnce at a time, from at most maxDrives
 * drives, and stops starting reads after waitMs. Resolves with the results
 * that came back by then, by url. A read still going on is left to finish on
 * its own, so its picture is ready the next time.
 */
export async function readNoteImages (urls, readFile, {
  atOnce = NOTE_IMAGE_READS_AT_ONCE,
  maxDrives = MAX_NOTE_IMAGE_DRIVES,
  waitMs = 15000
} = {}) {
  const drives = new Set()
  const wanted = []
  for (const url of new Set(urls)) {
    const drive = driveOf(url)
    if (!drive) continue
    if (!drives.has(drive)) {
      if (drives.size >= maxDrives) continue
      drives.add(drive)
    }
    wanted.push(url)
  }

  const results = new Map()
  const deadline = Date.now() + waitMs
  let next = 0
  async function work () {
    while (next < wanted.length && Date.now() < deadline) {
      const url = wanted[next++]
      try {
        const result = await readFile({ url })
        if (Date.now() <= deadline) results.set(url, result)
      } catch {}
    }
  }

  let timer
  const waited = new Promise((resolve) => { timer = setTimeout(resolve, waitMs) })
  await Promise.race([
    Promise.all(Array.from({ length: Math.min(atOnce, wanted.length) }, work)),
    waited
  ])
  clearTimeout(timer)
  return results
}

function driveOf (url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'hyper:' && parsed.hostname ? parsed.hostname.toLowerCase() : null
  } catch {
    return null
  }
}
