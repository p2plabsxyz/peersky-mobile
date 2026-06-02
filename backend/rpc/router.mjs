import {
  RPC_HOLESAIL_CONNECT,
  RPC_HOLESAIL_START_LIVE,
  RPC_HOLESAIL_STATUS,
  RPC_HOLESAIL_STOP,
  RPC_HYPER_CREATE_DRIVE,
  RPC_HYPER_FETCH,
  RPC_HYPER_INIT
} from './commands.mjs'
import { createDrive } from '../hyper/drive.mjs'
import { fetchHyper } from '../hyper/fetch.mjs'
import { getHyperRuntime, getHyperStoragePath } from '../hyper/runtime.mjs'
import {
  connectHolesail,
  getHolesailStatus,
  startHolesailLive,
  stopHolesail
} from '../holesail/session.mjs'
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

    if (req.command === RPC_HOLESAIL_START_LIVE) {
      replyJson(req, await startHolesailLive(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_HOLESAIL_CONNECT) {
      replyJson(req, await connectHolesail(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_HOLESAIL_STATUS) {
      replyJson(req, getHolesailStatus())
      return
    }

    if (req.command === RPC_HOLESAIL_STOP) {
      replyJson(req, await stopHolesail())
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
