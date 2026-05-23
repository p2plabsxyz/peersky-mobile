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

A peer-to-peer mobile browser built with [Bare](https://github.com/holepunchto/bare) and [Expo](https://expo.dev).

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

```sh
npm run android
```

## License

MIT

Bootstrapped from the [bare-expo](https://github.com/holepunchto/bare-expo) template by Holepunch, using [react-native-bare-kit](https://github.com/holepunchto/react-native-bare-kit).
