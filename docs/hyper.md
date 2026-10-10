# Hyper protocol and offline data

PeerSky Mobile runs Hyperdrive inside a Bare worklet. The browser can open
`hyper://` pages and files, and the Hyperdrive app can publish, fetch, browse,
and explicitly retain folders for offline use. The first time the app opens it
says what it does in four lines, once per phone (`AppWelcome`, marker
`hyperdrive-welcome-seen`).

## Supported URLs

- `hyper://<drive-key>/` opens a Hyperdrive root.
- `hyper://<drive-key>/<path>` opens a file or directory in that drive.
- DNS-style Hyper aliases, such as `hyper://agregore.mauve.moe/`, are resolved
  by the Hyper runtime.

## What a page can do with hyper://

A page served over `hyper://`, under a drive key or a domain name, or over
`https://`, can call `fetch('hyper://...')` the way it does on desktop. Each is
a site of its own: a hyper:// page by its host, an https:// page by its origin.
A plain `http://` page gets nothing, since anyone on the network can change it
on the way. The phone has no protocol handler for hyper://, so the call crosses
the React Native bridge to the Bare worklet (`app/hyper-bridge.mjs`), and the
backend applies a few rules to anything a page asks for
(`backend/hyper/page-access.mjs`). iOS adds the bridge before the page loads.
Android runs that script only after a page loaded from a string has run its
own, so there the bridge is the page's first script, and it removes itself
once it has run.

What goes over the bridge, checked with a site published from a desktop and
opened on both phones:

- `fetch()` with relative or absolute addresses. A missing file answers 404
  with a response, as on desktop, rather than throwing.
- `XMLHttpRequest` to `hyper://`, which jQuery, axios and older pages use.
- Publishing: `POST hyper://localhost/?key=name`, then `PUT` a file, or `PUT`
  a `FormData` with one `file` field per file to save several at once
  (`backend/hyper/form-data.mjs` reads those for hypercore-fetch).
- Images, sound and video. The page's own markup is rewritten before it loads.
  An address set from script later, or added with `innerHTML`, gets the same
  signed link (see below), and so does `fetch()` of an image or a video.

Pages see their own `hyper://` address in `location` on both platforms. WebKit
only renders a page under an address whose scheme it can load, so on iOS the
browser's WebView has a handler for `hyper://`
(`plugins/templates/PeerSkyWebViewManager.m.template`). It answers a page's own
address with the page, as when a script sets `location` to it, and anything
else with 404: the rest of a drive reaches the page through the bridge and the
signed links above, the same as on Android. Before this, iOS pages read
`about:blank` from `location`.

- **Writes ask first.** The first time a site tries to create a drive or save a
  file, PeerSky asks whether it may publish. The answer is kept per site and can
  be changed in Settings, under Permissions. A tab in the background cannot ask.
- **A page's drives are its own.** `hyper://localhost/?key=name` from a page
  gets a drive named after that site as well as `name`, so `?key=p2pmd` from a
  page is never P2PMD's drive, and two sites asking for the same name never
  share one. A page writes only to drives it created.
- **Private drives stay private.** A page cannot read this phone's private
  drive, the drives adopted from a desktop, or the device-only one, unless it is
  a page inside that same drive. A site with a name, on hyper:// or https://,
  never reads one.
- **Asset links are signed.** Images, media and downloads in a page load from a
  local server on `127.0.0.1`. Each link carries a signature over its own
  address, so a page can load what it was given and cannot use one link to
  reach another file.

## Cached reads

Hypercore stores downloaded blocks on disk. A page or file that has already
been read can therefore remain available after the network disappears or the
app restarts. This cache is opportunistic: opening one file does not guarantee
that its sibling files or the complete containing directory are available.

When no peer is reachable, an uncached URL fails within a bounded time instead
of waiting indefinitely. Use **Keep offline** when the entire directory must be
available without a network connection.

## Keep a folder offline

Offline retention is explicit and scoped to a folder. PeerSky does not provide
a global switch that downloads every Hyperdrive.

1. Open a directory in the Hyperdrive app.
2. Tap **Keep offline**.
3. Keep PeerSky open while the initial download runs.
4. Wait for the state to change to **Available offline**.

The active download displays byte-based percentage progress when the drive
exposes enough block metadata. Otherwise it displays an indeterminate
downloading state.

The folder action reflects its current lifecycle:

- **Downloading**: missing blocks are being fetched.
- **Pause**: stops the active download but keeps its wanted-offline entry and
  blocks already stored on disk.
- **Resume**: starts the folder download again and requests only missing
  Hypercore blocks.
- **Waiting for Wi-Fi**: the Wi-Fi-only policy is enabled and Wi-Fi is not
  currently available.
- **Available offline**: `drive.has(folder)` confirms that all files under the
  selected path are locally available.
- **Remove offline**: removes the wanted entry and clears managed blocks that
  are not required by another retained path.

## Restart and background behavior

PeerSky records the drive key and folder path as soon as **Keep offline** is
selected. If the process stops during a download, the entry remains persisted.
On the next launch, PeerSky checks each wanted folder and resumes incomplete
downloads from the blocks already present.

Pause and process termination do not discard completed blocks. Android may
finish more work while backgrounded, but resume-on-open is the cross-platform
guarantee and is also used on iOS.

## Wi-Fi-only downloads

Open **Settings > P2P Data** and enable **Download only on Wi-Fi** to prevent
offline-folder downloads over cellular data. Active downloads pause when the
policy no longer permits network use and move to **Waiting for Wi-Fi**. They
resume when Wi-Fi becomes available or when the policy is disabled.

Normal foreground browsing is not blocked by this preference. It applies only
to explicit offline-folder downloads.

## Manage offline data

Open **Settings > P2P Data > Offline Hyper folders** to view retained folders,
their status, and their locally stored size when available. From this page a
download can be paused, resumed, or removed.

## Private drives

Hyperdrive uploads support three visibility modes:

- **Public**: written to the announced `hyperdrive-public` drive. Anyone with the URL can read it and browse the rest of that drive.
- **Private**: written to the `hyperdrive-private` drive, encrypted at the block level using a 32-byte `encryptionKey` (`hyperdrive@13.3.3` passes it to `hypercore@11.35.2`, which does block encryption). The drive is announced and replicated (the synced store runs `autoJoin: false`, `doReplicate: true`), so any device that holds the key can open it. The key is the one PeerSky Desktop sends with its identity through Link Device, so the desktop can open the phone's private files. Until a desktop has sent one, choosing Private asks to link the desktop first. The drive's key is kept in `private-drive-key.json` inside the synced private storage (`hyper-sdk-synced-private`), taken from the desktop's key at the top of Documents the first time the drive is opened.
- **This device only**: written to the isolated `hyperdrive-device` drive with discovery and replication disabled (`autoJoin: false`, `doReplicate: false`). It never leaves the phone, so it is the right choice when nothing should leave the device at all.

> [!NOTE]
> The key starts on the desktop. A desktop identity transfer carries it to the phone, along with the desktop's private drives, which the phone adopts read-only. Sending the phone's tabs and bookmarks to the desktop from Link Device also tells the desktop the phone's private drive address, and the desktop adds it to its own private drives, read-only. A phone that made a private drive before it was linked keeps that drive's own key, so that drive opens on the phone only. See `docs/link-device.md`.

## Private files on your other devices

A private upload shows up in Hyperdrive on the person's other devices on its
own, with no link to send: on the phone under **From your devices**, above
Recent, and on the desktop in its Hyperdrive app. Settings > Link Device lists
those devices under My devices, as Desktop or Phone, never by name, with a dot
while one is online and when it was last seen otherwise. A device can be taken
off the list there; it comes back the next time it connects.

Every device of one person holds the same private drive key: a desktop made it
and Link Device carried it to the phone (the top-level `private-drive-key.json`).
That key is what the devices meet under, which means the devices that sync are
exactly the ones that can already open each other's private files.

- They meet on the private store's swarm, the one that already replicates
  private drives, under the topic `HMAC-SHA256(key, "peersky-private-sync/1 topic")`.
  DHT nodes see the topic and cannot get the key from it.
- On each connection a protomux channel, `peersky-private-sync/1`, carries JSON
  frames. Each side first sends a proof:
  `HMAC-SHA256(HMAC-SHA256(key, "peersky-private-sync/1 proof key"), "peersky-private-sync/1 proof\n" + handshake hash + "\n" + its own network key)`.
  It is good on that connection alone and cannot be bounced back at its
  sender, the same construction as PeerChat's room proofs.
- Only after the other side's proof checks out does a device send its hello:
  `phone` or `desktop`, the private drives it writes (up to 200, a drive made
  under another key with that key), and on the phone whether it is on a
  cellular connection. A device sends it again when its drives or network
  change.
- The phone opens each listed drive in the synced private store, which
  replicates, lists its top folder newest first (up to 100 entries) into
  `Documents/device-sync.json`, and lists it again whenever the drive grows.
  A file downloads when it is opened. A desktop drive the phone adopted at a
  transfer is read from this live copy rather than the frozen one, which
  would show the drive as it was on the day of the transfer.
- The desktop adds the phone's drive to its private drives as
  `Private files from your phone`, read-only, and copies every file in it, so
  they open on the desktop with the phone asleep, which on iOS is most of the
  time. It waits while the phone says it is on a cellular connection, and
  copies once it says it is back on Wi-Fi.

What it does at the edges:

- Someone else's device never makes the topic. One that connects for another
  reason, say under a drive's topic, gets nothing: a wrong proof closes the
  channel before any hello is sent.
- A phone no desktop has linked starts nothing and opens no store for it.
- Two devices that join at the same moment each look before the other has
  announced. Until one is met they look again after 15 seconds, a minute and
  five minutes, and again on every network change and every return to the
  front.
- A device going offline stays listed, with when it was last seen, and its
  files stay listed. A device seen from two networks at once counts once.
- An older app does not open the channel, so nothing syncs until both are on
  a version that has it.
- At most 16 devices, 200 drives per device, 100 entries per drive listing,
  30 frames a minute per connection and 64 KiB per frame.

The code is `backend/hyper/device-sync-protocol.mjs` (keys and frames),
`device-sync-state.mjs` (the file) and `device-sync.mjs` (the service), started
in `runtime.mjs` when the synced private store opens and stopped when it
closes, so a backup never finds it running. PeerSky Desktop has the same three
files under `src/protocols/`, and both test the same vector: key `0f` x32,
handshake hash `0e` x64 and sender `0d` x32 give the topic
`e702b30ef6aaa58eb3694a8888c6ddeda12383813d5121dec0db65df9b9c3cc8` and the
proof `8beb43aaede8fa35e6b0558e88ebeae7c1b3e809c00a68ec98e698fdae438c6c`.

## Developer notes
**Clear all P2P data** is broader than **Remove offline**. It closes active P2P
runtimes and removes local Hyper and PeerChat data from the device.

## Implementation

The React Native UI communicates with the Bare backend through `bare-rpc`.
Relevant files include:

- `app/hyperdrive/HyperdriveScreen.tsx`: folder actions and progress UI.
- `app/hyperdrive/offline-network.mjs`: Wi-Fi policy decision.
- `app/settings/P2PStorage.tsx`: offline-folder management UI.
- `backend/hyper/offline-core.mjs`: validation and bounded manifest entries.
- `backend/hyper/offline-manifest.mjs`: atomic wanted-folder persistence.
- `backend/hyper/offline-manager.mjs`: download, pause, resume, remove, and
  progress lifecycle.
- `backend/hyper/fetch.mjs`: bounded Hyper reads and cached response handling.
- `backend/hyper/runtime.mjs`: Hyper SDK lifecycle and persistent storage.
- `backend/rpc/commands.mjs` and `backend/rpc/router.mjs`: mobile/backend RPC
  contract.

The wanted-folder manifest is bounded to 100 validated entries. Progress scans
and offline-size scans are also bounded so large or hostile drives cannot grow
memory use without limit.

## Development and tests

Regenerate the Bare bundle after backend changes:

```sh
npm run bundle:bare
```

Run the automated runtime tests:

```sh
npm run test:runtime
```

Offline coverage is primarily in:

- `test/protocol/hyper-offline-manager.test.mjs`
- `test/protocol/hyper-offline-manifest.test.mjs`
- `test/protocol/hyper-read-policy.test.mjs`
- `test/protocol/hyper-lan-replication.test.mjs`
- `test/platform/hyper-offline-network.test.mjs`
- `test/platform/hyperdrive-recents.test.mjs`

Real-device testing should still cover interrupted downloads, process restart,
Wi-Fi-to-cellular transitions, large folders, and offline reads after a full
app restart.
