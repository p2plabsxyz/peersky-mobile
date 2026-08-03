# Content blocking

PeerSky Mobile blocks network-level advertising and tracking requests before WebView sends them. Android evaluates HTTP and HTTPS subresource requests with Brave's Rust ad-blocking engine. iOS converts the supported EasyList and EasyPrivacy network-rule subset into native WebKit rules and attaches compiled `WKContentRuleList` instances before navigation. Main-frame navigation is not blocked.

Filter lists are downloaded over HTTPS, size checked, validated, and stored as snapshots in the app document directory. A valid cached snapshot is enabled before a background refresh starts. New snapshots become active only after the native engine accepts them, so a failed update keeps the last known good rules.

## Android setup

The native blocker is generated during Expo prebuild and compiled for Android with Rust and `cargo-ndk`. After installing Java, Android Studio/SDK, Node.js, and project dependencies, install the native prerequisites once:

```sh
npm run setup:content-blocking
```

Then generate and run the Android project:

```sh
npm run bundle:bare
npx expo prebuild --platform android --no-install
npm run android
```

The setup script accepts Cargo from `CARGO`, the standard Cargo home directory, or the system `PATH`.

## iOS setup

The Expo config plugin generates the iOS bridge and custom WebView during prebuild. WebKit rule JSON is generated once per immutable filter-list snapshot, bounded to 45,000 rules per list, and cached with that snapshot. `WKContentRuleListStore` then reuses compiled rules for subsequent launches.

On macOS, generate and run the iOS project with:

```sh
npm run bundle:bare
npx expo prebuild --platform ios --no-install
npm run ios
```

Unsupported Adblock modifiers, cosmetic rules, and regular-expression filters are skipped rather than converted into broader rules. The previous compiled rules remain active if a new snapshot cannot be converted or compiled.

## Third-party components

- [`brave/adblock-rust`](https://github.com/brave/adblock-rust), licensed under Mozilla Public License 2.0.
- [EasyList and EasyPrivacy](https://easylist.to/pages/licence.html), maintained by the EasyList authors and dual-licensed under GPL-3.0-or-later or CC BY-SA 3.0-or-later.
