# Hyper protocol and offline data

PeerSky Mobile runs Hyperdrive inside a Bare worklet. The browser can open
`hyper://` pages and files, and the Hyperdrive app can publish, fetch, browse,
and explicitly retain folders for offline use.

## Supported URLs

- `hyper://<drive-key>/` opens a Hyperdrive root.
- `hyper://<drive-key>/<path>` opens a file or directory in that drive.
- DNS-style Hyper aliases, such as `hyper://agregore.mauve.moe/`, are resolved
  by the Hyper runtime.

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

- **Public** — written to the announced `hyperdrive-public` drive. Anyone with the URL can read it and browse the rest of that drive.
- **Private** — written to the `hyperdrive-private` drive, encrypted at the block level using a per-device 32-byte `encryptionKey` (`hyperdrive@13.3.3` passes it to `hypercore@11.35.2`, which does block encryption). Until device linking is enabled, the drive stays on this phone: any drive whose key is not on a device cannot be opened there, so in the current build a Private upload is locked to this device. The UI copy reflects that ("only this phone can read it"). The key is generated on first use and persisted in `private-drive-key.json` beside the synced private storage (`hyper-sdk-synced-private`). Applying a device-linked key is on the roadmap; when it lands, a drive carrying that key can be opened and replicated between your devices.
- **This device only** — written to the isolated `hyperdrive-device` drive with discovery and replication disabled (`autoJoin: false`, `doReplicate: false`). It never leaves the phone, so it is the right choice when nothing should leave the device at all.

> [!NOTE]
> A Private drive is device-only for now: its encryption key is generated and persisted on the phone, and it does not announce or replicate, so the storage claim matches the UI ("locked and only this phone can read them"). The key distribution mechanism (the device-linking channel described in `link-device.md`) is the path to multi-device reads; until a drive's key is present on a device, that device cannot open it.

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
