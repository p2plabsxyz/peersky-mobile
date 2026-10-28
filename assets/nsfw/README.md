# Picture screening models

PeerChat screens pictures on the phone before they are sent and when they
arrive. These files run in a hidden WebView, so screening needs no network.

- `nsfwjs.txt` is the browser build of NSFWJS 4.4.0
  (`dist/browser/nsfwjs.min.js` in the npm package `nsfwjs@4.4.0`). It includes
  TensorFlow.js 4.22.0.
- `model-data.txt` is the MobileNetV2 model that ships with NSFWJS 4.4.0
  (`dist/models/mobilenet_v2`), with its `model.json` and weights written out as
  script globals.

Both were taken from the npm package by PeerChat (p2plabsxyz/peerchat, commit
4cb439c), so the desktop and the phone run the same classifier.

A second model checks for gore and graphic violence:

- `safety-model.txt` is PeerChat's `lib/safety-model.js`, the forward pass of
  image-safety-classifier-s (SwiftFormer-S) in TensorFlow.js.
- `safety-data.txt` is PeerChat's `lib/safety-model/manifest.json` and
  `weights`, written out as script globals (`__SAFETY_MANIFEST` and
  `__SAFETY_WEIGHTS_B64`). PeerChat's `lib/safety-model/README.md` says how the
  weights were made from the original and how close they stay to it.
- `tf-core.txt` is `dist/tf-core.min.js` from the npm package
  `@tensorflow/tfjs-core@4.22.0`, the same TensorFlow.js NSFWJS brings, without
  backends. Loaded after NSFWJS, it runs on NSFWJS's engine and backends.

To refresh `safety-data.txt` after PeerChat's weights change, from this folder:

```sh
node -e "const fs=require('fs');const d='../../../peerchat/lib/safety-model/';fs.writeFileSync('safety-data.txt','window.__SAFETY_MANIFEST='+fs.readFileSync(d+'manifest.json','utf8').trim()+';\nwindow.__SAFETY_WEIGHTS_B64=\"'+fs.readFileSync(d+'weights').toString('base64')+'\";\n')"
```

## Licenses

- NSFWJS: MIT License, Copyright (c) 2019 Infinite Red, Inc.
  https://github.com/infinitered/nsfwjs
- The model: MIT License, Copyright (c) 2020 The nsfw_model Developers.
  https://github.com/GantMan/nsfw_model
- TensorFlow.js: Apache License 2.0, Copyright Google LLC.
  https://github.com/tensorflow/tfjs
- image-safety-classifier-s: MIT License, Owen Elliott.
  https://huggingface.co/OwenElliott/image-safety-classifier-s
- SwiftFormer, the model it was trained from: Apache License 2.0, Abdelrahman
  Shaker and the SwiftFormer authors. https://github.com/Amshaker/SwiftFormer

The full texts are in the app, under Settings, About, Open-source licenses.
