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
  RPC_HYPER_LAN_STATUS,
  RPC_HYPER_OFFLINE_KEEP,
  RPC_HYPER_OFFLINE_LIST,
  RPC_HYPER_OFFLINE_PAUSE,
  RPC_HYPER_OFFLINE_REMOVE,
  RPC_HYPER_OFFLINE_RESUME,
  RPC_HYPER_OFFLINE_RESUME_ALL,
  RPC_HYPER_REFRESH,
  RPC_HYPER_STORAGE_CLEAR_CACHE,
  RPC_HYPER_STORAGE_CLEAR_ALL,
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
  RPC_P2PMD_ROOM_STATUS,
  RPC_PEERCHAT_INIT,
  RPC_PEERCHAT_PROFILE_SET,
  RPC_PEERCHAT_ROOM_CREATE,
  RPC_PEERCHAT_ROOM_JOIN,
  RPC_PEERCHAT_ROOMS,
  RPC_PEERCHAT_SNAPSHOT,
  RPC_PEERCHAT_SEND,
  RPC_PEERCHAT_ROOM_LEAVE,
  RPC_PEERCHAT_REACT,
  RPC_PEERCHAT_SET_ACTIVE,
  RPC_PEERCHAT_ROOM_PIN,
  RPC_PEERCHAT_ROOM_MUTE,
  RPC_PEERCHAT_ROOM_UPDATE,
  RPC_PEERCHAT_DM_CREATE,
  RPC_PEERCHAT_DM_ACCEPT,
  RPC_PEERCHAT_DM_REJECT,
  RPC_PEERCHAT_ONBOARD,
  RPC_PEERCHAT_ATTACHMENT_UPLOAD,
  RPC_PEERCHAT_ATTACHMENT_OPEN
} from './commands.mjs'
import {
  getDefaultIdentityStoragePath,
  getDeviceKeys,
  getEncryptionPublicKeyHex
} from '../backup/device-keys.mjs'
import { decryptIdentityTransfer } from '../backup/identity-transfer.mjs'
import { adoptTransferredPrivateDrive } from '../backup/private-drive-import.mjs'
import { randomBytes } from 'node:crypto'
import b4a from 'b4a'
import { rmSync, renameSync, existsSync } from 'bare-fs'
import { commitIdentityRestore, restoreIdentityFromBackup } from '../backup/restore.mjs'

import { createDrive, publishMarkdownDocument, readHyperFile, uploadHyperFile } from '../hyper/drive.mjs'
import { listHyperdriveLocation, uploadHyperdriveFile } from '../hyper/library.mjs'
import { fetchHyper, fetchHyperBinary, resetHyperFetch } from '../hyper/fetch.mjs'
import {
  closeHyperOfflineDownloads,
  keepHyperOffline,
  listHyperOffline,
  pauseHyperOffline,
  removeHyperOffline,
  resumeHyperOffline,
  resumeWantedHyperOffline
} from '../hyper/offline-manager.mjs'
import {
  closeHyperRuntime,
  ensureLANDiscovery,
  getHyperRuntime,
  getHyperStoragePath,
  getLANDiscoveryStatus,
  getSyncedPrivateHyperStoragePath,
  refreshHyperNetworking,
  withHyperRuntimeMaintenance,
  withHyperRuntimeOperation
} from '../hyper/runtime.mjs'
import { resetPrivateDriveKeyCache } from '../hyper/private-keys.mjs'
import { clearAllP2pData, clearP2pCache, deleteP2pAppData, listP2pAppData } from '../hyper/storage.mjs'

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
import { closePeerChatService, getPeerChatService } from '../peerchat/runtime.mjs'
import { openPeerChatAttachment, uploadPeerChatAttachment } from '../peerchat/attachments.mjs'

let currentIdentityNonce = null
let pendingRestorePath = null

export async function routeRpcRequest (req) {
  try {
    if (req.command === RPC_HYPER_INIT) {
      const options = parseJsonMessage(req.data)
      await withHyperRuntimeOperation(() => {})
      replyJson(req, {
        ok: true,
        storagePath: getHyperStoragePath(),
        lan: getLANDiscoveryStatus()
      })
      if (options.allowNetwork !== false) {
        resumeWantedHyperOffline().catch((error) => {
          console.error('[hyper] Failed to resume offline downloads:', error)
        })
      }
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

    if (req.command === RPC_HYPER_LAN_STATUS) {
      await ensureLANDiscovery()
      replyJson(req, {
        ok: true,
        lan: getLANDiscoveryStatus()
      })
      return
    }

    if (req.command === RPC_HYPER_REFRESH) {
      replyJson(req, { ok: true, ...(await refreshHyperNetworking()) })
      return
    }

    if (req.command === RPC_HYPER_OFFLINE_LIST) {
      replyJson(req, await listHyperOffline(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_HYPER_OFFLINE_KEEP) {
      replyJson(req, await keepHyperOffline(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_HYPER_OFFLINE_PAUSE) {
      replyJson(req, await pauseHyperOffline(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_HYPER_OFFLINE_RESUME) {
      replyJson(req, await resumeHyperOffline(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_HYPER_OFFLINE_RESUME_ALL) {
      replyJson(req, await resumeWantedHyperOffline(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_HYPER_OFFLINE_REMOVE) {
      replyJson(req, await removeHyperOffline(parseJsonMessage(req.data)))
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

    if (req.command === RPC_HYPER_STORAGE_CLEAR_ALL) {
      replyJson(req, await clearAllP2pData())
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
        const syncedPrivatePath = getSyncedPrivateHyperStoragePath()
        const syncedPrivateStash = storagePath + '.synced-stash'
        const hadSyncedPrivate = existsSync(syncedPrivatePath)

        await closePeerChatService()
        await closeHyperRuntime()
        resetHyperFetch()

        if (hadSyncedPrivate) {
          try { rmSync(syncedPrivateStash, { recursive: true }) } catch (e) {}
          try { renameSync(syncedPrivatePath, syncedPrivateStash) } catch (e) {}
        }

        try {
          commitIdentityRestore({
            storagePath,
            pendingPath: pendingRestorePath,
            backupPath
          })
          pendingRestorePath = null
        } catch (err) {
          if (hadSyncedPrivate && !existsSync(syncedPrivatePath) && existsSync(syncedPrivateStash)) {
            try { renameSync(syncedPrivateStash, syncedPrivatePath) } catch (e) {}
          }
          return { ok: false, error: `Atomic swap failed: ${err.message}` }
        }

        if (hadSyncedPrivate && existsSync(syncedPrivateStash)) {
          try { renameSync(syncedPrivateStash, syncedPrivatePath) } catch (e) {}
        }

        const privateDriveAdoption = adoptTransferredPrivateDrive(
          storagePath,
          getSyncedPrivateHyperStoragePath()
        )
        resetPrivateDriveKeyCache()

        await getHyperRuntime()
        return {
          ok: true,
          requiresRestart: true,
          privateDriveRestored: privateDriveAdoption.adopted,
          privateDriveId: privateDriveAdoption.driveId || undefined,
          adoptedDriveIds: privateDriveAdoption.driveIds
        }
      }, closeHyperOfflineDownloads)
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

    if (req.command === RPC_PEERCHAT_INIT) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        profile: peerChat.getProfile(),
        rooms: peerChat.listRooms(),
        unreadTotal: peerChat.getUnreadTotal(),
        pendingDirectMessages: peerChat.listPendingDirectMessages(),
        version: peerChat.version
      })
      return
    }

    if (req.command === RPC_PEERCHAT_PROFILE_SET) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        profile: peerChat.setProfile(parseJsonMessage(req.data))
      })
      return
    }

    if (req.command === RPC_PEERCHAT_ONBOARD) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        ...await peerChat.completeOnboarding(parseJsonMessage(req.data))
      })
      return
    }

    if (req.command === RPC_PEERCHAT_ROOM_CREATE) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        room: await peerChat.createRoom(parseJsonMessage(req.data))
      })
      return
    }

    if (req.command === RPC_PEERCHAT_ROOM_JOIN) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        room: await peerChat.joinRoom(parseJsonMessage(req.data))
      })
      return
    }

    if (req.command === RPC_PEERCHAT_ROOMS) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        profile: peerChat.getProfile(),
        rooms: peerChat.listRooms(),
        unreadTotal: peerChat.getUnreadTotal(),
        pendingDirectMessages: peerChat.listPendingDirectMessages(),
        version: peerChat.version
      })
      return
    }

    if (req.command === RPC_PEERCHAT_SNAPSHOT) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        ...await peerChat.getSnapshot(parseJsonMessage(req.data))
      })
      return
    }

    if (req.command === RPC_PEERCHAT_SEND) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        sent: await peerChat.sendMessage(parseJsonMessage(req.data)),
        version: peerChat.version
      })
      return
    }

    if (req.command === RPC_PEERCHAT_ATTACHMENT_UPLOAD) {
      const body = parseJsonMessage(req.data)
      const peerChat = await getPeerChatService()
      if (!peerChat.hasRoom(body.roomKey)) {
        replyJson(req, { ok: false, error: 'PeerChat room not found.' })
        return
      }
      replyJson(req, await uploadPeerChatAttachment(body))
      return
    }

    if (req.command === RPC_PEERCHAT_ATTACHMENT_OPEN) {
      const body = parseJsonMessage(req.data)
      const peerChat = await getPeerChatService()
      if (!peerChat.hasRoom(body.roomKey)) {
        replyJson(req, { ok: false, error: 'PeerChat room not found.' })
        return
      }
      replyJson(req, await openPeerChatAttachment(body))
      return
    }

    if (req.command === RPC_PEERCHAT_ROOM_LEAVE) {
      const peerChat = await getPeerChatService()
      replyJson(req, await peerChat.leaveRoom(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_PEERCHAT_REACT) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        reaction: await peerChat.reactToMessage(parseJsonMessage(req.data)),
        version: peerChat.version
      })
      return
    }

    if (req.command === RPC_PEERCHAT_SET_ACTIVE) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        ...peerChat.setActiveRoom(parseJsonMessage(req.data))
      })
      return
    }

    if (req.command === RPC_PEERCHAT_ROOM_PIN) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        ...peerChat.setRoomPinned(parseJsonMessage(req.data))
      })
      return
    }

    if (req.command === RPC_PEERCHAT_ROOM_MUTE) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        ...peerChat.setRoomMuted(parseJsonMessage(req.data))
      })
      return
    }

    if (req.command === RPC_PEERCHAT_ROOM_UPDATE) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        ...peerChat.updateRoom(parseJsonMessage(req.data))
      })
      return
    }

    if (req.command === RPC_PEERCHAT_DM_CREATE) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        ...await peerChat.createDirectMessage(parseJsonMessage(req.data))
      })
      return
    }

    if (req.command === RPC_PEERCHAT_DM_ACCEPT) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        ...await peerChat.acceptDirectMessage(parseJsonMessage(req.data)),
        pendingDirectMessages: peerChat.listPendingDirectMessages()
      })
      return
    }

    if (req.command === RPC_PEERCHAT_DM_REJECT) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        ...peerChat.rejectDirectMessage(parseJsonMessage(req.data))
      })
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
