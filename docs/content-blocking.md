# Content blocking

PeerSky Mobile blocks network-level advertising and tracking requests before WebView sends them. Android evaluates HTTP and HTTPS subresource requests with Brave's Rust ad-blocking engine. iOS converts the supported EasyList and EasyPrivacy network-rule subset into native WebKit rules and attaches compiled `WKContentRuleList` instances before navigation. Main-frame navigation is not blocked.

PeerSky fetches and validates EasyList and EasyPrivacy at build time, then packages that snapshot so protection can initialize on a first launch without network access. The packaged files are copied into the app document directory, loaded natively, and checked automatically for refresh when older than seven days. Updates use only the fixed HTTPS sources below, enforce a 30-second timeout and a 12 MB decoded-size limit per list, and validate the Adblock header before activation. New snapshots become active only after the native engine accepts them, so malformed, partial, unavailable, or rejected updates keep the last known good rules.

The Privacy settings page provides a global protection switch, the active filter-list status, and a manual update action. Turning protection off is persisted across launches. Manual update failures leave the current validated snapshot active and report the failure in Settings.

The active metadata records the immutable snapshot identifier, update timestamp, source URL, upstream list version, filename, and byte size. Builds generate the packaged first-launch snapshot with:

```sh
npm run update:content-blocking-snapshot
```

The generated list files and manifest live in `assets/content-blocking/` but are ignored by Git because upstream data changes frequently. The tracked `assets/content-blocking/LICENSE` file records the upstream terms and is preserved whenever the snapshot is regenerated. `npm run bundle:bare`, `npm test`, and EAS builds generate the snapshot automatically; direct native prebuilds must run the update command first.

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

The setup script accepts Cargo from `CARGO`, the standard Cargo home directory, or the system `PATH`. Android parses one shared native ruleset and reuses it across all WebViews. Filtering runs from WebView's request interception callback without a React Native bridge round trip for each request.

The repository pins Rust 1.85.1 and the required Android targets in `rust-toolchain.toml`. EAS Android builds invoke the same setup through `eas-build-pre-install`; non-Android EAS builds skip it.

## iOS setup

The Expo config plugin generates the iOS bridge and custom WebView during prebuild. WebKit rule JSON is generated once per immutable filter-list snapshot, bounded to 45,000 rules per list, and cached with that snapshot. `WKContentRuleListStore` then reuses compiled rules for subsequent launches.

On macOS, generate and run the iOS project with:

```sh
npm run bundle:bare
npx expo prebuild --platform ios --no-install
npm run ios
```

Unsupported Adblock modifiers, cosmetic rules, and regular-expression filters are skipped rather than converted into broader rules. The previous compiled rules remain active if a new snapshot cannot be converted or compiled.

## Scope and limitations

- Network filtering applies to HTTP and HTTPS subresources. Top-level page navigation is intentionally allowed.
- Hyper, PeerSky internal pages, localhost, Android emulator loopback, P2PMD, and Holesail traffic are excluded from filtering.
- Android uses the network-rule support provided by the pinned `adblock-rust` engine.
- iOS converts the supported network-rule subset to WebKit JSON. Unsupported modifiers and regex filters are skipped safely.
- Cosmetic filtering, element hiding, cookie banners, scriptlets, and anti-adblock circumvention are outside this initial implementation. A synthetic blocked response may therefore score differently from browser extensions on visual ad-block test pages.
- Filter-list updates do not accept custom URLs. This keeps the native parser boundary limited to the reviewed EasyList sources.

## Validation

Automated tests cover source and state validation, expiry, bounded transfers, packaged snapshot integrity, concurrent and forced updates, cached fallback, Android native generation and matching, iOS conversion and compile/cache wiring, preference persistence, and multi-WebView application. The Android smoke flow is: enable protection, load multiple normal pages, confirm known ad/tracker requests are blocked, toggle protection off and on, force a list update, restart the app, and repeat once offline using the cached snapshot. iOS requires the equivalent device smoke test from a macOS/Xcode environment before release.

## Third-party components

- [`brave/adblock-rust`](https://github.com/brave/adblock-rust), licensed under Mozilla Public License 2.0.
- [EasyList and EasyPrivacy](https://easylist.to/pages/licence.html), maintained by the EasyList authors and dual-licensed under GPL-3.0-or-later or CC BY-SA 3.0-or-later.

The packaged snapshots retain their upstream headers and licence notices. A local copy of their attribution and licence choices is stored in `assets/content-blocking/LICENSE`; their exact source URLs, versions, generation time, and byte sizes are recorded in `assets/content-blocking/manifest.json`.
