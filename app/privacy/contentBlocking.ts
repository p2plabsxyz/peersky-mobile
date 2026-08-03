import { NativeModules, Platform } from 'react-native'
import {
  activateFilterListState,
  discardFilterListState,
  getFilterListFiles,
  loadFilterListState,
  updateFilterLists
} from './filterListStore'
import { initializeContentBlockingRuntime } from './content-blocking-runtime.mjs'
import { getWebKitContentRuleFiles } from './webkitContentRules'

type BrowserContentBlockingNativeModule = {
  loadFilterLists: (...args: string[]) => Promise<boolean>
  setEnabled: (enabled: boolean) => void
}

const nativeContentBlocking = NativeModules.BrowserContentBlocking as
  BrowserContentBlockingNativeModule | undefined

let initializationInFlight: Promise<boolean> | null = null

export function initializeContentBlocking (): Promise<boolean> {
  if (initializationInFlight) return initializationInFlight

  initializationInFlight = performInitialization()
    .finally(() => {
      initializationInFlight = null
    })

  return initializationInFlight
}

async function performInitialization () {
  if (!['android', 'ios'].includes(Platform.OS) || !nativeContentBlocking) return false

  return initializeContentBlockingRuntime({
    activateState: activateFilterListState,
    blocker: nativeContentBlocking,
    discardState: discardFilterListState,
    loadActiveState: loadFilterListState,
    loadNativeState: loadNativeFilterLists,
    updateState: updateFilterLists
  })
}

async function loadNativeFilterLists (state: NonNullable<Awaited<ReturnType<typeof loadFilterListState>>>) {
  const files = getFilterListFiles(state)
  if (files.length !== 2) throw new Error('Incomplete content-blocking snapshot.')
  if (!nativeContentBlocking) throw new Error('Native content blocker is unavailable.')

  if (Platform.OS === 'ios') {
    const ruleFiles = await getWebKitContentRuleFiles(state)
    await nativeContentBlocking.loadFilterLists(
      ...ruleFiles.map((file) => file.uri),
      state.snapshotName
    )
    return
  }

  await nativeContentBlocking.loadFilterLists(files[0].uri, files[1].uri)
}
