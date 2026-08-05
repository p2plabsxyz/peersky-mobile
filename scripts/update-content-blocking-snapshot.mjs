import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FILTER_LIST_SOURCES,
  MAX_FILTER_LIST_BYTES,
  validateFilterListSnapshot
} from '../app/privacy/filter-lists.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(projectRoot, 'assets', 'content-blocking')
const temporaryDirectory = `${outputDirectory}.tmp`
const backupDirectory = `${outputDirectory}.previous`
const timeoutMs = 30_000

await rm(temporaryDirectory, { force: true, recursive: true })
await rm(backupDirectory, { force: true, recursive: true })
await mkdir(temporaryDirectory, { recursive: true })

let previousSnapshotMoved = false
try {
  const lists = []
  for (const source of FILTER_LIST_SOURCES) {
    const bytes = await downloadBoundedList(source)
    const filename = `${source.id}.txt`
    await writeFile(path.join(temporaryDirectory, filename), bytes)
    lists.push({
      id: source.id,
      title: source.title,
      url: source.url,
      filename,
      byteLength: bytes.byteLength,
      version: readListVersion(bytes)
    })
  }

  const generatedAt = new Date().toISOString()
  await writeFile(path.join(temporaryDirectory, 'manifest.json'), `${JSON.stringify({
    generatedAt,
    lists
  }, null, 2)}\n`)
  try {
    await rename(outputDirectory, backupDirectory)
    previousSnapshotMoved = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await rename(temporaryDirectory, outputDirectory)
  await rm(backupDirectory, { force: true, recursive: true })
  previousSnapshotMoved = false
  console.log(`Updated bundled content-blocking snapshot (${generatedAt}).`)
} catch (error) {
  await rm(temporaryDirectory, { force: true, recursive: true })
  if (previousSnapshotMoved) {
    await rm(outputDirectory, { force: true, recursive: true })
    await rename(backupDirectory, outputDirectory)
  }
  throw error
}

async function downloadBoundedList (source) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(source.url, {
      headers: { Accept: 'text/plain' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`${source.title} returned HTTP ${response.status}.`)
    const responseUrl = new URL(response.url)
    if (responseUrl.protocol !== 'https:' || responseUrl.username || responseUrl.password) {
      throw new Error(`${source.title} redirected to an unsafe URL.`)
    }

    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FILTER_LIST_BYTES) {
      throw new Error(`${source.title} exceeds the size limit.`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error(`${source.title} did not return a readable body.`)
    const chunks = []
    let byteLength = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_FILTER_LIST_BYTES) {
        await reader.cancel()
        throw new Error(`${source.title} exceeds the size limit.`)
      }
      chunks.push(value)
    }

    const bytes = Buffer.concat(chunks, byteLength)
    const validation = validateFilterListSnapshot({
      id: source.id,
      byteLength,
      preamble: bytes.subarray(0, 512).toString('latin1')
    })
    if (!validation.ok) throw new Error(`${source.title}: ${validation.error}`)
    return bytes
  } finally {
    clearTimeout(timeout)
  }
}

function readListVersion (bytes) {
  const header = bytes.subarray(0, 16 * 1024).toString('utf8')
  const match = /^!\s*(?:Version|Last modified):\s*(.+)$/im.exec(header)
  return match?.[1]?.trim() || 'unreported'
}
