import { parseProgressEvent } from './link-device-state.mjs'

export type LinkDeviceProgress = { phase: string, done: number, total: number | null }

// The backend pushes progress while it packs, sends or unpacks. The worklet
// connection lives in the browser screen and Link Device lives in settings,
// so the two meet here.
const listeners = new Set<(progress: LinkDeviceProgress) => void>()

export function emitLinkDeviceProgress (data: unknown) {
  const progress = parseProgressEvent(data) as LinkDeviceProgress | null
  if (!progress) return
  for (const listener of listeners) listener(progress)
}

export function subscribeLinkDeviceProgress (listener: (progress: LinkDeviceProgress) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
