# PeerChat on mobile

PeerChat provides encrypted peer-to-peer group rooms and direct messages at
`peersky://p2p/peerchat/`. The mobile implementation uses the same room-key,
topic, message-encryption, and transport formats as PeerSky Desktop.

## Capabilities

- Create a group or join one with its 64-character room key.
- Exchange encrypted messages with mobile and desktop peers.
- Restore recent rooms and message history after an app restart.
- Reply to messages, add reactions, mention peers, and search chats or messages.
- Share public Hyperdrive attachments and bounded HTTP or HTTPS link previews.
- Start direct-message conversations through an explicit accept or decline flow.
- Set a profile and host-owned room name, description, link, image, and moderation.
- Pin or mute rooms and track unread messages and mentions.
- Show online room members and reconnect after temporary network loss.
- Notify for unread messages while the PeerSky process can receive events.

## Architecture

The React Native screen sends bounded commands over the existing `bare-rpc`
bridge. A single `PeerChatService` in the Bare worklet uses PeerSky's shared
`hyper-sdk` runtime for public and local-network discovery. It does not open a
second SDK, Corestore, swarm, local HTTP server, or unrestricted proxy.

Each room derives a discovery topic and an AES-256-GCM message key from separate
contexts. The room key itself is never used as the public discovery topic. Every
received frame, profile field, URL, attachment description, timestamp, and
persisted record is normalized and bounded before use.

Important files:

- `app/peerchat/PeerChatScreen.tsx`: mobile room list, chat UI, and actions.
- `backend/peerchat/service.mjs`: rooms, feeds, synchronization, and lifecycle.
- `backend/peerchat/protocol.mjs`: validation, key derivation, and encryption.
- `backend/peerchat/transport.mjs`: bounded newline-delimited peer frames.
- `backend/peerchat/link-preview.mjs`: bounded public-network preview fetching.
- `backend/peerchat/moderation.mjs`: local content and spam enforcement.
- `backend/peerchat/runtime.mjs`: shared-runtime service initialization and cleanup.

## Room-key security

The room key is both an invitation and the secret needed to decrypt room
messages. Anyone who receives it can join that room and read synchronized
history, so share it only with intended participants. PeerChat currently has no
server-side account, invitation revocation, or mechanism to remove knowledge of
a key from a device that already received it. Create a new room and distribute a
new key if an old key is exposed.

Messages are encrypted before they are appended to a room feed or sent to a
peer. Sender names, timestamps, reactions, and other routing metadata are not
promised to be anonymous. Peer discovery can also reveal network metadata to
the underlying P2P stack.

Room keys, profile information, recent-room metadata, and local preferences are
stored in the app-private PeerSky data directory. The current mobile build does
not protect room keys with Android Keystore or iOS Keychain hardware-backed
encryption. Device access, app-data backups, and rooted or jailbroken devices
must therefore be considered part of the local threat model.

## Attachments and link previews

PeerChat attachments are uploaded to a public Hyperdrive and their `hyper://`
address is sent inside the encrypted chat message. The message is encrypted, but
the attachment bytes are not additionally encrypted by PeerChat. Anyone who
obtains the attachment URL can request the file while a peer is available.

Link previews are optional and run only when the local user sends a public HTTP
or HTTPS URL. Preview fetching rejects credentials, loopback, link-local, and
private-network targets; validates every redirect; limits redirects and response
bytes; and stops after a fixed time budget. Remote peers cannot use a received
message to make this device fetch an arbitrary preview URL.

## Notifications

Message notifications require native notification permission and can be
disabled globally or suppressed by muting a room. Sound can be disabled without
disabling the notification itself. Notifications are generated only while the
PeerSky app process is alive and receiving PeerChat updates. This implementation
does not include a background push service and does not promise notifications
after the operating system kills the app.

## Storage and deletion

PeerChat metadata and writable room feeds live under the shared Hyper storage
directory. PeerChat deliberately does not expose raw room feeds or room keys as
ordinary named Hyperdrives in Settings.

Settings -> P2P Data provides two relevant operations:

- **Clear downloaded P2P cache** closes PeerChat before storage maintenance,
  removes refetchable Hyper cores, retains locally owned room feeds and recent
  room metadata, and then restarts the shared runtime.
- **Clear all P2P data** closes PeerChat and removes its rooms, message history,
  metadata, and the rest of the device's local Hyper data and signing keys.

Leaving one room removes that room from the device and closes its active feed,
without deleting another participant's copy. General browser cache clearing is
separate and does not clear PeerChat or other P2P data.

## Identity transfer

PeerSky Mobile can restore supported identity data sent by PeerSky Desktop, but
the current transfer does not migrate the mobile-specific
`peerchat-mobile.json` state into a new device. Keep important room keys
separately and rejoin those rooms after moving devices. This limitation avoids
claiming safe migration between desktop and mobile state formats before room-key
protection and conflict behavior have been designed and tested end to end.

## Resource limits

The service limits room count, returned and stored history, room and total
storage bytes, frame and message size, pending direct-message requests, peer
members, initial synchronization, queued frames, live/control message rates,
tracked moderation state, and link-preview work. It releases feed listeners,
timers, transports, pending joins, swarm topics, and room state during leave,
runtime reset, P2P clearing, and application shutdown.

These limits protect a mobile process from unbounded memory, storage, and
network use. A room that reaches its local storage limit must be left or cleared
before more messages can be stored.

## Desktop interoperability smoke test

1. Use different profile names on one mobile device and one PeerSky Desktop
   profile.
2. Create a room on mobile, copy its key, join from desktop, and exchange
   messages in both directions.
3. Create another room on desktop, join from mobile, and verify its existing
   history and room details.
4. Verify replies, reactions, mentions, unread state, attachments, direct-message
   requests, pinning, muting, online presence, and host-owned moderation.
5. Disconnect one peer, reconnect it, and confirm history catches up without
   duplicate messages or sessions.
6. Restart both applications and confirm saved rooms and history return.
7. Disable internet access, connect both devices to the same local hotspot, and
   confirm discovery and two-way messaging still work.

## Developer checks

Run the deterministic checks before opening or updating a pull request:

```sh
npm run lint
npx tsc --noEmit
npm run test:runtime
npm run bundle:bare
```

PeerChat moderation data is generated from a pinned, licensed upstream source.
See [`backend/peerchat/MODERATION_DATA.md`](../backend/peerchat/MODERATION_DATA.md)
for provenance and regeneration instructions.
