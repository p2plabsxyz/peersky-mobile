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

## Folders: Files, Photos and Videos

A `hyper://` folder that is not a website opens in the Hyperdrive viewer
rather than as a list of names: Files for anything mixed, Photos for a camera
roll, Videos for shows and movies. The viewer is the page PeerSky Desktop
shows too, written in [p2plabsxyz/upload](https://github.com/p2plabsxyz/upload)
under `viewer/`, and copied here to `assets/hyperdrive-viewer/`.

Its address is `peersky://p2p/hyperdrive/<view>/<host><path>`
(`app/hyperdrive/viewer-route.mjs`). `<view>` is `files`, `photos` or
`videos`, `<host>` the drive's key or name in lower case, and `<path>` the
folder, starting and ending with `/`, each segment percent-encoded. `?auto`
lets the viewer pick the view from what the folder holds, and the fragment
holds what is open inside it, as `#album=/2024/Goa/`. The address bar shows
this address, and typing it, a link to it or a restored tab opens the viewer.

When it opens on its own: a `hyper://` folder that is not a website opens
`peersky://p2p/hyperdrive/files/<host><path>?auto` in the same tab, in place
of what came back (`getFolderViewerRedirect`). That is a folder that comes
back as hypercore-fetch's JSON listing, or as an index file that is not a
web page: `README.md`, `README.org`, `index.md`, `index.gmi`, `index.gemini`
or `index.org`, in any case, which the viewer shows under the list. Only
`index.html` and `index.htm` keep a folder a website. hypercore-fetch names
the file it served for a folder in its canonical link
(`Link: <hyper://<key>/docs/README.md>; rel="canonical"`), and
`RPC_HYPER_FETCH` hands the app its headers, so that is what the app goes by;
the response's own address is still the folder's. History keeps the
`hyper://` address, as it did for the list. `raw` or `noResolve` in the
query, as `hyper://<key>/photos/?raw`, shows what came back, and so does the
README's own address. The viewer's Open raw listing asks for both. A page's own `fetch()` of a folder goes through the
bridge and is never sent to the viewer. The Hyperdrive screen's folders open
in the app as before; a drive opened from Settings > P2P Data opens in the
viewer's Files view.

How it loads:

1. `RPC_HYPERDRIVE_VIEWER_START` starts the viewer's server
   (`backend/hyperdrive-viewer/server.mjs`) on `127.0.0.1:47318`. The port is
   fixed so the page's origin, and what the viewer keeps in its IndexedDB,
   stay the same from one launch to the next. If something else holds it, a
   random port works for that session. A P2PMD note never takes it.
2. `app/hyperdrive/DriveViewerScreen.tsx` loads
   `http://127.0.0.1:47318/hyperdrive/<view>/<host><path>` in a WebView, with
   the browser's address bar and tabs around it, and sets
   `window.peerskyViewer` before the page runs:
   `{ platform, language, strings, dark, incognito, epoch, safeArea, token }`.
   `strings` are the viewer's texts from the catalog in force (see
   [Translations](translations.md)), `safeArea` is all zero, since the
   browser's bars sit around the page, and `token` is the server's secret
   for this run (below). The script sets nothing on a page of any other
   origin.
3. The page moves between folders itself and says where it is with a message.
   The tab's address and title follow, in the same history entry, so back
   leaves the viewer for the page before it. Back and forward first step
   through the viewer's own folders and the photo or video open in it.

| Endpoint | Method | Purpose |
|---|---|---|
| `/hyperdrive/files/...`, `/hyperdrive/photos/...`, `/hyperdrive/videos/...` | `GET`, `HEAD` | The viewer's page, one for every view and folder. It reads where it is from its address, and no other page may frame it |
| `/hyperdrive/viewer/<file>` | `GET`, `HEAD` | The viewer's scripts, styles and data, from `backend/hyperdrive-viewer/viewer-runtime.mjs` |
| `/hyper/asset?url=hyper://...&token=...` | `GET`, `HEAD` | A file of the drive, with `Range`. HTML, SVG, XML and anything but images, audio, video, plain text, subtitles (`text/vtt`) and JSON come back as `application/octet-stream`, every file with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` and `Cache-Control: no-store`, and none with CORS. A download is `&download=1&name=...&sig=...` in place of `token` (below), and saves the file under that name |
| `/api/list?url=hyper://...&recursive=1&token=...` | `GET` | Every file under the folder: `{ entries: [{ path, size, mtime }], truncated, private, writable }`, and `name` at the top of a drive whose name this phone knows |

Anything else answers 404, a write 405, and a request another site made 403
(`backend/loopback-request.mjs`).

The origin checks keep websites out, but another app on the phone can call
`127.0.0.1` as well, and it sends no `Origin` at all. So `/api/list` and
`/hyper/asset` also answer 403 unless the address carries `token=` with the
secret the server made when it started: 32 random bytes in hex, new with
every start, compared in constant time and never logged. The start RPC hands
it to the app, which gives it to the viewer's page in
`window.peerskyViewer.token` and to nothing else: never the tab's address,
its history, a download, the clipboard, the share sheet or a new tab. A
message from the page that carries it is refused whole. The page puts it on
every `/api/list` and `/hyper/asset` address it makes, `<img>`, `<video>` and
`<track>` included. A server started again has a new secret, and the viewer
loads again with it. The page and the viewer's own files need no secret.

A download stays in Downloads with its address, so it carries a signature
instead: `RPC_HYPERDRIVE_VIEWER_DOWNLOAD` hands back the address with
`sig=`, the HMAC-SHA256 of that one file's `hyper://` address keyed with this
run's secret, as `signHyperAssetUrl` in `backend/hyper/assets.mjs` signs the
asset server's links. `/hyper/asset` takes a `sig` only with `download=1`
and only for that file, and `/api/list` never does, so the address opens
nothing else. A retry has the backend sign it again, since a server started
again refuses the old signature.

The listing (`backend/hyperdrive-viewer/drive-list.mjs`) reads the drive in
the worklet with `drive.list`, the same shape and caps as the desktop's: files
only, `path` as the drive has it, `size` in bytes, `mtime` in milliseconds
from the file's metadata or `null`, and at most 50,000 files, or 16 MB of
paths, with `truncated` past that. A drive this phone knows nothing about
waits up to 30 seconds for a peer, and the listing itself up to two minutes.
A failure is `{ code, message }` with a status to match: `not-found` 404,
`private` 403, `no-peers` 503, `timeout` 504, `too-large` 413 and `unknown`
500, or 400 for an address that is not a drive's. When the viewer stops
waiting, the listing stops too.

`name` is the name a person gave the drive, and only at its top; the viewer
shows it in place of the key (`backend/hyperdrive-viewer/drive-names.mjs`).
It is never made up from the address or from what the drive holds. This
phone names none of the drives it makes: uploads go into Public, Private and
This device only, which nobody named, as the desktop calls an upload with no
name `Drive` and leaves it out. What it knows is the desktop's list of
private drives, `privateHyperdrives.json`, by the names they were made under
there, which Link Device keeps beside the phone's identity. It is read again
for each drive's top, matched by the drive's key.

Private drives: the viewer is one of the app's own pages, so it reads drives
the way the app does, not the way a site does. This phone's private drive, the
drives adopted from a desktop and the device-only drive open with their keys,
and a private drive a linked device made since the link is tried with this
phone's keys, as `fetch.mjs` does. Anyone else's private drive answers
`private`. `private` in the listing is true for all of these, and the viewer
then keeps nothing it makes of them past the page; the server sends every
file with `no-store`, so none reaches the WebView's disk cache either.
`writable` is whether this phone writes the drive. A private file answers a
`Range` with 206 like any other, so a private video seeks.

What the page can ask of the app, each checked in
`app/hyperdrive/drive-viewer.mjs` and taken only from the viewer's own origin:

- `route`: the tab's address and title.
- `download`: the file, saved through `/hyper/asset` under its name with a
  signature for that file alone, and listed in Downloads, where a retry is
  signed again.
- `open`: a `hyper://` or `http(s)://` address in a new tab. A drive's page,
  picture or document never renders inside the viewer, and only the viewer's
  own pages load in its WebView.
- `copy` and `share`: a link, to the clipboard or the share sheet.

An incognito tab's viewer is told so, and keeps what it makes in memory. On
iOS its WebView has a store of its own that is never written to disk; on
Android it does not, since react-native-webview's `incognito` empties every
tab's cookies there.

The viewer keeps the small pictures and details it makes of public drives in
its IndexedDB, and empties them whenever `epoch` changes. That number is the
`hyperdriveViewerEpoch` browser preference: Burn Tabs and Data, Clear all P2P
data, Remove my data and a restore move it on, to the time they ran and never
to a number it had before. A phone with none, a new one or one Remove my data
emptied, gets one before the viewer first opens, and a restore moves it on in
the preferences the restore brought. Burning the tabs keeps the app's own
pages' storage, as PeerTunes' library needs, so this is what clears the
viewer's.

To bring in a new version of the viewer, run
`node scripts/sync-hyperdrive-viewer.mjs <path to the upload repo>`. It copies
`viewer/` to `assets/hyperdrive-viewer/` and writes
`backend/hyperdrive-viewer/viewer-runtime.mjs` (which `npm run bundle:bare`
also writes), `app/i18n/viewer-strings.json` and `app/i18n/strings.json`.
`node scripts/i18n.mjs --check` then lists the viewer's new texts each catalog
still needs. The place names the Photos view uses come from
[GeoNames](https://www.geonames.org) under CC BY 4.0, credited in Settings >
Licenses.

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

Hyperdrive opens its core exclusively, so a second open of one drive waits for
the first to close, which a drive hyper-sdk keeps never does.
`backend/hyper/shared-drive-opens.mjs` makes opens of one drive share one, by
address, key or name. A drive this phone made is opened by name and by address
too (a PeerChat room's files drive, by name to upload and by address to show a
picture sent earlier), so an open by name first reads the drive's key from a
session on its core that takes no lock, and shares the open of that key. Before
that, an upload after a restart could wait forever, and every upload after it
queued behind.
**Clear all P2P data** is broader than **Remove offline**. It closes active P2P
runtimes and removes local Hyper and PeerChat data from the device, and this
device's identity with it, the way the desktop's Reset P2P data starts it over
on the network: the Link Device keys and last pairing code, a desktop's
identity record, the key private files are encrypted with, the private drives
it sent, the list of other devices and their drives, what other devices sent
that the apps have not taken yet, and the apps' own lists of that data (the
list is in `backend/hyper/p2p-reset.mjs`). Tabs, bookmarks, history, downloads
and settings stay, which is what sets it apart from Remove my data from this
phone in Link Device. Link Device first drops a restore that is waiting and a
transfer going out, and a note this phone hosts is closed. Everything goes
into `.peersky-p2p-reset` first and is then deleted, so a clear the app is
killed in is finished at the next start, before any store opens
(`backend/main.mjs`). The app shows its restart screen before anything is
removed, since what is on screen belongs to the identity going.

## Implementation

The React Native UI communicates with the Bare backend through `bare-rpc`.
Relevant files include:

- `app/hyperdrive/HyperdriveScreen.tsx`: folder actions and progress UI.
- `app/hyperdrive/DriveViewerScreen.tsx`, `viewer-route.mjs` and
  `drive-viewer.mjs`: the Files, Photos and Videos views, their addresses and
  their messages.
- `backend/hyperdrive-viewer/`: the viewer's server and folder listing.
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

The Hyperdrive viewer's server, listing, secret, addresses and messages are
covered in `test/protocol/hyperdrive-viewer-http.test.mjs`,
`test/protocol/hyperdrive-viewer-list.test.mjs`,
`test/protocol/hyperdrive-viewer-token.test.mjs` and
`test/platform/hyperdrive-viewer.test.mjs`.
`test/protocol/hyperdrive-viewer-private.test.mjs` reads this phone's own
encrypted drive through the server's real wiring: a range of a private file
comes back as 206 with only those bytes, a video in windows a player can seek
through, and the listing says the drive is private.
`test/protocol/hyperdrive-viewer-folders.test.mjs` opens folders of a real
drive the way a tab does, through `fetchHyper`: one served as its README,
README.org or index.gmi opens the viewer, one with an index.html stays a
website, and the README's own address and `?noResolve` show as they are. Its
listing names the drive at its top from a kept `privateHyperdrives.json`.

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
