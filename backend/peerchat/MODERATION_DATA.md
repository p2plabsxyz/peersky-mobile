# PeerChat moderation data

`moderation-data.mjs` is generated from the
[MIT-licensed PeerChat desktop snapshot](https://github.com/p2plabsxyz/peerchat/tree/c7f07f753cfc963bf933e7cc848d6e437503848a)
pinned in `scripts/update-peerchat-moderation-data.mjs`. The adult-domain source
in that snapshot comes from the
[StevenBlack hosts project](https://github.com/StevenBlack/hosts); its source
header and license remain available in the pinned PeerChat snapshot.

Regenerate the file explicitly with:

```sh
npm run update:peerchat-moderation-data
```

The generated file is committed so normal mobile builds are reproducible and
do not require network access.
