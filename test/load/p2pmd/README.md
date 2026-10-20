# P2PMD load test

Puts one P2PMD note under load on this machine: the phone's own P2PMD host
serving many simulated editors, some of them typing, and prints what that cost.
It is not part of `npm test`.

```bash
npm run test:load:p2pmd
npm run test:load:p2pmd -- --people 20 --typing 3 --seconds 20
npm run test:load:p2pmd -- --lan
```

## Options

| Option | Default | |
|---|---|---|
| `--people` | 100 | editors in the note |
| `--typing` | 10 | how many of them type |
| `--seconds` | 60 | how long they type |
| `--editor` | `desktop` | which P2PMD editor they act like: `desktop` or `phone` |
| `--lan` | off | each editor a device of its own, reaching the note through a tunnel on the local network, as with no internet |
| `--join-every` | 20 | one person joins every this many milliseconds, so 100 take two seconds |
| `--out` | | also write the results to a JSON file |

## What it runs

- **The host:** `createP2pmdHttpServer({ httpImpl: http, token })` from
  `backend/p2pmd/server.mjs`, on Node's `http` and bound to `127.0.0.1`, the
  way `test/protocol/p2pmd-http.test.mjs` runs it. Each request gets the
  server's token, as the note's tunnel would give it to someone who joined
  with the note's address. The host has a process of its own, so its CPU and
  memory are its own.
- **The note:** about 60 lines of team notes that three people wrote earlier,
  with each line's author kept in the note as P2PMD keeps them, and a line for
  each typist.
- **The editors:** 25 to a process. Each makes the requests its editor makes to
  open a note, opens `/events`, and keeps its own Yjs copy of the note from
  the host's `yjsupdate` events. One whose join fails presses Join again a
  second later, up to three times, and the results say how many had to.
- **The typists:** each types on its own line, a character every 100 ms, and
  sends the Yjs change to `/doc/update`. Every tenth edit is a token, timed
  until every other editor has it.

- **With `--lan`:** the host also puts the note on a local network instance
  with the phone's own `TunnelHost`, as the phone does with no internet. Each
  editor is a device of its own, with its own instance
  (`@p2plabs/hyperdht-mdns`, found over real mDNS) that is up before anyone
  joins, and joins with the phone's own `TunnelGuest`, so its requests go
  through an encrypted tunnel of its own. `lan.mjs` has both, and is the
  checkout's own, as `host.mjs` is.

`--editor` picks the editor:

- `desktop`: the editor in the p2pmd repo (`p2p.js`), which PeerSky Desktop
  uses. With each edit it sends the authors of its own lines, and it sends
  presence to `/presence`, here every 220 ms.
- `phone`: the editor page in `backend/p2pmd/server.mjs`. With each edit it
  sends every line author it knows of. It sends no presence while typing, and
  applies what the host sends every 80 ms.

Both editors wait for a 100 ms pause before sending an edit, and the desktop
one for a 220 ms pause before sending presence, so someone typing without a
pause sends little presence. The typists here send both on a steady beat,
which is more.

## What it prints

| Row | What it is |
|---|---|
| People connected | how many the host counts in `/status` |
| Joins that needed another try | shown only when some did |
| Edits sent | `/doc/update` requests while typing, and how many the host refused |
| Every editor ended with the host's text | each editor's copy against `/doc`, once typing stops |
| Time until every editor saw an edit | from a typist sending a token until the last other editor had it |
| Data in per editor | every event from `/events` and every reply to its own requests |
| Out from the host | everything the host wrote on every connection, headers too |
| Host CPU and memory | the host process's CPU time and RSS while people type |
| Note on the host | the note's text and its Yjs state, from `/doc` and `/doc/yjsstate` |

Then the data in per editor by kind of event, and a line for anything to look
at: the host's CPU growing while people typed, the host or the editor
processes running late, or streams dropping. 1 KB is 1000 bytes. With
`--out` the JSON file also has the host's load second by second, the joining,
and how long the typists' requests took. The run exits with 1 when an editor
ended with other text, an edit never reached everyone, the host left edits
unanswered, or a stream dropped.

## What it never does

- Without `--lan`, everything binds to and connects to `127.0.0.1`.
  Holesail, Hyperswarm and the DHT are never started: the editors reach the
  host directly.
- With `--lan`, the devices find each other over mDNS on this machine's
  network, and their tunnels run over UDP on it. Nothing goes to the
  internet: the DHT for it is given nobody to bootstrap from.
- The host keeps the note in memory and writes nothing to disk.

## What it cannot tell

- How a phone copes: the host runs under Node on this machine, not in Bare on
  a phone, and on Node's `http` instead of `bare-http1`.
- What a real network adds: delay, bandwidth, dropped connections. With
  `--lan` the tunnels' encryption is in the host's CPU, but every device is
  on this one machine.
- What the editors spend drawing the note, the line gutter and the preview.
- People joining, leaving or reconnecting while others type, and typists
  adding lines, which moves the line numbers of everyone below.
- The room snapshot a phone saves while hosting: under Node there is no
  storage path, so none is saved.

PeerSky Desktop has the same `run.mjs` and `editors.mjs` in `test/load/p2pmd`,
with its own host.

The numbers from the last runs, at the defaults on both hosts with both
editors, are in [docs/p2pmd.md](../../../docs/p2pmd.md#how-many-people-a-note-holds).
