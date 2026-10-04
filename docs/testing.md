# Testing guide

PeerSky Mobile uses Node's built-in test runner for protocol and platform checks. The default test command is intentionally deterministic: it covers runtime behavior, validation, endpoint contracts, and bundle generation without requiring a device or public network tunnel.

## Running tests

```bash
npm test
npm run test:runtime
npm run test:bundle
npm run test:holesail:live
npm run lint
npx tsc --noEmit
```

## Test layout

```text
test/
  protocol/      Protocol/runtime behavior tests
  platform/      Android/iOS/runtime configuration tests
  integration/   Slower tests that use real network/runtime behavior
  fixtures/      Child-process helpers used by integration tests
```

## Test suites

### Protocol tests

Protocol tests live in `test/protocol/` and cover behavior that should stay stable across the mobile app shell.

- `hyper-url.test.mjs` validates `hyper://` parsing, malformed URL handling, and path traversal rejection.
- `holesail-session.test.mjs` validates Holesail ports, keys, loopback host restrictions, and safe failure behavior.
- `p2pmd-document.test.mjs` validates document state, Yjs update application, full-state sync, size limits, and subscribers.
- `p2pmd-http.test.mjs` starts a real HTTP server with the shared P2PMD request handler and checks `/status`, `/doc`, `/doc/update`, `/doc/yjsstate`, `/presence`, and `/events`, and that pages on other origins are turned away.
- `p2pmd-peers.test.mjs` validates peer count, peer pruning, and line ownership used by gutter marks.
- `p2pmd-preview.test.mjs` validates Markdown preview rendering, raw HTML escaping, and Hyper image URL rewriting.
- `phone-backup.test.mjs` backs a real Hyper store up and restores it into a second phone folder, then opens it the ordinary way. It also covers wrong passphrases, damaged and cut-off files, path traversal, and transfers meant for another phone.
- `link-device.test.mjs` restores desktop transfers built the way PeerSky Desktop builds them (`test/fixtures/desktop-transfer.mjs`), including tampered, expired and oversized ones.
- `phone-transfer-publish.test.mjs` puts a transfer on a drive, replicates it to a second store, and clears it.
- `link-device-safety.test.mjs` covers what keeps a backup or restore safe while it runs: the stores held shut, one job at a time, an interrupted restore undone on the next start, and streams that fail.

### Platform tests

Platform tests live in `test/platform/` and check mobile runtime configuration.

- Android cleartext traffic is scoped to loopback through network security config.
- iOS allows local networking without enabling arbitrary HTTP loads.
- Bare bundling is wired into native Android/iOS runs.
- Bare import aliases stay explicit.
- Backend shutdown paths log cleanup failures instead of silently swallowing them.
- Content blocking converts and wires the filter lists on both platforms. `cover-your-tracks.test.mjs` replays the two tracker frames [Cover Your Tracks](https://coveryourtracks.eff.org/) loads against the shipped lists, and fails unless both of its blocking questions would answer Yes.

### Live integration tests

The live Holesail test is separate from `npm test` because it uses real Holesail networking and can be slower or environment-dependent.

```bash
npm run test:holesail:live
```

This test starts:

1. A real local HTTP origin server.
2. A Holesail live/server session in one child process.
3. A Holesail client session in another child process.
4. A fetch through the client proxy to prove TCP traffic passes through the tunnel.

The child processes are needed because the mobile Holesail runtime keeps one active session per runtime, matching the app design.

## Why Node HTTP is used in P2PMD endpoint tests

Production mobile uses `bare-http1`. Tests inject Node's `node:http` into `createP2pmdHttpServer({ httpImpl })` so the same P2PMD route handler can be tested on the development machine.

The socket implementation changes, but the request handling logic is shared:

- document endpoints
- Yjs update endpoints
- activity endpoint
- presence endpoint
- SSE event stream endpoint
- validation and error responses

This keeps endpoint tests fast and deterministic while preserving production behavior boundaries.

## Manual smoke tests still needed

These automated tests do not replace real device smoke testing. Before raising browser or P2PMD UI PRs, still test:

- Android release APK starts without Metro.
- Hyper URL fetch works on device.
- P2PMD room creation loads the WebView editor.
- P2PMD mobile-to-desktop and desktop-to-mobile sync works.
- Gutter marks appear visually in the mobile editor.
- Holesail join key can be used from another device/process.


