/* eslint-env browser */
// What the viewer keeps about a drive's files: small pictures (thumbs), what
// was read from inside the files (meta), how far a video was watched
// (progress), and the epoch the rest belongs to (info).
//
// A public drive outside incognito keeps it in IndexedDB, so a folder opens
// fast the next time. A private drive, or anything in incognito, keeps it in
// memory only: nothing derived from an encrypted drive is ever written to
// disk. Every failure falls back to memory without a word.
//
// The epoch: PeerSky moves it on Burn, Clear all P2P data, Remove my data and
// a restore. A database written in another epoch is emptied when opened.

const DB_NAME = 'peersky-drive-views'
const DB_VERSION = 1
const NAMES = ['thumbs', 'meta', 'progress']

const DISK_LIMITS = { thumbs: 4000, thumbBytes: 120 * 1024 * 1024, meta: 20000, progress: 2000 }
const MEMORY_LIMITS = { thumbs: 1500, thumbBytes: 60 * 1024 * 1024, meta: 20000, progress: 2000 }

function memoryBackend (limits) {
  const maps = { thumbs: new Map(), meta: new Map(), progress: new Map() }
  let thumbBytes = 0

  function drop (name, key) {
    const record = maps[name].get(key)
    if (!record) return
    maps[name].delete(key)
    if (name === 'thumbs') thumbBytes -= record.bytes
  }

  return {
    persistent: false,
    async get (name, key) {
      const record = maps[name].get(key)
      return record ? record.value : null
    },
    async put (name, key, value, bytes = 0) {
      drop(name, key)
      maps[name].set(key, { key, value, bytes, at: Date.now() })
      if (name === 'thumbs') thumbBytes += bytes
      const map = maps[name]
      const limit = limits[name]
      const counted = name === 'thumbs'
      const over = () => map.size > limit || (counted && thumbBytes > limits.thumbBytes && map.size > 1)
      // A Map keeps the order things were set in: the oldest go first.
      while (over()) drop(name, map.keys().next().value)
    },
    async delete (name, key) {
      drop(name, key)
    },
    async list (name, prefix) {
      const out = []
      for (const record of maps[name].values()) {
        if (record.key.startsWith(prefix)) out.push({ key: record.key, value: record.value, at: record.at })
      }
      return out.sort((a, b) => b.at - a.at)
    }
  }
}

function promised (request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function done (transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error || new Error('aborted'))
  })
}

function openDatabase () {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no IndexedDB'))
      return
    }
    // Some engines never answer when storage is off; memory it is then.
    const timer = setTimeout(() => reject(new Error('IndexedDB did not open')), 3000)
    let request
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      clearTimeout(timer)
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of NAMES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'key' }).createIndex('at', 'at')
      }
      if (!db.objectStoreNames.contains('info')) db.createObjectStore('info', { keyPath: 'key' })
    }
    request.onsuccess = () => {
      clearTimeout(timer)
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => {
      clearTimeout(timer)
      reject(request.error)
    }
    request.onblocked = () => {
      clearTimeout(timer)
      reject(new Error('IndexedDB is blocked'))
    }
  })
}

async function diskBackend (epoch, limits) {
  const db = await openDatabase()

  // Another epoch: everything goes before anything is read.
  const info = await promised(db.transaction('info').objectStore('info').get('epoch'))
  if (!info || info.value !== epoch) {
    const transaction = db.transaction([...NAMES, 'info'], 'readwrite')
    for (const name of [...NAMES, 'info']) transaction.objectStore(name).clear()
    transaction.objectStore('info').put({ key: 'epoch', value: epoch })
    await done(transaction)
  }

  const counts = {}
  let thumbBytes = null
  let evicting = false

  async function tally (name) {
    if (counts[name] === undefined) {
      counts[name] = await promised(db.transaction(name).objectStore(name).count())
    }
    if (name === 'thumbs' && thumbBytes === null) {
      thumbBytes = 0
      await new Promise((resolve, reject) => {
        const request = db.transaction('thumbs').objectStore('thumbs').openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return resolve()
          thumbBytes += Number(cursor.value.bytes) || 0
          cursor.continue()
        }
        request.onerror = () => reject(request.error)
      })
    }
  }

  // Oldest first, down to nine tenths of the limit, so this runs rarely.
  async function evict (name) {
    const over = () => counts[name] > limits[name] || (name === 'thumbs' && thumbBytes > limits.thumbBytes)
    if (evicting || !over()) return
    evicting = true
    try {
      const countGoal = Math.floor(limits[name] * 0.9)
      const bytesGoal = Math.floor(limits.thumbBytes * 0.9)
      const transaction = db.transaction(name, 'readwrite')
      const request = transaction.objectStore(name).index('at').openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const enough = counts[name] <= countGoal && (name !== 'thumbs' || thumbBytes <= bytesGoal)
        if (enough) return
        if (name === 'thumbs') thumbBytes -= Number(cursor.value.bytes) || 0
        counts[name]--
        cursor.delete()
        cursor.continue()
      }
      await done(transaction)
    } finally {
      evicting = false
    }
  }

  return {
    persistent: true,
    async get (name, key) {
      const record = await promised(db.transaction(name).objectStore(name).get(key))
      if (!record) return null
      if (name === 'thumbs') return new Blob([record.data], { type: record.type || 'image/jpeg' })
      return record.value
    },
    async put (name, key, value, bytes = 0) {
      await tally(name)
      const store = db.transaction(name, 'readwrite').objectStore(name)
      const existing = await promised(store.count(key))
      let record
      if (name === 'thumbs') {
        // Kept as bytes: some WebViews have stored Blobs badly.
        const data = await value.arrayBuffer()
        record = { key, data, type: value.type, bytes: data.byteLength, at: Date.now() }
        if (!existing) thumbBytes += data.byteLength
      } else {
        record = { key, value, at: Date.now() }
      }
      const transaction = db.transaction(name, 'readwrite')
      transaction.objectStore(name).put(record)
      await done(transaction)
      if (!existing) counts[name]++
      await evict(name)
    },
    async delete (name, key) {
      const transaction = db.transaction(name, 'readwrite')
      transaction.objectStore(name).delete(key)
      await done(transaction)
      if (counts[name] !== undefined) counts[name] = Math.max(0, counts[name] - 1)
      thumbBytes = name === 'thumbs' ? null : thumbBytes
    },
    async list (name, prefix) {
      const range = IDBKeyRange.bound(prefix, prefix + '￿')
      const records = await promised(db.transaction(name).objectStore(name).getAll(range))
      return records
        .map((record) => ({ key: record.key, value: record.value, at: record.at }))
        .sort((a, b) => b.at - a.at)
    }
  }
}

/**
 * The store for one drive. persistent: false (a private drive, incognito)
 * keeps everything in memory.
 * @param {{ host: string, persistent: boolean, epoch: number }} options
 */
export async function openStore ({ host, persistent, epoch = 0 }) {
  let backend = null
  if (persistent) {
    try {
      backend = await diskBackend(epoch, DISK_LIMITS)
    } catch {
      backend = null
    }
  }
  const memory = memoryBackend(MEMORY_LIMITS)
  if (!backend) backend = memory

  // A failing disk hands over to memory for the rest of the visit.
  async function run (method, ...args) {
    if (backend !== memory) {
      try {
        return await backend[method](...args)
      } catch {
        backend = memory
      }
    }
    return memory[method](...args)
  }

  const key = (path, size, mtime) => `${host}|${path}|${size ?? ''}|${mtime ?? ''}`
  const prefix = `${host}|`

  return Object.freeze({
    get persistent () {
      return backend.persistent
    },
    /** The key of one version of a file: '<host>|<path>|<size>|<mtime>'. */
    key,
    /** Same as key(), from an entry { path, size, mtime }. */
    keyOf: (entry) => key(entry.path, entry.size, entry.mtime),
    get: (name, itemKey) => run('get', name, itemKey),
    put: (name, itemKey, value, bytes) => run('put', name, itemKey, value, bytes),
    delete: (name, itemKey) => run('delete', name, itemKey),
    /** Records of this drive in a store, newest first: [{ key, value, at }]. */
    list: (name) => run('list', name, prefix),
    getThumb: (itemKey) => run('get', 'thumbs', itemKey),
    putThumb: (itemKey, blob) => run('put', 'thumbs', itemKey, blob, blob.size),
    getMeta: (itemKey) => run('get', 'meta', itemKey),
    putMeta: (itemKey, value) => run('put', 'meta', itemKey, value),
    getProgress: (itemKey) => run('get', 'progress', itemKey),
    putProgress: (itemKey, value) => run('put', 'progress', itemKey, value),
    deleteProgress: (itemKey) => run('delete', 'progress', itemKey),
    /** How far each video of this drive was watched, newest first. */
    listProgress: () => run('list', 'progress', prefix)
  })
}
