<p align="center">
    <img align="center" src="/assets/images/app-icon-transparent.png" width="200" height="200"></img>
</p>

<h1 align="center">PeerSky Mobile</h1>

<div align="center">
    <a href="https://mastodon.social/@peersky"><img src="https://img.shields.io/mastodon/follow/113323887574214930" alt="Mastodon Follow"></a>
    <a href="https://deepwiki.com/p2plabsxyz/peersky-mobile"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
    <a href="https://standardjs.com"><img src="https://img.shields.io/badge/code_style-standard-brightgreen.svg" alt="JavaScript Style Guide"></a>
</div>

A peer-to-peer browser for your phone. It opens the ordinary web, and it opens
`hyper://` too, where pages come from other people's devices rather than from a
company's servers. No account, no analytics, and nothing about you kept anywhere
you cannot reach.

Built with [Bare](https://github.com/holepunchto/bare),
[Expo](https://expo.dev) and
[React Native WebView](https://github.com/react-native-webview/react-native-webview).
There is a desktop version too, at [peersky.p2plabs.xyz](https://peersky.p2plabs.xyz/).

## What it does

**Browsing.** Tabs that survive a restart, bookmarks, history, downloads, per-tab
zoom and desktop view, and page sharing. Ads and trackers are blocked by the
engine itself using EasyList and EasyPrivacy, with a snapshot bundled so you are
protected before the first update lands.

**The peer-to-peer web.** `hyper://` pages are fetched by a Bare worklet and
served to the WebView, images, scripts and media included. A page built on Hyper
can publish and upload from the phone the same way it does on desktop. Devices
on the same Wi-Fi find each other directly, so it keeps working with the
internet down.

**Apps that came with it.** A Hyperdrive file browser, P2PMD for notes and
slides, PeerChat for encrypted rooms and direct messages, and PeerTunes for
music from your own drives. Each has its own address:

```
peersky://p2p/hyperdrive/   peersky://p2p/p2pmd/   peersky://p2p/peerchat/
peersky://p2p/peertunes/    peersky://holesail/
```

**Your data.** Everything lives on the device. P2P storage is listed per app so
you can see what is there and remove it, and an identity can be moved from
PeerSky Desktop over an encrypted transfer.

See [PRIVACY.md](PRIVACY.md) for exactly what leaves the phone and what does not.
To report harmful public content, [open a report](https://github.com/p2plabsxyz/peersky-mobile/issues/new?template=content-report.yml).

## Running it

```sh
npm install
npm run ios       # or: npm run android
```

Android needs the Rust toolchain for content blocking once:

```sh
npm run setup:content-blocking
```

EAS Android builds run that automatically through the `eas-build-pre-install`
hook; iOS skips it. Builds fetch and validate the current filter lists before
bundling them, so the first build needs network access. The app itself starts
blocking offline.

```sh
npm run lint      # StandardJS, with npx standard --fix to repair
npm test          # the full suite
```

## Docs

[docs/](docs/README.md) has the rest: how the browser shell is put together, how
`hyper://` is fetched, how content blocking works per platform, and one page for
each built-in app.

## License

MIT

Bootstrapped from the [bare-expo](https://github.com/holepunchto/bare-expo)
template by Holepunch, using
[react-native-bare-kit](https://github.com/holepunchto/react-native-bare-kit).
