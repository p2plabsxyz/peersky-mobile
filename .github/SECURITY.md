# Security Policy

## Supported versions

Security fixes land in the latest release only: on the App Store, on Google Play, and as the APK on GitHub releases. Keeping automatic app updates on is the best protection.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/p2plabsxyz/peersky-mobile/security/advisories/new), or by email to contact@p2plabs.xyz. Do not open a public issue, pull request or discussion for a security problem.

Include what you can of:

- the PeerSky version, the device and the iOS or Android version
- the steps, or a minimal page, drive or room, that reproduce it
- what an attacker gains, for example reading someone's chats or writing to their drives

We will reply, keep you updated while we work on a fix, and credit you in the release notes unless you would rather stay anonymous. Please give us a chance to ship the fix before disclosing the issue publicly.

### Scope

In scope:

- the PeerSky app for iPhone, iPad and Android, and its Bare backend
- how it loads `http:`, `https:` and `hyper:` addresses, and the `peersky:` and `hs:` links it accepts
- the built-in apps: PeerChat, P2PMD, PeerTunes and Hyperdrive
- Link Device, backup files and restore
- the local servers the app runs on `127.0.0.1`

Out of scope: third-party websites, and upstream projects such as React Native, Expo, Bare, the Holepunch libraries and the system WebViews. Report those upstream, and tell us as well if PeerSky needs a change.

## Security model

- Web pages run in the system WebView (WKWebView on iOS, Android System WebView). They reach the app only through a small bridge, and every bridge message carries a per-tab token the bridge takes before any page script runs.
- `hyper://` pages:
  - Only a `hyper://` page may use the Hyper fetch bridge, and only while it is still on its own site.
  - A page reads public drives. It cannot read a private or this-device-only drive that is not its own.
  - Writing asks once per site (**Publishing from sites** in Settings, Permissions). A page's named drives get a prefix of its own, so it never reaches the app's drives by name, and it writes only to drives it created.
  - Media links to the local asset server are signed one address at a time, so a page can fetch what it was handed and nothing else.
  - `hyper://` never loads in a frame.
- The local servers (P2PMD rooms, PeerTunes, Hyper assets) bind `127.0.0.1` and answer only their own origin, which rules out other local servers too. The one other origin is desktop P2PMD (`peersky://p2p`) on a P2PMD room. Drive files from the asset server are sandboxed, so an HTML file cannot run on a loopback origin.
- The built-in apps:
  - The P2PMD editor runs only the app's own code: yjs ships inside the page, nothing loads in its place, links open in a browser tab, and it publishes only with a nonce the app hands over when you tap Publish. A phone joining a note listens on a port it picks itself.
  - The PeerTunes WebView stays on its own origin.
- PeerChat:
  - Messages and attachments are end to end encrypted with the room's key. A room opens to a peer only after it proves it holds the key, with an HMAC over the connection's handshake, and the key never crosses the wire. A direct message's key is sealed to the other person's public key.
  - Invite links ask before they join a room or send a request. Blocking someone hides everything they send, everywhere. Reports never include a room key.
- Links to other apps (`mailto:`, `tel:`, `sms:` and `geo:`) open only after a confirmation. `javascript:`, `data:`, `file:`, `intent:` and `content:` are refused.
- A download a page starts waits for a yes. A downloaded APK opens in the system's Downloads: PeerSky does not hold the permission to install apps.
- Keys and chats leave the phone only through Link Device (sealed to the receiving device, after both screens show the same six characters) or a backup file (Argon2id and an authenticated stream cipher, under a passphrase of at least 12 characters). iCloud, computer and Google backups and Android's phone-to-phone copy leave them out.
- Android allows cleartext HTTP to `localhost` and `127.0.0.1` only. On iOS, App Transport Security allows local networking only.

## Design trade-offs

These follow from how PeerSky works rather than being open bugs:

- Content published to a public Hyper drive is public. Joining a swarm or a PeerChat room shows your IP address to its peers, and one key identifies this device for browsing, PeerChat and nearby discovery.
- A PeerChat room key never rotates, so someone removed from a room still holds it. When a member syncs past messages to you, that member is trusted to say who wrote each one. Who made a room is learned the first time it is seen, except for P2P Republic, whose maker is pinned in the app.
- Keys sit in the app's private storage rather than the Keychain or Android Keystore, so anyone with control of an unlocked, rooted or jailbroken device can read them.
- Any app on an Android phone can connect to the loopback ports. The checks above stop web pages, not native apps, so another app that finds the port of an open P2PMD note can read and edit it.
- A link preview is fetched by the sender's phone, so the linked site sees the sender's IP address.

## Security review

In October 2026 the codebase went through an AI-assisted security review with Claude Opus 5.5, Anthropic's model, running in Claude Code at maximum reasoning effort. Findings were checked against the code and, where it mattered, reproduced before anything was changed.

Covered: the WebView bridges and injected scripts, the Hyper fetch path and asset server, every local server, the built-in apps, PeerChat's protocol, Link Device and backups, deep links, downloads, Android and iOS configuration, and a dependency audit.

Fixed as a result:

- Any `hyper://` page could create and overwrite files in the user's own drives without asking, including the drive P2PMD publishes from, and any website or ad could send a tab to such a page.
- A `hyper://` page could read the user's private drives.
- Whoever hosted a P2PMD note chose the script the editor ran next to the app's bridge.
- The P2PMD room server answered every origin, so any page that found its port could read and rewrite an open note.
- A page could read the bridge token by replacing `JSON.stringify`, and forge print and media requests.
- A one-character escaping slip had stopped every script the browser injects before a page loads from running at all.
- Invite links joined rooms and sent message requests without asking, and reports emailed the room key.
- Keys, chats and P2P stores went into iCloud, Google and phone-to-phone backups.
- Downloads started without asking, APKs went straight to the installer, and the app declared install, storage and overlay permissions it did not need.
- Shipped dependencies included vulnerable versions of `markdown-it` and `linkify-it`.

Not covered in depth: native modules and upstream libraries beyond advisory triage.

This review is not a certification, and it is not affiliated with or endorsed by Anthropic. Independent audits and reports are welcome.
