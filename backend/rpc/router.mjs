import {
  RPC_HOLESAIL_CONNECT,
  RPC_HOLESAIL_START_LIVE,
  RPC_HOLESAIL_STATUS,
  RPC_HOLESAIL_STOP,
  RPC_HYPER_CREATE_DRIVE,
  RPC_HYPER_FETCH,
  RPC_HYPER_INIT,
  RPC_IDENTITY_GET_KEY,
  RPC_IDENTITY_RESTORE_FROM_HYPER,
  RPC_P2PMD_ROOM_CREATE,
  RPC_P2PMD_ROOM_DISCONNECT,
  RPC_P2PMD_EDITOR_PAGE,
  RPC_P2PMD_IMAGE_UPLOAD,
  RPC_P2PMD_PREVIEW,
  RPC_P2PMD_ROOM_JOIN,
  RPC_P2PMD_ROOM_PUBLISH,
  RPC_P2PMD_ROOM_STATUS
} from './commands.mjs'
import {
  getDefaultIdentityStoragePath,
  getDeviceKeys,
  getEncryptionPublicKeyHex
} from '../backup/device-keys.mjs'
import { decryptIdentityTransfer } from '../backup/identity-transfer.mjs'
import { restoreIdentityFromBackup } from '../backup/restore.mjs'

import { createDrive, publishMarkdownDocument, readHyperFile, uploadHyperFile } from '../hyper/drive.mjs'
import { fetchHyper, fetchHyperBinary, resetHyperFetch } from '../hyper/fetch.mjs'
import { closeHyperRuntime, getHyperRuntime, getHyperStoragePath } from '../hyper/runtime.mjs'
import {
  connectHolesail,
  getHolesailStatus,
  startHolesailLive,
  stopHolesail
} from '../holesail/session.mjs'
import {
  createP2pmdRoom,
  disconnectP2pmdRoom,
  getP2pmdRoomStatus,
  joinP2pmdRoom
} from '../p2pmd/room.mjs'
import { getMaxDocumentLength } from '../p2pmd/document.mjs'
import { inlineHyperPreviewImages, renderMarkdownPreview } from '../p2pmd/preview.mjs'
import { getP2pmdEditorPage } from '../p2pmd/server.mjs'
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

    if (req.command === RPC_IDENTITY_GET_KEY) {
      const keys = await getDeviceKeys(getDefaultIdentityStoragePath())
      replyJson(req, {
        ok: true,
        encryptionPublicKey: getEncryptionPublicKeyHex(keys)
      })
      return
    }

    if (req.command === RPC_IDENTITY_RESTORE_FROM_HYPER) {
      const body = parseJsonMessage(req.data)
      const hyperUrl = typeof body.hyperUrl === 'string' ? body.hyperUrl.trim() : ''
      if (!hyperUrl) {
        replyJson(req, { ok: false, error: 'Missing hyper:// identity transfer URL' })
        return
      }

      const storagePath = getDefaultIdentityStoragePath()
      const keys = await getDeviceKeys(storagePath)
      const downloaded = await fetchHyperBinary({ url: hyperUrl, method: 'GET' })

      if (!downloaded.ok || !downloaded.bytes) {
        replyJson(req, {
          ok: false,
          error: downloaded.error || `Unable to download identity transfer (${downloaded.status || 'unknown status'})`
        })
        return
      }

      const innerZipBytes = await decryptIdentityTransfer(downloaded.bytes, keys)

      // Close Hyper runtime before overwriting storage to prevent DB corruption
      await closeHyperRuntime()
      resetHyperFetch()

      const restoreResult = await restoreIdentityFromBackup(innerZipBytes, storagePath)

      // Reinitialize Hyper with the restored identity
      await getHyperRuntime()

      replyJson(req, {
        ok: true,
        restoredFiles: restoreResult.restoredFiles,
        requiresRestart: true
      })
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

    if (req.command === RPC_P2PMD_ROOM_CREATE) {
      replyJson(req, await createP2pmdRoom(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_P2PMD_ROOM_STATUS) {
      replyJson(req, getP2pmdRoomStatus())
      return
    }

    if (req.command === RPC_P2PMD_ROOM_JOIN) {
      replyJson(req, await joinP2pmdRoom(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_P2PMD_EDITOR_PAGE) {
      replyJson(req, {
        ok: true,
        html: getP2pmdEditorPage()
      })
      return
    }

    if (req.command === RPC_P2PMD_PREVIEW) {
      const body = parseJsonMessage(req.data)
      if (typeof body.content !== 'string') {
        replyJson(req, {
          ok: false,
          error: 'Invalid Markdown content. Expected a string.'
        })
        return
      }

      if (body.content.length > getMaxDocumentLength()) {
        replyJson(req, {
          ok: false,
          error: 'Markdown is too large. Maximum size is 10 MB.'
        })
        return
      }

      replyJson(req, {
        ok: true,
        html: await inlineHyperPreviewImages(renderMarkdownPreview(body.content), readHyperFile)
      })
      return
    }

    if (req.command === RPC_P2PMD_IMAGE_UPLOAD) {
      replyJson(req, await uploadHyperFile(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_P2PMD_ROOM_PUBLISH) {
      replyJson(req, await publishMarkdownDocument(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_P2PMD_ROOM_DISCONNECT) {
      replyJson(req, await disconnectP2pmdRoom())
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
