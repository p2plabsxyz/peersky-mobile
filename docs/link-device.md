# Link Device & Identity Transfer

PeerSky Mobile supports secure cross-device identity transfer from PeerSky Desktop. This document explains the architecture, security primitives, RPC methods, QR workflow, and platform lifecycle.

## Overview

Identity Transfer allows users to migrate their browser identity, P2PMD files, tabs, history, and peer keys from PeerSky Desktop to PeerSky Mobile without sending unencrypted data over public servers.

The transfer uses a bidirectional dual-QR workflow without any manual typing:
1. **Mobile Public Key Announcement**: Mobile generates a Curve25519 key pair and displays its public key as a QR code.
2. **Desktop Encryption & Upload**: Desktop uses a webcam scanner (`jsQR`) to scan the mobile QR code, encrypts the identity backup archive specifically for the target mobile device using Sodium sealed boxes and AES-256-GCM, uploads the archive to a temporary Hyperdrive, and displays the resulting `hyper://...` transfer URL as a QR code.
3. **Mobile Download & Restoration**: Mobile scans the desktop transfer QR code with `expo-camera`, downloads the archive via `hypercore-fetch`, decrypts it locally, maps `tabs.json` to `browser-tabs.json`, updates storage, and cleanly restarts the app process.

## Security Architecture

- **Public Key Encryption**: Sodium `crypto_box_seal` encrypts a random 32-byte content key to the target mobile device's Curve25519 public key.
- **Payload Encryption**: AES-256-GCM encrypts the backup archive payload using the random content key.
- **Source Authentication**: Desktop signs the transfer manifest metadata using its Ed25519 signing key (`crypto_sign_detached`). Mobile verifies the signature before processing.
- **Expiration & SHA-256 Checksum**: Transfers expire automatically and manifest payloads are validated against SHA-256 hashes.

## Key Files

- `backend/backup/device-keys.mjs` — keypair generation and storage in `device-key.json`
- `backend/backup/identity-transfer.mjs` — decryption, checksum, and signature verification
- `backend/backup/restore.mjs` — extraction, storage overwrite, and file mapping (`tabs.json` -> `browser-tabs.json`)
- `backend/backup/inspect.mjs` — storage inspection helper for developer debugging
- `app/settings/qrcode-matrix.mjs` — pure JavaScript offline QR code matrix generator
- `app/settings/QrCodeView.tsx` — React Native component to render QR code matrices on screen
- `app/settings/SettingsScreen.tsx` — UI harness with camera scanner modal and device key display

## RPC API

| Command | Payload | Response |
|---|---|---|
| `RPC_IDENTITY_GET_KEY` | `{}` | `{ ok: true, encryptionPublicKey }` |
| `RPC_IDENTITY_RESTORE_FROM_HYPER` | `{ hyperUrl: string }` | `{ ok: true, restoredFiles: number, requiresRestart: true }` |
| `RPC_IDENTITY_INSPECT_STORAGE` | `{}` | `{ ok: true, path, files: Array<{ name, type, size, mtime, content }> }` |

## Verification and Testing

Run protocol unit tests for identity transfer:

```bash
npm run test:runtime
```

Test suite file: `test/protocol/link-device.test.mjs`.
