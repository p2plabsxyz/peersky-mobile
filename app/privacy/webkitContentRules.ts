import { Directory, File, type FileHandle } from 'expo-file-system'
import type { FilterListState } from './filterListStore'
import { getFilterListFiles } from './filterListStore'
import {
  convertFilterListToWebKitRulesAsync,
  serializeWebKitContentRuleChunks,
  WEBKIT_RULE_FORMAT_VERSION
} from './webkit-content-rules.mjs'

const WEBKIT_RULE_SUFFIX = '.webkit.json'
const MIN_WEBKIT_RULES_PER_LIST = 1_000

export async function getWebKitContentRuleFiles (state: FilterListState) {
  const sourceFiles = getFilterListFiles(state)
  const ruleFiles = sourceFiles.map((sourceFile) => new File(
    sourceFile.parentDirectory,
    `${sourceFile.name.slice(0, -'.txt'.length)}.v${WEBKIT_RULE_FORMAT_VERSION}${WEBKIT_RULE_SUFFIX}`
  ))

  // Converted rules are cached against the filter-list snapshot, which does not
  // move when the converter changes. The version in the name is what makes a
  // wrong rule file unreachable; this is what stops it sitting there, because
  // each one runs to several megabytes.
  removeStaleRuleFiles(sourceFiles[0]?.parentDirectory, ruleFiles)

  for (let index = 0; index < sourceFiles.length; index++) {
    const ruleFile = ruleFiles[index]
    if (ruleFile.exists && ruleFile.size > 0) continue

    const rules = await convertFilterListToWebKitRulesAsync(await sourceFiles[index].text())
    if (rules.length < MIN_WEBKIT_RULES_PER_LIST) {
      throw new Error('Filter list produced too few supported WebKit rules.')
    }
    await writeRuleFileAtomically(
      ruleFile,
      await serializeWebKitContentRuleChunks(rules)
    )
  }

  return ruleFiles
}

function removeStaleRuleFiles (directory: Directory | undefined, keep: File[]) {
  if (!directory) return
  const wanted = new Set(keep.map((file) => file.name))

  try {
    for (const entry of directory.list()) {
      if (entry instanceof File &&
          entry.name.endsWith(WEBKIT_RULE_SUFFIX) &&
          !wanted.has(entry.name)) {
        entry.delete()
      }
    }
  } catch (error) {
    console.warn('Unable to remove stale WebKit rule files:', error)
  }
}

async function writeRuleFileAtomically (destination: File, chunks: string[]) {
  const temporary = new File(destination.parentDirectory, `${destination.name}.tmp`)
  if (temporary.exists) temporary.delete()
  temporary.create()
  let handle: FileHandle | null = temporary.open()

  try {
    handle.writeBytes(encodeUtf8('['))
    for (let index = 0; index < chunks.length; index++) {
      if (index > 0) handle.writeBytes(encodeUtf8(','))
      handle.writeBytes(encodeUtf8(chunks[index]))
      await yieldToEventLoop()
    }
    handle.writeBytes(encodeUtf8(']'))
    handle.close()
    handle = null
    if (destination.exists) destination.delete()
    temporary.move(destination)
  } catch (error) {
    handle?.close()
    handle = null
    if (temporary.exists) temporary.delete()
    throw error
  } finally {
    handle?.close()
  }
}

function encodeUtf8 (value: string) {
  const encoded = encodeURIComponent(value)
  const bytes = []

  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === '%') {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16))
      index += 2
    } else {
      bytes.push(encoded.charCodeAt(index))
    }
  }
  return Uint8Array.from(bytes)
}

function yieldToEventLoop () {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}
