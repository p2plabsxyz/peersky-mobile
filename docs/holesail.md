# Holesail runtime (mobile)

PeerSky Mobile runs a Holesail tunnel inside the Bare worklet. P2PMD notes travel over it: the phone hosting a note runs a live session in front of its room server, and each guest runs a client session. This page covers the tunnel itself; [P2PMD](p2pmd.md) covers the editor.

The desktop uses the Holesail package. Its license (AGPL) cannot ship in an App Store app, so the phone speaks the same protocol through its own code, `backend/holesail/tunnel.mjs`, on hyperdht (MIT). The two meet in both directions:

- A note address is `hs://`, four flag characters, then the key. A first flag of `s` means private.
- Private: host and guests make the same key pair from the sha256 of the key, and the host lets in only connections made with that key pair.
- Public: the key is the host's public key in z32. The host makes its key pair from the sha256 of a seed only it keeps.
- The host keeps a signed record under its public key, `{ host, udp, port }`, so a guest can listen on the same port. It puts it back every 50 minutes.
- Each connection carries the bytes of one TCP connection to the host's server. UDP tunnels are not carried; notes never used them.

`test/protocol/note-tunnel.test.mjs` checks the keys against Holesail's own code and runs both directions against Holesail's classes on a local test network. `npm run test:holesail:live` does the same over the live network.

The runtime check page at `peersky://holesail/` exists in development builds
only. It is not listed on `peersky://p2p`, and a release build does not answer
the address.

## What is implemented

- Start Holesail in live/server mode
- Connect Holesail in client mode
- Query active Holesail session status
- Stop the active Holesail session
- Validate ports, keys, and hosts before creating sessions
- Serialize session transitions to prevent race conditions from concurrent RPC calls

## Quick usage (manual smoke test)

1. Install dependencies:

   npm install

2. Rebuild Bare bundle:

   npm run bundle:bare

3. Launch app:

   npm run android
   # or
   npm run ios

4. In a development build, open `peersky://holesail/`, then test:
   - **Start Live** with default host/port (`127.0.0.1`, `8989`)
   - **Status** should report running session and mode
   - **Stop** should report stopped session

5. Validation checks:
   - Host `0.0.0.0` should be rejected
   - Host `192.168.1.10` should be rejected
   - Loopback hosts should be accepted (`127.0.0.1`, `::1`, `localhost`)

## How it works (high level)

1. React Native starts Bare worklet using `react-native-bare-kit`.
2. RN creates a `bare-rpc` client over worklet IPC.
3. RN sends Holesail RPC commands (start/connect/status/stop).
4. Backend router dispatches to `backend/holesail/session.mjs`.
5. Session module opens and closes tunnels (`tunnel.mjs`) and returns structured JSON responses.

## Architecture (key files)

- `backend/main.mjs` - worklet startup and shutdown
- `backend/rpc/commands.mjs` - RPC command IDs
- `backend/rpc/router.mjs` - RPC command routing
- `backend/holesail/session.mjs` - Holesail session lifecycle + validation + transition guard
- `backend/holesail/tunnel.mjs` - the tunnel: hosting, joining, keys and the host's record
- `backend/holesail/lan.mjs` - the same note on the local network, for when there is no internet
- `app/index.tsx` - the runtime check page, development builds only

## RPC / API contract

| Command | Request payload | Response |
|---------|-----------------|----------|
| `RPC_HOLESAIL_START_LIVE` | `{ port?, host?, connector?, secure? }` | `{ ok: true, mode: 'server', info }` or `{ ok: false, error }` |
| `RPC_HOLESAIL_CONNECT` | `{ key, port?, host?, anyPort?, hostPort? }` | `{ ok: true, mode: 'client', info }` or `{ ok: false, error }` |
| `RPC_HOLESAIL_STATUS` | `{}` | `{ ok: true, running, mode, info? }` |
| `RPC_HOLESAIL_STOP` | `{}` | `{ ok: true, running: false, mode: null }` or `{ ok: false, error }` |

## Security and validation notes

- Host is restricted to loopback in both live and connect flows:
  - `127.0.0.1`
  - `::1`
  - `localhost`
- This avoids exposing Holesail forwarding/bind to LAN interfaces (for example `0.0.0.0`, `192.168.x.x`).
- IPv6 validation is stricter than broad hex+colon matching to avoid malformed host acceptance.

## With no internet

A note's host is found on the public HyperDHT, which is on the internet, so with the router's cable out a note did not open even with both devices on the same Wi-Fi, and a note could not even be hosted, since the host's record could not be put. Now (`lan.mjs`):

- The host also listens on the LAN DHT that Hyperdrive and PeerChat already use over Wi-Fi (`getLANInstance()` in `backend/hyper/lan-discovery.mjs`), under the note's own key pair, and says over mDNS that it has a topic made from the note's key. Only someone who has the address can work out the topic, and a private note still lets in only the key its address carries.
- A device joining looks on the local network first (2.5 seconds, under a second when no other PeerSky is around) and uses it if the host answers there within 3 seconds. Otherwise it goes to the internet as before.
- With no internet, hosting goes on after 3 seconds with the note on the local network alone, and the record is tried again every minute until the internet answers.
- The topic is the desktop's (`p2pmd-lan.js` there), so a phone and a desktop find each other too. The local server's token works the same over both.

`info` says which: `lan` is true when the note is on, or was joined over, the local network, and a host's `internet` is true once its record is on the internet DHT. Tests: `test/protocol/note-lan.test.mjs`.

## Concurrency and lifecycle notes

- Session transitions are serialized via a transition guard.
- This prevents overlapping `start/connect/stop` calls from leaking or racing multiple sessions.
- On startup/connect failures, partial session state is cleared before bubbling the error.
