# Holesail runtime (mobile)

PeerSky Mobile runs Holesail inside the Bare worklet. P2PMD notes travel over it: the phone hosting a note runs a live session in front of its room server, and each guest runs a client session. This page covers the tunnel itself; [P2PMD](p2pmd.md) covers the editor.

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
5. Session module creates/stops Holesail instances and returns structured JSON responses.

## Architecture (key files)

- `backend/main.mjs` - worklet startup and shutdown
- `backend/rpc/commands.mjs` - RPC command IDs
- `backend/rpc/router.mjs` - RPC command routing
- `backend/holesail/session.mjs` - Holesail session lifecycle + validation + transition guard
- `app/index.tsx` - the runtime check page, development builds only

## RPC / API contract

| Command | Request payload | Response |
|---------|-----------------|----------|
| `RPC_HOLESAIL_START_LIVE` | `{ port?, host?, connector?, secure?, udp?, log? }` | `{ ok: true, mode: 'server', info }` or `{ ok: false, error }` |
| `RPC_HOLESAIL_CONNECT` | `{ key, port?, host?, udp?, log? }` | `{ ok: true, mode: 'client', info }` or `{ ok: false, error }` |
| `RPC_HOLESAIL_STATUS` | `{}` | `{ ok: true, running, mode, info? }` |
| `RPC_HOLESAIL_STOP` | `{}` | `{ ok: true, running: false, mode: null }` or `{ ok: false, error }` |

## Security and validation notes

- Host is restricted to loopback in both live and connect flows:
  - `127.0.0.1`
  - `::1`
  - `localhost`
- This avoids exposing Holesail forwarding/bind to LAN interfaces (for example `0.0.0.0`, `192.168.x.x`).
- IPv6 validation is stricter than broad hex+colon matching to avoid malformed host acceptance.

## Concurrency and lifecycle notes

- Session transitions are serialized via a transition guard.
- This prevents overlapping `start/connect/stop` calls from leaking or racing multiple sessions.
- On startup/connect failures, partial session state is cleared before bubbling the error.
