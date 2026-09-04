<p align="center">
    <img align="center" src="/assets/images/icon.png" width="200" height="200"></img>
</p>

<h1 align="center">PeerSky Mobile</h1>

<div align="center">
    <!-- <img src="https://img.shields.io/github/actions/workflow/status/p2plabsxyz/peersky-mobile/build.yml" alt="GitHub Actions Workflow Status"> -->
    <!-- <img src="https://img.shields.io/github/v/release/p2plabsxyz/peersky-mobile?color=green" alt="GitHub Release"> -->
    <a href="https://mastodon.social/@peersky"><img src="https://img.shields.io/mastodon/follow/113323887574214930" alt="Mastodon Follow"></a>
    <a href="https://deepwiki.com/p2plabsxyz/peersky-mobile"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
    <a href="https://standardjs.com"><img src="https://img.shields.io/badge/code_style-standard-brightgreen.svg" alt="JavaScript Style Guide"></a>
</div>

A peer-to-peer mobile browser built with [Bare](https://github.com/holepunchto/bare), [Expo](https://expo.dev), and [React Native WebView](https://github.com/react-native-webview/react-native-webview).

## Features

- Browser shell with address/search input, history suggestions, home/back/forward navigation, reload, and native page sharing.
- Persistent multi-tab browsing with grid/list management, page previews, swipe-to-close, and close-all/burn controls.
- Local bookmarks with favicon support.
- Per-tab zoom and Desktop View controls.
- Browser download history and management.
- Long-press actions for opening, previewing, sharing, and downloading web media.
- Browser settings for search, appearance, accessibility, data clearing, and external app links.
- Native camera, microphone, location, and notification permission handling.
- Android system-back navigation, incoming web-link handling, and default-browser setup.
- Native ad and tracker blocking with EasyList and EasyPrivacy.
- `http://` and `https://` browsing through React Native WebView.
- `hyper://` browsing through the Bare worklet and `hypercore-fetch`.
- Hyper page asset support for CSS, images, scripts, audio, and video.
- Hyperdrive app for uploading files, fetching or scanning `hyper://` locations, browsing directories, and reopening recent items.
- Paginated P2P data management for owned app drives and published/fetched Hyper activity, with separate cache and full-data clearing controls.
- PeerChat rooms and direct messages with encrypted history, reactions, mentions, attachments, link previews, notifications, presence, and locally enforced room moderation.
- Encrypted identity transfer from PeerSky Desktop through Hyper.
- Local app routes for bundled peer-to-peer tools:
  - `peersky://p2p/p2pmd/`
  - `peersky://p2p/peerchat/`
  - `peersky://holesail/`
  - `peersky://hyperdrive/`

Hyper media is streamed through a local loopback proxy so WebView can play audio/video while the Bare runtime fetches the underlying `hyper://` asset.

## Ad and Tracker Blocking

PeerSky blocks matching ad and tracker requests at the WebView engine level. Android uses [`adblock-rust`](https://github.com/brave/adblock-rust), while iOS compiles supported rules with `WKContentRuleList`. A validated EasyList and EasyPrivacy snapshot is bundled so protection can initialize before the first network update.

This initial implementation covers network requests, not cosmetic filtering or element hiding. See the [content-blocking documentation](docs/content-blocking.md) for platform setup, update behavior, safeguards, and current limitations.

## Usage

Start by installing the dependencies:

```sh
npm install
```

### Linting

This project uses [StandardJS](https://standardjs.com) for code style. To check for lint errors:

```bash
npm run lint
```

To auto-fix lint errors:

```bash
npx standard --fix
```

When finished, you can run the app on either iOS or Android.

### iOS

```sh
npm run ios
```

### Android

Install the Rust Android build prerequisites once:

```sh
npm run setup:content-blocking
```

EAS Android builds run this setup automatically through the
`eas-build-pre-install` hook. The hook is skipped for iOS builds.

Builds fetch and validate the current EasyList and EasyPrivacy snapshots before
bundling them into the app. The generated files are not stored in Git, so the
first build requires network access; the resulting app can initialize protection
offline.

```sh
npm run android
```

## Docs

- [Browser shell](docs/browser-shell.md)
- [Hyper protocol](docs/hyper.md)
- [Holesail runtime](docs/holesail.md)
- [P2PMD](docs/p2pmd.md)
- [PeerChat moderation data](backend/peerchat/MODERATION_DATA.md)
- [Link Device](docs/link-device.md)
- [Testing guide](docs/testing.md)
- [Content blocking](docs/content-blocking.md)

## License

MIT

Bootstrapped from the [bare-expo](https://github.com/holepunchto/bare-expo) template by Holepunch, using [react-native-bare-kit](https://github.com/holepunchto/react-native-bare-kit).
