# Building and running

What you need to get PeerSky Mobile onto a simulator, an emulator or a phone,
and what each build step does.

## What you need

- Node.js and npm.
- Xcode 26 for iOS. Apps built with the iOS 27 SDK must use the UIScene life
  cycle, which this Expo version does not, so stay on Xcode 26 for now.
- Android Studio and the Android SDK for Android, plus the Rust toolchain for
  the ad blocker (see below).

## Every build

`npm run ios` and `npm run android` first run `npm run bundle:bare`. That packs
the peer-to-peer backend (`backend/`) into `app/app.bundle.mjs` with
`bare-pack`, regenerates the files P2PMD and PeerTunes load (Yjs, KaTeX, the
IEEE paper layout, the PeerTunes runtime), and refreshes the ad-block snapshot.

The snapshot step fetches the current EasyList and EasyPrivacy lists and checks
them before bundling, so the first build needs the internet. The app itself
starts blocking offline, from the snapshot it ships with.

When `app.json` or a config plugin changes, start the native projects again
from scratch, or an old `ios/` or `android/` folder keeps old settings:

```bash
npx expo prebuild --clean
```

## iPhone

The app and its home screen widgets share an App Group, which Apple has to know
about before either can be signed. `npm run ios` cannot ask Xcode to set that
up: Expo only lets Xcode change provisioning when it picks the signing team
itself, and the widgets need `ios.appleTeamId` set. So the first build onto a
phone, and the first after a capability changes, goes through Xcode once,
signed in to the team's Apple ID:

```bash
xcodebuild -workspace ios/PeerSky.xcworkspace -scheme PeerSky -configuration Debug -destination generic/platform=iOS -allowProvisioningUpdates REGISTER_APP_GROUPS=YES build
```

Building from Xcode itself does the same. After that, `npm run ios` works.

## Android

The ad blocker on Android is a small Rust library. Install the toolchain once:

```bash
npm run setup:content-blocking
```

EAS Android builds run it on their own, through the `eas-build-pre-install`
hook. iOS does not need it.

If Gradle says it cannot find the SDK, tell it where Android Studio put it,
either with `ANDROID_HOME` or in `android/local.properties`:

```properties
sdk.dir=/Users/you/Library/Android/sdk
```

## Releases

Pushing a `v*` tag builds a signed APK and attaches it, with its SHA-256, to a
GitHub release. The App Store and Google Play builds come from the same code.
[Releasing](store-release.md) has the signing keys, the workflow and what to do
in the store consoles.
