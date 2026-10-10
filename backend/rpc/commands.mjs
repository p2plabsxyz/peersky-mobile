export const RPC_HYPER_INIT = 1
export const RPC_HYPER_FETCH = 2
export const RPC_HYPER_STORAGE_LIST = 4
export const RPC_HYPER_STORAGE_DELETE_APP = 5
export const RPC_HYPER_STORAGE_CLEAR_CACHE = 6
export const RPC_HYPER_LIBRARY_LIST = 7
export const RPC_HYPER_LIBRARY_UPLOAD = 8
export const RPC_HYPER_LAN_STATUS = 9
export const RPC_HYPER_STORAGE_CLEAR_ALL = 14
export const RPC_HYPER_REFRESH = 15
// This person's other devices, met under the private drive key: the devices
// with what is in their private drives, whether the phone is on a cellular
// connection, and taking a device off the list.
export const RPC_DEVICE_SYNC_STATUS = 16
export const RPC_DEVICE_SYNC_NETWORK = 17
export const RPC_DEVICE_SYNC_FORGET = 18

export const RPC_HYPER_OFFLINE_LIST = 60
export const RPC_HYPER_OFFLINE_KEEP = 61
export const RPC_HYPER_OFFLINE_PAUSE = 62
export const RPC_HYPER_OFFLINE_RESUME = 63
export const RPC_HYPER_OFFLINE_RESUME_ALL = 64
export const RPC_HYPER_OFFLINE_REMOVE = 65

export const RPC_HOLESAIL_START_LIVE = 10
export const RPC_HOLESAIL_CONNECT = 11
export const RPC_HOLESAIL_STATUS = 12
export const RPC_HOLESAIL_STOP = 13

export const RPC_P2PMD_ROOM_CREATE = 20
export const RPC_P2PMD_ROOM_STATUS = 21
export const RPC_P2PMD_ROOM_DISCONNECT = 22
export const RPC_P2PMD_ROOM_JOIN = 23
export const RPC_P2PMD_ROOM_PUBLISH = 24
export const RPC_P2PMD_EDITOR_PAGE = 25
export const RPC_P2PMD_PREVIEW = 26
export const RPC_P2PMD_IMAGE_UPLOAD = 27
// Notes another of the person's devices left here in a Link Device transfer.
export const RPC_P2PMD_TAKE_NOTES = 28

export const RPC_IDENTITY_GET_KEY = 30
export const RPC_IDENTITY_RESTORE_FROM_HYPER = 31
export const RPC_IDENTITY_CONFIRM_RESTORE = 32
// Backups and phone-to-phone transfers, all under Link Device.
export const RPC_BACKUP_ESTIMATE = 33
export const RPC_BACKUP_CREATE = 34
export const RPC_BACKUP_INSPECT = 35
export const RPC_BACKUP_RESTORE_FILE = 36
export const RPC_IDENTITY_SEND = 37
export const RPC_IDENTITY_SEND_STOP = 38
export const RPC_IDENTITY_DISCARD_RESTORE = 39

export const RPC_PEERCHAT_INIT = 40
export const RPC_PEERCHAT_PROFILE_SET = 41
export const RPC_PEERCHAT_ROOM_CREATE = 42
export const RPC_PEERCHAT_ROOM_JOIN = 43
export const RPC_PEERCHAT_ROOMS = 44
export const RPC_PEERCHAT_SNAPSHOT = 45
export const RPC_PEERCHAT_SEND = 46
export const RPC_PEERCHAT_ROOM_LEAVE = 47
export const RPC_PEERCHAT_REACT = 48
export const RPC_PEERCHAT_SET_ACTIVE = 49
export const RPC_PEERCHAT_ROOM_PIN = 50
export const RPC_PEERCHAT_ROOM_MUTE = 51
export const RPC_PEERCHAT_ROOM_UPDATE = 52
export const RPC_PEERCHAT_DM_CREATE = 53
export const RPC_PEERCHAT_DM_ACCEPT = 54
export const RPC_PEERCHAT_DM_REJECT = 55
export const RPC_PEERCHAT_ONBOARD = 56
export const RPC_PEERCHAT_ATTACHMENT_UPLOAD = 57
export const RPC_PEERCHAT_ATTACHMENT_OPEN = 58
// 59-65 are the hyper offline range, so the PeerChat additions continue at 66.
export const RPC_PEERCHAT_BLOCK = 66
export const RPC_PEERCHAT_UNBLOCK = 67
// Removing somebody from a room, which only the person who made it can do.
// Blocking above is a private decision; this one is the room's.
export const RPC_PEERCHAT_ROOM_REMOVE_MEMBER = 71
export const RPC_PEERCHAT_ROOM_RESTORE_MEMBER = 72
// Everything PeerChat keeps on this device, gone, as App Review asks of any
// app where people make a profile.
export const RPC_PEERCHAT_DELETE_PROFILE = 73
// { idle } as the app goes to the background and comes back, so people in a
// room see this phone as away.
export const RPC_PEERCHAT_PRESENCE = 74
// { message } from the browser's Send to your devices, into your chat with
// yourself.
export const RPC_PEERCHAT_SEND_TO_DEVICES = 75

export const RPC_IDENTITY_REMOVE = 68

export const RPC_PEERTUNES_START = 70

// Backend to app pushes. Separate range so they never collide with the
// app-initiated commands above.
export const RPC_APP_PEERCHAT_CHANGED = 100
// { phase, done, total } while a backup or transfer is packed, sent or unpacked.
export const RPC_APP_BACKUP_PROGRESS = 101
// A linked device came or went, or one of its private drives changed.
export const RPC_APP_DEVICE_SYNC_CHANGED = 102
