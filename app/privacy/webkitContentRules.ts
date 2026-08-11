import { File, type FileHandle } from 'expo-file-system'
import type { FilterListState } from './filterListStore'
import { getFilterListFiles } from './filterListStore'
import {
  convertFilterListToWebKitRulesAsync,
  serializeWebKitContentRuleChunks
} from './webkit-content-rules.mjs'

const WEBKIT_RULE_SUFFIX = '.webkit.json'
const MIN_WEBKIT_RULES_PER_LIST = 1_000

export async function getWebKitContentRuleFiles (state: FilterListState) {
  const sourceFiles = getFilterListFiles(state)
  const ruleFiles: File[] = []

  for (const sourceFile of sourceFiles) {
    const ruleFile = new File(
      sourceFile.parentDirectory,
      `${sourceFile.name.slice(0, -'.txt'.length)}${WEBKIT_RULE_SUFFIX}`
    )
    if (!ruleFile.exists || ruleFile.size === 0) {
      const rules = await convertFilterListToWebKitRulesAsync(await sourceFile.text())
      if (rules.length < MIN_WEBKIT_RULES_PER_LIST) {
        throw new Error('Filter list produced too few supported WebKit rules.')
      }
      await writeRuleFileAtomically(
        ruleFile,
        await serializeWebKitContentRuleChunks(rules)
      )
    }
    ruleFiles.push(ruleFile)
  }

  return ruleFiles
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
