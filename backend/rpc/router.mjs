import {
  RPC_HOLESAIL_CONNECT,
  RPC_HOLESAIL_START_LIVE,
  RPC_HOLESAIL_STATUS,
  RPC_HOLESAIL_STOP,
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
  RPC_IDENTITY_REMOVE,
  RPC_IDENTITY_SEND,
  RPC_IDENTITY_SEND_STOP,
  RPC_IDENTITY_DISCARD_RESTORE,
  RPC_BACKUP_CREATE,
  RPC_BACKUP_ESTIMATE,
  RPC_BACKUP_INSPECT,
  RPC_BACKUP_RESTORE_FILE,
  RPC_P2PMD_ROOM_CREATE,
  RPC_P2PMD_ROOM_DISCONNECT,
  RPC_P2PMD_EDITOR_PAGE,
  RPC_P2PMD_IMAGE_UPLOAD,
  RPC_P2PMD_PREVIEW,
  RPC_P2PMD_ROOM_JOIN,
  RPC_P2PMD_ROOM_PUBLISH,
  RPC_P2PMD_ROOM_STATUS,
  RPC_P2PMD_TAKE_NOTES,
  RPC_PEERCHAT_BLOCK,
  RPC_PEERCHAT_INIT,
  RPC_PEERCHAT_PROFILE_SET,
  RPC_PEERCHAT_ROOM_CREATE,
  RPC_PEERCHAT_ROOM_JOIN,
  RPC_PEERCHAT_ROOMS,
  RPC_PEERCHAT_SNAPSHOT,
  RPC_PEERCHAT_UNBLOCK,
  RPC_PEERCHAT_DELETE_PROFILE,
  RPC_PEERCHAT_PRESENCE,
  RPC_PEERCHAT_ROOM_REMOVE_MEMBER,
  RPC_PEERCHAT_ROOM_RESTORE_MEMBER,
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
  RPC_PEERCHAT_ATTACHMENT_OPEN,
  RPC_PEERTUNES_START
} from './commands.mjs'
import {
  getDefaultIdentityStoragePath,
  getDeviceKeys,
  getEncryptionPublicKeyHex
} from '../backup/device-keys.mjs'
import {
  clearOrphanedTransfer,
  confirmRestore,
  createBackupFile,
  discardPendingRestore,
  estimateBackup,
  inspectBackup,
  receiveTransfer,
  removeIdentity,
  restoreBackupFile,
  sendTransfer,
  stopOutgoingTransfer
} from '../backup/link-device.mjs'

import { publishMarkdownDocument, readHyperFile, uploadHyperFile } from '../hyper/drive.mjs'
import { listHyperdriveLocation, uploadHyperdriveFile } from '../hyper/library.mjs'
import { fetchHyper } from '../hyper/fetch.mjs'
import {
  keepHyperOffline,
  listHyperOffline,
  pauseHyperOffline,
  removeHyperOffline,
  resumeHyperOffline,
  resumeWantedHyperOffline
} from '../hyper/offline-manager.mjs'
import {
  ensureLANDiscovery,
  getHyperStoragePath,
  getLANDiscoveryStatus,
  refreshHyperNetworking,
  withHyperRuntimeOperation
} from '../hyper/runtime.mjs'
import { getOrCreatePairingNonceRecord } from '../backup/pairing-nonce.mjs'
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
import { takeP2pmdNotes } from '../p2pmd/notes-transfer.mjs'
import { inlineHyperPreviewImages, renderP2pmdPreview } from '../p2pmd/preview.mjs'
import { getP2pmdEditorPage } from '../p2pmd/server.mjs'
import { startPeerTunesServer } from '../peertunes/server.mjs'
import { parseJsonMessage, replyJson } from './messages.mjs'
import { deletePeerChatProfile, getPeerChatService, setPeerChatIdle } from '../peerchat/runtime.mjs'
import { openPeerChatAttachment, uploadPeerChatAttachment } from '../peerchat/attachments.mjs'

export async function routeRpcRequest (req) {
  try {
    if (req.command === RPC_HYPER_INIT) {
      const options = parseJsonMessage(req.data)
      await withHyperRuntimeOperation(() => {})
      clearOrphanedTransfer()
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
      const identityStoragePath = getDefaultIdentityStoragePath()
      const keys = await getDeviceKeys(identityStoragePath)
      const pairing = getOrCreatePairingNonceRecord(identityStoragePath)
      replyJson(req, {
        ok: true,
        encryptionPublicKey: getEncryptionPublicKeyHex(keys),
        nonce: pairing.nonce,
        expiresAt: pairing.expiresAt
      })
      return
    }

    if (req.command === RPC_IDENTITY_RESTORE_FROM_HYPER) {
      replyJson(req, await receiveTransfer(parseJsonMessage(req.data)))
      return
    }

    // Moving an identity to a new phone means the old phone has to stop being
    // that profile. Two phones on one identity write the same chat feed and
    // fork it, so leaving the old copy in place is the thing that breaks. The
    // desktop releases its side; this releases the phone's.
    if (req.command === RPC_IDENTITY_REMOVE) {
      replyJson(req, await removeIdentity())
      return
    }

    if (req.command === RPC_IDENTITY_CONFIRM_RESTORE) {
      replyJson(req, await confirmRestore(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_IDENTITY_DISCARD_RESTORE) {
      replyJson(req, discardPendingRestore(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_IDENTITY_SEND) {
      replyJson(req, await sendTransfer(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_IDENTITY_SEND_STOP) {
      replyJson(req, await stopOutgoingTransfer())
      return
    }

    if (req.command === RPC_BACKUP_ESTIMATE) {
      replyJson(req, estimateBackup())
      return
    }

    if (req.command === RPC_BACKUP_CREATE) {
      replyJson(req, await createBackupFile(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_BACKUP_INSPECT) {
      replyJson(req, inspectBackup(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_BACKUP_RESTORE_FILE) {
      replyJson(req, await restoreBackupFile(parseJsonMessage(req.data)))
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

    if (req.command === RPC_P2PMD_TAKE_NOTES) {
      replyJson(req, takeP2pmdNotes({
        documentsPath: getDefaultIdentityStoragePath(),
        hyperStoragePath: getHyperStoragePath()
      }))
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
      const rendered = renderP2pmdPreview(parseJsonMessage(req.data))
      replyJson(req, rendered.ok
        ? { ...rendered, html: await inlineHyperPreviewImages(rendered.html, readHyperFile) }
        : rendered)
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
        blockedPeers: peerChat.listBlockedPeers(),
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
      const room = await peerChat.createRoom(parseJsonMessage(req.data))
      // The list in its own order, so the new room sits where the next
      // refresh will put it rather than jumping there under a finger.
      replyJson(req, { ok: true, room, rooms: peerChat.listRooms() })
      return
    }

    if (req.command === RPC_PEERCHAT_ROOM_JOIN) {
      const peerChat = await getPeerChatService()
      const room = await peerChat.joinRoom(parseJsonMessage(req.data))
      replyJson(req, { ok: true, room, rooms: peerChat.listRooms() })
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
        blockedPeers: peerChat.listBlockedPeers(),
        version: peerChat.version
      })
      return
    }

    if (req.command === RPC_PEERCHAT_BLOCK) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        ...await peerChat.blockPeer(parseJsonMessage(req.data))
      })
      return
    }

    if (req.command === RPC_PEERCHAT_UNBLOCK) {
      const peerChat = await getPeerChatService()
      replyJson(req, {
        ok: true,
        ...await peerChat.unblockPeer(parseJsonMessage(req.data))
      })
      return
    }

    if (req.command === RPC_PEERCHAT_DELETE_PROFILE) {
      replyJson(req, await deletePeerChatProfile())
      return
    }

    // Never opens PeerChat: someone who does not use it has nobody to tell.
    if (req.command === RPC_PEERCHAT_PRESENCE) {
      setPeerChatIdle(parseJsonMessage(req.data).idle === true)
      replyJson(req, { ok: true })
      return
    }

    if (req.command === RPC_PEERCHAT_ROOM_REMOVE_MEMBER) {
      const peerChat = await getPeerChatService()
      replyJson(req, await peerChat.removeRoomMember(parseJsonMessage(req.data)))
      return
    }

    if (req.command === RPC_PEERCHAT_ROOM_RESTORE_MEMBER) {
      const peerChat = await getPeerChatService()
      replyJson(req, await peerChat.restoreRoomMember(parseJsonMessage(req.data)))
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
      // The service says whether this room's files get keys of their own.
      replyJson(req, await uploadPeerChatAttachment({ ...body, ownKey: peerChat.filesHaveOwnKeys(body.roomKey) }))
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

    if (req.command === RPC_PEERTUNES_START) {
      replyJson(req, await startPeerTunesServer())
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
