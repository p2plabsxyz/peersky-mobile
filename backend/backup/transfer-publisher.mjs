import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import b4a from 'b4a'
import sodium from 'sodium-native'

// A phone sending to another phone puts the encrypted transfer file on a
// drive of its own for as long as the transfer lives, and the other phone
// fetches it like any hyper:// file. It lives in the ordinary store so the
// other phone can find it the usual ways, over the internet or the local
// network, and its data is cleared once the transfer is done or has expired,
// so transfers never pile up in storage.
export const TRANSFER_FILE_NAME = '/transfer.peersky'
const READ_CHUNK_BYTES = 256 * 1024

// A fresh drive for every send, so a second attempt with the same code never
// serves the first attempt's file, or one half cleared.
export function transferDriveName (nonce) {
  const suffix = b4a.alloc(4)
  sodium.randombytes_buf(suffix)
  return `peersky-transfer-${String(nonce).toLowerCase()}-${b4a.toString(suffix, 'hex')}`
}

export async function publishTransferFile (runtime, { driveName, filePath, fileName = TRANSFER_FILE_NAME, onProgress } = {}) {
  const drive = await runtime.getDrive(driveName)
  await writeFileToDrive(drive, fileName, filePath, onProgress)

  // Announced before the code is shown, so the other phone does not scan it
  // into a lookup that cannot find anyone yet.
  try {
    if (runtime.swarm && typeof runtime.swarm.flush === 'function') await runtime.swarm.flush()
  } catch {}

  return { url: `hyper://${drive.id}${fileName}`, driveName }
}

/**
 * Clears a transfer's data from this device and stops announcing it, for the
 * sender once the transfer is over and for the receiver's fetched copy.
 * Hyperdrive's purge calls a method missing from the hypercore release in use,
 * so the file's blocks are cleared instead. The index stays: it is a few KB,
 * and a drive without it hangs forever on open, waiting for blocks nobody has.
 */
export async function purgeTransferDrive (runtime, nameOrUrl) {
  const drive = await runtime.getDrive(nameOrUrl, { autoJoin: false })
  try {
    const blobs = await drive.getBlobs()
    if (blobs?.core?.length) await blobs.core.clear(0, blobs.core.length)
  } finally {
    await drive.close()
  }
}

export async function writeFileToDrive (drive, path, filePath, onProgress) {
  const fd = openSync(filePath, 'r')
  const stream = drive.createWriteStream(path)
  let failure = null
  stream.on('error', (error) => { failure = failure || error })
  // Settles on finish, or on an error or close first. Watched from the start,
  // so a failure part way through is never left unhandled: in Bare an
  // unhandled rejection aborts the whole worklet.
  const settled = new Promise((resolve, reject) => {
    stream.once('finish', resolve)
    stream.once('error', reject)
    stream.once('close', () => (failure ? reject(failure) : resolve()))
  })
  settled.catch(() => {})

  try {
    const size = fstatSync(fd).size
    let offset = 0
    while (offset < size) {
      if (failure) throw failure
      const chunk = b4a.alloc(Math.min(READ_CHUNK_BYTES, size - offset))
      const read = readSync(fd, chunk, 0, chunk.byteLength, offset)
      if (read === 0) throw new Error('Transfer file changed while it was being shared')
      offset += read
      if (!stream.write(read === chunk.byteLength ? chunk : chunk.subarray(0, read))) {
        await waitForDrain(stream)
      }
      if (onProgress) onProgress(offset, size)
    }
    stream.end()
    await settled
  } catch (error) {
    stream.destroy()
    throw failure || error
  } finally {
    closeSync(fd)
  }
}

// A destroyed stream never drains, so an error or a close ends the wait too.
export function waitForDrain (stream) {
  return new Promise((resolve, reject) => {
    const done = (callback) => (value) => {
      stream.off('drain', onDrain)
      stream.off('error', onError)
      stream.off('close', onClose)
      callback(value)
    }
    const onDrain = done(resolve)
    const onError = done(reject)
    const onClose = done(() => reject(new Error('The stream closed before it drained')))
    stream.on('drain', onDrain)
    stream.on('error', onError)
    stream.on('close', onClose)
  })
}
