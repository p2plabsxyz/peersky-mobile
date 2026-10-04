# Picture screening model

PeerChat screens pictures on the phone before they are sent and when they
arrive. These two files run in a hidden WebView, so screening needs no network.

- `nsfwjs.txt` is the browser build of NSFWJS 4.4.0
  (`dist/browser/nsfwjs.min.js` in the npm package `nsfwjs@4.4.0`). It includes
  TensorFlow.js 4.22.0.
- `model-data.txt` is the MobileNetV2 model that ships with NSFWJS 4.4.0
  (`dist/models/mobilenet_v2`), with its `model.json` and weights written out as
  script globals.

Both were taken from the npm package by PeerChat (p2plabsxyz/peerchat, commit
4cb439c), so the desktop and the phone run the same classifier.

## Licenses

- NSFWJS: MIT License, Copyright (c) 2019 Infinite Red, Inc.
  https://github.com/infinitered/nsfwjs
- The model: MIT License, Copyright (c) 2020 The nsfw_model Developers.
  https://github.com/GantMan/nsfw_model
- TensorFlow.js: Apache License 2.0, Copyright Google LLC.
  https://github.com/tensorflow/tfjs

The full texts are in the app, under Settings, About, Open-source licenses.
