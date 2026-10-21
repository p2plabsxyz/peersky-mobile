# PeerChat load test

Puts hundreds of devices in one PeerChat room on this machine, each running the
apps' own PeerChat code with its own key, Hyperswarm and DHT node, and measures
what a room that size does. It is not part of `npm test`: it takes a few minutes
and about 30 MB of memory a device.

```bash
npm run test:load:peerchat -- --devices 200
```

## What it runs

- Phones run `backend/peerchat/service.mjs` from this checkout.
- Desktops run PeerChat's `p2p.js` from a checkout next to this one
  (`../peerchat`, or `../peersky-browser/src/pages/p2p/peerchat`), or from the
  folder given with `--desktop`. Each desktop gets its own copy of every file in
  that folder, since `p2p.js` keeps its rooms and spam counters at module level.
  A tenth of the devices are desktops, unless `--desktops` says otherwise.
- Workers of 20 devices each, so the run uses every core.

## What it can never touch

- The DHT is a testnet bound to `127.0.0.1` with no public bootstrap nodes, and
  every device's DHT node binds to loopback and is checked to know only those
  nodes. Nothing leaves the machine.
- P2P Republic is never joined: no device goes through the onboarding that
  joins it, and joining its topic throws. The run reports both.
- Everything the devices keep goes in a temporary folder, deleted at the end
  (`--keep` keeps it).

## What it measures

1. **Joining:** every device joins at about 20 a second; how many get into the
   room, and how many connections each ends up with.
2. **Steady chat:** 2 messages a second for a minute (`--steady-rate`).
3. **A burst:** 50 messages at once.
4. **A busy minute:** 5 messages a second (`--busy-rate`).
5. **Catching up:** a tenth of the devices, up to 10, go away while 300
   messages are sent, then come back.
6. **A removal:** the room's creator removes somebody. How many devices learn of
   it, how many follow the room's new key, whether messages written after reach
   them, and that the person removed and a late joiner with the old key get
   none of them.

For each, how many messages reached how many devices, how long until the last
device had each one, and how many bytes each device took in per message. With
`--out file.json` it writes all of it to a file.

## Options

| Option | Default | |
|---|---|---|
| `--devices` | 50 | devices in the room |
| `--desktops` | a tenth | how many of them are desktops |
| `--desktop` | `../peerchat` | PeerChat checkout for the desktops |
| `--phone` | this checkout | PeerSky Mobile checkout for the phones |
| `--per-worker` | 20 | devices per process |
| `--phases` | `steady,burst,busy,catchup,removal` | which to run |
| `--steady-rate`, `--busy-rate` | 2, 5 | messages a second |
| `--out` | | write the results as JSON |
| `--keep` | | keep what the devices stored |

The numbers from the last runs are in [docs/peerchat.md](../../../docs/peerchat.md#tested-with-hundreds-of-devices).
PeerChat has the same files in `test/load`.

A thousand devices with real connections need more memory than one machine
usually has. `npm run test:scale:peerchat` runs a thousand phones with
connections made in memory instead, in about two minutes, and CI runs it on
every pull request (`test/scale/peerchat-thousand.test.mjs`).
