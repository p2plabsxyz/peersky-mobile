import { NativeModules, Platform } from 'react-native'
import {
  activateFilterListState,
  discardFilterListState,
  getFilterListFiles,
  loadFilterListState,
  updateFilterLists
} from './filterListStore'
import {
  createForcedUpdateCoordinator,
  initializeContentBlockingRuntime
} from './content-blocking-runtime.mjs'
import { getWebKitContentRuleFiles } from './webkitContentRules'

type BrowserContentBlockingNativeModule = {
  loadFilterLists: (...args: string[]) => Promise<boolean>
  setEnabled: (enabled: boolean) => void
}

type ContentBlockingOptions = {
  enabled?: boolean
  onReady?: () => void
}

const nativeContentBlocking = NativeModules.BrowserContentBlocking as
  BrowserContentBlockingNativeModule | undefined

let desiredEnabled = true
let rulesReady = false
const readyListeners = new Set<() => void>()

const runtimeBlocker = {
  setEnabled (ready: boolean) {
    rulesReady = ready
    applyEnabledState()
    if (ready) notifyReadyListeners()
  }
}

const coordinateInitialization = createForcedUpdateCoordinator(
  ({ force }: { force: boolean }) => performInitialization(force)
)

export function initializeContentBlocking ({
  enabled = true,
  onReady
}: ContentBlockingOptions = {}): Promise<boolean> {
  setContentBlockingEnabled(enabled)
  const unsubscribe = onReady ? subscribeToReady(onReady) : null
  const initialization = coordinateInitialization({ force: false })
  return unsubscribe ? initialization.finally(unsubscribe) : initialization
}

export function updateContentBlockingLists (): Promise<boolean> {
  return coordinateInitialization({ force: true })
}

export function setContentBlockingEnabled (enabled: boolean) {
  desiredEnabled = enabled
  applyEnabledState()
}

export async function getContentBlockingStatus () {
  const state = await loadFilterListState()
  return state
    ? {
        updatedAt: state.updatedAt,
        lists: state.lists.map(({ id, byteLength }) => ({ id, byteLength }))
      }
    : null
}

async function performInitialization (forceUpdate: boolean) {
  if (!['android', 'ios'].includes(Platform.OS) || !nativeContentBlocking) return false

  return initializeContentBlockingRuntime({
    activateState: activateFilterListState,
    blocker: runtimeBlocker,
    discardState: discardFilterListState,
    forceUpdate,
    loadActiveState: loadFilterListState,
    loadNativeState: loadNativeFilterLists,
    updateState: updateFilterLists
  })
}

function applyEnabledState () {
  nativeContentBlocking?.setEnabled(rulesReady && desiredEnabled)
}

function subscribeToReady (listener: () => void) {
  if (rulesReady) {
    listener()
    return () => {}
  }

  readyListeners.add(listener)
  return () => readyListeners.delete(listener)
}

function notifyReadyListeners () {
  for (const listener of readyListeners) {
    readyListeners.delete(listener)
    try {
      listener()
    } catch (error) {
      console.error('Content-blocking readiness listener failed:', error)
    }
  }
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
