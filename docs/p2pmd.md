# P2PMD (mobile)

PeerSky Mobile includes a P2PMD implementation that runs from the Bare worklet and exposes a local HTTP editor server. The goal is to support collaborative Markdown editing over Holesail while keeping the mobile app shell thin.

This mirrors the desktop direction at the protocol level: local HTTP endpoints expose document state, peers connect through an event stream, and Yjs carries collaborative document updates.

## Features

- Start a local P2PMD HTTP server on loopback.
- Create or join a Holesail-backed room.
- Serve the mobile Markdown editor through WebView.
- Store document content in a Yjs document.
- Accept full document writes and incremental Yjs updates.
- Broadcast document updates over SSE.
- Track peer presence and non-host peer count.
- Track line attribution metadata used by gutter marks.
- Render Markdown preview with raw HTML disabled.
- Rewrite Hyper image URLs in preview through the local Hyper file proxy.

## Main endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/` or `/index.html` | `GET` | Mobile editor page |
| `/status` | `GET` | Runtime status and peer list |
| `/doc` | `GET` | Current document state |
| `/doc` | `POST` | Full document update |
| `/doc/yjsstate` | `GET` | Full Yjs state for initial sync |
| `/doc/update` | `POST` | Incremental Yjs update |
| `/presence` | `POST` | Peer cursor and line attribution metadata |
| `/events` | `GET` | SSE stream for peers, document updates, and peer list |
| `/preview` | `POST` | Markdown-to-HTML preview rendering |
| `/hyper/file` | `GET` | Read Hyper file content for preview assets |
| `/hyper/image` | `POST` | Upload image content to Hyper |

## Runtime flow

1. React Native sends an RPC command to create or join a P2PMD room.
2. The Bare backend starts the local P2PMD HTTP server on `127.0.0.1`.
3. Holesail exposes or connects the local server through an `hs://` key.
4. The React Native WebView opens the local editor URL.
5. The editor loads initial state from `/doc/yjsstate`.
6. Local edits are sent to `/doc/update` as Yjs updates.
7. Remote updates arrive through `/events` and are applied in the editor.
8. Presence updates keep peer counts and gutter attribution metadata in sync.

## Safety notes

- The local server binds to loopback only.
- Android cleartext HTTP is scoped to localhost/127.0.0.1 through network security config.
- Raw HTML is disabled in Markdown preview because preview HTML is injected into the page.
- Document and update sizes are bounded to reduce memory abuse risk.
- Holesail server/client hosts are restricted to loopback so the app does not become a LAN relay.

## Test coverage

P2PMD coverage lives under `test/protocol/`:

- `p2pmd-document.test.mjs` covers Yjs document state, update validation, full-state sync, and subscriber behavior.
- `p2pmd-http.test.mjs` covers the real HTTP endpoint contract with an injectable Node HTTP server.
- `p2pmd-peers.test.mjs` covers peer counting, disconnect pruning, and gutter line ownership.
- `p2pmd-preview.test.mjs` covers Markdown rendering and Hyper image URL rewriting.

The endpoint tests include desktop-inspired collaboration flows where peers disconnect, continue editing, and reconnect while document state is preserved.

