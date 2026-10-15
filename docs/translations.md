# Translations

PeerSky's own screens come in 25 languages: English, Spanish, Portuguese (Brazil), French, German, Italian, Dutch, Polish, Russian, Ukrainian, Turkish, Arabic, Persian, Urdu, Hindi, Marathi, Sanskrit, Bengali, Indonesian, Vietnamese, Thai, Japanese, Korean, and Chinese in simplified and traditional script (`app/i18n/languages.mjs`).

## Which language

Settings, Language lists each language under its own name. **Phone language**, the default, follows the phone: on iOS the languages in the app's defaults, where one picked for PeerSky alone in iOS Settings lands too, and on Android the locale the app runs in, which follows one picked for PeerSky in Android Settings (Android 13 and later). The first language PeerSky has wins, and English when it has none of them (`matchLanguage`).

The choice is the `language` browser preference. `app/i18n/setup.ts` reads it straight from the preferences file before the first screen draws, so PeerSky starts in it. Picking another language changes the text on every screen at once: the root component subscribes to the language (`useT`), and everything hangs off it.

Arabic, Persian and Urdu read right to left. React Native lays the screens out by the direction PeerSky starts with, so switching into or out of one of them changes the text at once and the layout at the next start, and PeerSky says so (`applyLanguageSetting` in `app/i18n/apply-language.ts`).

## How text is written

The English text is the key, as gettext does it, so code reads as what it shows:

```js
import { msg, t, tKey, tp } from '../i18n/i18n.mjs'

t('Saved to Photos')
t('Remove {name}?', { name })
tp({ one: '{count} file', other: '{count} files' }, count)
```

- Anything that changes goes in a `{placeholder}`, never in `+` or a template literal, so a translator can move it.
- `tp()` picks the form a count takes in the language shown (`app/i18n/plural.mjs`, CLDR's rules for whole numbers; Sanskrit's dual is ours, since CLDR has none).
- A table written at the top of a file marks its text with `msg()`, which returns it unchanged, and whatever shows it calls `tKey()`. A `t()` at the top level of a file would run once, in whatever language was in force when the file loaded.
- Text a catalog lacks shows in English.

`node scripts/i18n.mjs` reads every file that imports these and refuses a call whose text is not one plain string literal, with its place. A call named in a comment is not one. `--write` updates `app/i18n/strings.json` (every text and plural the app uses), `app/i18n/catalogs.ts` and the native files below. `--check` also says what each catalog lacks or gets wrong: a missing text, a plural form the language needs, placeholders that differ from the English, or a text nothing uses any more. `test/platform/i18n.test.mjs` fails on any of those, and when strings.json is out of date.

## The catalogs

One JSON file per language in `app/i18n/locales`, the English text to its translation. A plural is kept under its English `other`, as an object with a form for each category the language has. A catalog is required only when its language is picked, so the others are never parsed.

## The Hyperdrive viewer

The Files, Photos and Videos views of a `hyper://` folder are a web page, `assets/hyperdrive-viewer`, copied from [p2plabsxyz/upload](https://github.com/p2plabsxyz/upload) (see [Hyper](hyper.md)). It translates itself the same way: its own `i18n.js` has `t()`, `tp()`, `msg()` and `tKey()` with the same rules, the English is the key, and plurals take the forms of `plural.mjs`, which its `lib/plural.js` copies.

- `node scripts/i18n.mjs` reads the viewer's scripts too, each one that imports these from the viewer's `i18n.js` (as `'/hyperdrive/viewer/i18n.js'`), and refuses a call there the same way. Its texts are in `strings.json`, so every catalog needs them like the app's own.
- `--write` also writes `app/i18n/viewer-strings.json`, the texts the viewer uses and nothing else. `scripts/sync-hyperdrive-viewer.mjs` writes it and `strings.json` too when it brings in a new viewer.
- `app/hyperdrive/DriveViewerScreen.tsx` hands the page those texts from the catalog in force, and only those, as `window.peerskyViewer.strings`, with the language for its plurals and for `Intl`: numbers, sizes, dates, and the names of countries and languages. A text the catalog lacks shows in English, and switching languages loads the page again.
- PeerSky Desktop shows the viewer in English for now.

## Outside JavaScript

Some text is shown by the phone itself, from files made when the app is built. It follows the phone's language, or the one picked for PeerSky in the phone's Settings, not the one picked in PeerSky. `app/i18n/native-strings.mjs` holds its English, and `--write` makes each language's copy from the catalogs.

- iOS's own prompts for the camera, the local network, location, the microphone and saving to Photos, from Info.plist, and the quick actions on the app icon. Each language's copy is in `app/i18n/native/<code>.json`, and the `locales` in `app.json` turn those into `<code>.lproj/InfoPlist.strings`, which is also how iOS knows which languages to offer for PeerSky in its Settings. The prompts' English has to match `app.json`. A quick action's title in Info.plist is a key such as `ShortcutNewTab`, and each language's InfoPlist.strings, English too, has its words: Expo writes those files with each key unquoted, which a title with a space in it would break.
- The home screen widgets and the PeerTunes buttons, in Swift. Every language's words go into `targets/widgets/_shared/Localizable.xcstrings`, a String Catalog Xcode builds into the widgets and the app.
- Android's PeerChat background notification and its channel in Android's notification settings. They are string resources, from the `android` part of the same files in `app/i18n/native`, which the `locales` turn into each language's `strings.xml`. `plugins/with-peerchat-background.js` puts the English in the default one.
- Android's list of languages for its per-app setting is `res/xml/locales_config.xml`, written by `plugins/with-app-languages.js` from `app/i18n/native/languages.json`.

## Not translated

- Websites, and the pages of the built-in web apps loaded into a WebView (the P2PMD editor and the PeerTunes player).
- Messages that come from the backend.
- The privacy policy, the terms and the open-source licenses.
- A PeerChat report's email subject and field labels, for the people who read every report. What the person reporting sees is translated.
- Emoji search, which matches English words.
- The Holesail screen, which only development builds have.

Dates and times follow the phone's region, as before.

## Adding text

Write it with `t()` in English, run `node scripts/i18n.mjs --write`, and add its translation to every catalog. `node scripts/i18n.mjs --check` lists what is still missing.

## Adding a language

Add it to `LANGUAGES` with its code (a BCP 47 tag iOS and Android both take), English and native names and direction, and its plural categories and rule to `app/i18n/plural.mjs`. Then run `node scripts/i18n.mjs --write`, add `app/i18n/locales/<code>.json`, and add the language to `locales` in `app.json`.
