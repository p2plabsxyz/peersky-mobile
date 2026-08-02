import { NativeModules, Platform } from 'react-native'
import {
  activateFilterListState,
  discardFilterListState,
  getFilterListFiles,
  loadFilterListState,
  updateFilterLists
} from './filterListStore'
import { initializeContentBlockingRuntime } from './content-blocking-runtime.mjs'

type BrowserContentBlockingNativeModule = {
  loadFilterLists: (easyListUri: string, easyPrivacyUri: string) => Promise<boolean>
  setEnabled: (enabled: boolean) => void
}

const androidContentBlocking = NativeModules.BrowserContentBlocking as
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
  if (Platform.OS !== 'android' || !androidContentBlocking) return false

  return initializeContentBlockingRuntime({
    activateState: activateFilterListState,
    blocker: androidContentBlocking,
    discardState: discardFilterListState,
    loadActiveState: loadFilterListState,
    loadNativeState: loadNativeFilterLists,
    updateState: updateFilterLists
  })
}

async function loadNativeFilterLists (state: NonNullable<Awaited<ReturnType<typeof loadFilterListState>>>) {
  const files = getFilterListFiles(state)
  if (files.length !== 2) throw new Error('Incomplete content-blocking snapshot.')
  if (!androidContentBlocking) throw new Error('Native content blocker is unavailable.')
  await androidContentBlocking.loadFilterLists(files[0].uri, files[1].uri)
}
