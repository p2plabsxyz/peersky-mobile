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

`node scripts/i18n.mjs` reads every file that imports these and refuses a call whose text is not one plain string literal, with its place. `--write` updates `app/i18n/strings.json` (every text and plural the app uses), `app/i18n/catalogs.ts` and the native files below. `--check` also says what each catalog lacks or gets wrong: a missing text, a plural form the language needs, placeholders that differ from the English, or a text nothing uses any more. `test/platform/i18n.test.mjs` fails on any of those, and when strings.json is out of date.

## The catalogs

One JSON file per language in `app/i18n/locales`, the English text to its translation. A plural is kept under its English `other`, as an object with a form for each category the language has. A catalog is required only when its language is picked, so the others are never parsed.

## Outside JavaScript

- iOS shows its own prompts for the camera, the local network, location, the microphone and saving to Photos from Info.plist. `app/i18n/native-strings.mjs` holds the English, which has to match `app.json`, and `--write` makes each language's copy in `app/i18n/native/<code>.json`. The `locales` in `app.json` turn those into `<code>.lproj/InfoPlist.strings`, which is also how iOS knows which languages to offer for PeerSky in its Settings.
- Android's list of languages for its per-app setting is `res/xml/locales_config.xml`, written by `plugins/with-app-languages.js` from `app/i18n/native/languages.json`.

## Not translated

Websites; the pages of the built-in web apps loaded into a WebView (the P2PMD editor and the PeerTunes player); messages that come from the backend; and the privacy policy, the terms and the open-source licenses.

## Adding text

Write it with `t()` in English, run `node scripts/i18n.mjs --write`, and add its translation to every catalog. `node scripts/i18n.mjs --check` lists what is still missing.

## Adding a language

Add it to `LANGUAGES` with its code (a BCP 47 tag iOS and Android both take), English and native names and direction, and its plural categories and rule to `app/i18n/plural.mjs`. Then run `node scripts/i18n.mjs --write`, add `app/i18n/locales/<code>.json`, and add the language to `locales` in `app.json`.
