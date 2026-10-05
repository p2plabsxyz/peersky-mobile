<p align="center">
    <img align="center" src="/assets/images/logo.png" width="200" height="200"></img>
</p>

<h1 align="center">PeerSky Mobile</h1>

<div align="center">
    <img src="https://img.shields.io/github/actions/workflow/status/p2plabsxyz/peersky-mobile/ci.yml" alt="GitHub Actions Workflow Status">
    <img src="https://img.shields.io/badge/Platform-iOS%20%7C%20Android-black.svg" alt="platform">
    <a href="https://mastodon.social/@peersky"><img src="https://img.shields.io/mastodon/follow/113323887574214930" alt="Mastodon Follow"></a>
    <a href="https://deepwiki.com/p2plabsxyz/peersky-mobile"><img src="https://img.shields.io/badge/Ask-DeepWiki-blue.svg" alt="Ask DeepWiki"></a>
    <a href="https://standardjs.com"><img src="https://img.shields.io/badge/code_style-standard-brightgreen.svg" alt="JavaScript Style Guide"></a>
</div>

📱 [Download](https://peersky.p2plabs.xyz/) 📜 [Docs](./docs/) 🔒 [Privacy](./PRIVACY.md)

PeerSky Mobile is the peer-to-peer browser for your phone. The everyday web works as usual, and alongside it your phone becomes a node (a server for the network), so pages, files, chats and notes can travel straight between devices instead of through one company's server. It comes with its own apps: chat, shared notes, file sharing and a music player. There is no account, nothing about you is collected, and devices on the same Wi-Fi keep talking even when the internet is down.

We are building a surveillance-free internet where you own your tools, your data, and your connections, and where no single company can shut you out. Our vision is to save the internet, one peer at a time.

## Roadmap

- [ ] Local LLM search
- [ ] Web Monetization
- [ ] Translations for the whole app
- [ ] PeerChat
  - [ ] Blind peers for messages
  - [ ] Voice and video calls

## Development

### Node.js and npm Setup

Please refer to the [Node.js official documentation](https://nodejs.org/) to install Node.js. Once installed, npm (Node Package Manager) will be available, allowing you to run commands like `npx` and `npm`.

- **npm**: Comes bundled with Node.js. Verify installation by running:
  ```bash
  node -v
  npm -v
  ```

You also need Xcode for iOS, or Android Studio for Android.

### Install dependencies

```bash
npm install
```

### Start the app

```bash
npm run ios
```

```bash
npm run android
```

The first iPhone build goes through Xcode once, and Android needs a one-time setup for the ad blocker. Both are in [Building](./docs/building.md).

### Build

Pushing a version tag builds a signed Android APK and attaches it to a GitHub release. The App Store and Google Play builds come from the same code. What to do in the store consoles is in [Releasing](./docs/store-release.md).

### Linting

This project uses [StandardJS](https://standardjs.com) for code style. To check for lint errors:

[![js-standard-style](https://cdn.rawgit.com/feross/standard/master/badge.svg)](https://github.com/feross/standard)

```bash
npm run lint
```

To auto-fix lint errors:

```bash
npx standard --fix
```

### Testing

Run all tests:

```bash
npm test
```

Run specific test suites:

```bash
npm run test:runtime        # Protocol, app and native code tests
npm run test:bundle         # Builds the peer-to-peer backend bundle
npm run test:holesail:live  # P2PMD tunnel over the real network
```

`npm test` builds the backend bundle and then runs every test against it.

For detailed testing documentation, see [Testing Guide](./docs/testing.md).

## Contribute

- Thanks for your interest in contributing to PeerSky Mobile. There are many ways you can contribute to the project.
- To start, take a few minutes to read the "[contribution guide](https://github.com/p2plabsxyz/peersky-mobile/blob/main/.github/CONTRIBUTING.md)".
- We look forward to your [pull requests](https://github.com/p2plabsxyz/peersky-mobile/pulls) and / or involvement in our [issues page](https://github.com/p2plabsxyz/peersky-mobile/issues).
- To report a security problem, see [SECURITY.md](./.github/SECURITY.md). To report harmful public content, [open a report](https://github.com/p2plabsxyz/peersky-mobile/issues/new?template=content-report.yml).

## License

PeerSky Mobile is licensed under the [MIT License](https://github.com/p2plabsxyz/peersky-mobile/blob/main/LICENSE). It started from Holepunch's [bare-expo](https://github.com/holepunchto/bare-expo) template.
