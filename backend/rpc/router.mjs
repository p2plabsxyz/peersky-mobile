import {
  RPC_HYPER_CREATE_DRIVE,
  RPC_HYPER_FETCH,
  RPC_HYPER_INIT
} from './commands.mjs'
import { createDrive } from '../hyper/drive.mjs'
import { fetchHyper } from '../hyper/fetch.mjs'
import { getHyperRuntime, getHyperStoragePath } from '../hyper/runtime.mjs'
import { parseJsonMessage, replyJson } from './messages.mjs'

export async function routeRpcRequest (req) {
  try {
    if (req.command === RPC_HYPER_INIT) {
      await getHyperRuntime()
      replyJson(req, { ok: true, storagePath: getHyperStoragePath() })
      return
    }

    if (req.command === RPC_HYPER_FETCH) {
      replyJson(req, await fetchHyper(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_HYPER_CREATE_DRIVE) {
      replyJson(req, await createDrive(parseJsonMessage(req.data)))
      return
    }

    replyJson(req, { ok: false, error: `Unsupported command: ${req.command}` })
  } catch (error) {
    replyJson(req, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
