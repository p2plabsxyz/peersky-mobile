import { File } from 'expo-file-system'
import type { FilterListState } from './filterListStore'
import { getFilterListFiles } from './filterListStore'
import { convertFilterListToWebKitRules } from './webkit-content-rules.mjs'

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
      const rules = convertFilterListToWebKitRules(await sourceFile.text())
      if (rules.length < MIN_WEBKIT_RULES_PER_LIST) {
        throw new Error('Filter list produced too few supported WebKit rules.')
      }
      await writeRuleFileAtomically(
        ruleFile,
        JSON.stringify(rules)
      )
    }
    ruleFiles.push(ruleFile)
  }

  return ruleFiles
}

async function writeRuleFileAtomically (destination: File, contents: string) {
  const temporary = new File(destination.parentDirectory, `${destination.name}.tmp`)
  if (temporary.exists) temporary.delete()
  temporary.create()

  try {
    temporary.write(contents)
    if (destination.exists) destination.delete()
    temporary.move(destination)
  } catch (error) {
    if (temporary.exists) temporary.delete()
    throw error
  }
}
