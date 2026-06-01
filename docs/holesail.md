# Holesail runtime (mobile)

PeerSky Mobile includes a minimal Holesail runtime inside the Bare worklet for protocol-level testing and integration. This document explains what is included, how the app communicates with the runtime, and how to run a practical smoke test.

> Scope: this is Holesail protocol/runtime integration only. It is not the final p2pmd app UX.

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

4. Open the app, switch to `Holesail` tab, then test:
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

- `backend/backend.mjs` - Bare entry and shutdown lifecycle
- `backend/rpc/commands.mjs` - RPC command IDs
- `backend/rpc/router.mjs` - RPC command routing
- `backend/holesail/session.mjs` - Holesail session lifecycle + validation + transition guard
- `app/index.tsx` - RN runtime test UI (Holesail tab)

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

> [!IMPORTANT]
> This Holesail runtime is currently intended for protocol verification and staged integration work. Keep production hardening, automated tests, and final UX/p2pmd wiring as follow-up milestones.
