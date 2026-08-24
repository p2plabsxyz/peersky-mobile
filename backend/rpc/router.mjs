import {
  RPC_HOLESAIL_CONNECT,
  RPC_HOLESAIL_START_LIVE,
  RPC_HOLESAIL_STATUS,
  RPC_HOLESAIL_STOP,
  RPC_HYPER_CREATE_DRIVE,
  RPC_HYPER_FETCH,
  RPC_HYPER_INIT,
  RPC_HYPER_LIBRARY_LIST,
  RPC_HYPER_LIBRARY_UPLOAD,
  RPC_HYPER_STORAGE_CLEAR_CACHE,
  RPC_HYPER_STORAGE_DELETE_APP,
  RPC_HYPER_STORAGE_LIST,
  RPC_IDENTITY_GET_KEY,
  RPC_IDENTITY_RESTORE_FROM_HYPER,
  RPC_IDENTITY_CONFIRM_RESTORE,
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
import { randomBytes } from 'node:crypto'
import b4a from 'b4a'
import { rmSync, renameSync } from 'bare-fs'
import { restoreIdentityFromBackup } from '../backup/restore.mjs'

import { createDrive, publishMarkdownDocument, readHyperFile, uploadHyperFile } from '../hyper/drive.mjs'
import { listHyperdriveLocation, uploadHyperdriveFile } from '../hyper/library.mjs'
import { fetchHyper, fetchHyperBinary, resetHyperFetch } from '../hyper/fetch.mjs'
import {
  closeHyperRuntime,
  getHyperRuntime,
  getHyperStoragePath,
  withHyperRuntimeMaintenance,
  withHyperRuntimeOperation
} from '../hyper/runtime.mjs'
import { clearP2pCache, deleteP2pAppData, listP2pAppData } from '../hyper/storage.mjs'

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
import {
  inlineHyperPreviewImages,
  renderMarkdownPreview,
  renderMarkdownSlides
} from '../p2pmd/preview.mjs'
import { getP2pmdEditorPage } from '../p2pmd/server.mjs'
import { hasIeeeMarker } from '../p2pmd/templates.mjs'
import { parseJsonMessage, replyJson } from './messages.mjs'

let currentIdentityNonce = null
let pendingRestorePath = null

export async function routeRpcRequest (req) {
  try {
    if (req.command === RPC_HYPER_INIT) {
      await withHyperRuntimeOperation(() => {})
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

    if (req.command === RPC_HYPER_LIBRARY_LIST) {
      replyJson(req, await listHyperdriveLocation(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_HYPER_LIBRARY_UPLOAD) {
      replyJson(req, await uploadHyperdriveFile(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_HYPER_STORAGE_LIST) {
      replyJson(req, await listP2pAppData(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_HYPER_STORAGE_DELETE_APP) {
      replyJson(req, await deleteP2pAppData(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_HYPER_STORAGE_CLEAR_CACHE) {
      replyJson(req, await clearP2pCache())
      return
    }

    if (req.command === RPC_IDENTITY_GET_KEY) {
      const keys = await getDeviceKeys(getDefaultIdentityStoragePath())
      currentIdentityNonce = b4a.toString(randomBytes(16), 'hex')
      replyJson(req, {
        ok: true,
        encryptionPublicKey: getEncryptionPublicKeyHex(keys),
        nonce: currentIdentityNonce
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

      if (!currentIdentityNonce) {
        replyJson(req, { ok: false, error: 'Identity transfer nonce missing. Generate a new key first.' })
        return
      }

      const storagePath = getDefaultIdentityStoragePath()
      const tempStoragePath = storagePath + '.tmp'
      const keys = await getDeviceKeys(storagePath)
      const downloaded = await fetchHyperBinary({
        url: hyperUrl,
        method: 'GET',
        retries: 5,
        retryDelay: 500,
        maxRetryDelay: 4000,
        backoffFactor: 2
      })

      if (!downloaded.ok || !downloaded.bytes) {
        replyJson(req, {
          ok: false,
          error: downloaded.error || `Unable to download identity transfer (${downloaded.status || 'unknown status'})`
        })
        return
      }

      const { sas, innerZipBytes } = await decryptIdentityTransfer(downloaded.bytes, keys, currentIdentityNonce)

      try { rmSync(tempStoragePath, { recursive: true }) } catch (e) {}

      const restoreResult = await restoreIdentityFromBackup(innerZipBytes, tempStoragePath)
      pendingRestorePath = tempStoragePath

      replyJson(req, {
        ok: true,
        sas,
        restoredFiles: restoreResult.restoredFiles
      })
      return
    }

    if (req.command === RPC_IDENTITY_CONFIRM_RESTORE) {
      if (!pendingRestorePath) {
        replyJson(req, { ok: false, error: 'No pending identity restore to confirm' })
        return
      }

      const result = await withHyperRuntimeMaintenance(async () => {
        const storagePath = getDefaultIdentityStoragePath()
        const backupPath = storagePath + '.backup'

        await closeHyperRuntime()
        resetHyperFetch()

        try {
          try { rmSync(backupPath, { recursive: true }) } catch (e) {}
          try { renameSync(storagePath, backupPath) } catch (e) {}
          renameSync(pendingRestorePath, storagePath)
          pendingRestorePath = null
        } catch (err) {
          return { ok: false, error: `Atomic swap failed: ${err.message}` }
        }

        await getHyperRuntime()
        return { ok: true, requiresRestart: true }
      })
      replyJson(req, result)
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

      const rendered = body.mode === 'slides'
        ? renderMarkdownSlides(body.content)
        : {
            html: renderMarkdownPreview(body.content),
            ieee: body.latexModeEnabled === true && hasIeeeMarker(body.content)
          }

      replyJson(req, {
        ok: true,
        ...rendered,
        html: await inlineHyperPreviewImages(rendered.html, readHyperFile)
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
