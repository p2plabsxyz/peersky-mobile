// The phone draws QR codes with qr-creator, as the desktop's qr-code elf
// does (app/settings/qr-elf.mjs), through a canvas that writes SVG paths.
// These draw what it wrote to pixels and have ZXing, the decoder the phone's
// own scanner uses, read the text back.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { before, describe, it } from 'node:test'

import { drawQrCode, QR_SIZE } from '../../app/settings/qr-elf.mjs'

const require = createRequire(import.meta.url)
let readBarcodes = null

before(async () => {
  // zxing-wasm comes with expo-camera. Its wasm is read from disk, so the
  // test needs no network.
  const reader = require.resolve('zxing-wasm/reader')
  const zxing = await import(reader)
  const wasm = readFileSync(reader.replace(/dist\/cjs\/reader\/index\.js$/, 'dist/reader/zxing_reader.wasm'))
  await zxing.prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) }, fireImmediately: true })
  readBarcodes = zxing.readBarcodes
})

// The path commands qr-elf.mjs writes (M, L, A, h, v, Z) as closed outlines
// of straight edges, arcs cut into short lines.
function outlines (d) {
  const tokens = d.match(/[MLAhvZ]|-?\d+(?:\.\d+)?/g)
  const shapes = []
  let shape = null
  let x = 0
  let y = 0
  let i = 0
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    const command = tokens[i++]
    if (command === 'M') {
      x = num(); y = num()
      shape = [[x, y]]
      shapes.push(shape)
    } else if (command === 'L') {
      x = num(); y = num()
      shape.push([x, y])
    } else if (command === 'h') {
      x += num()
      shape.push([x, y])
    } else if (command === 'v') {
      y += num()
      shape.push([x, y])
    } else if (command === 'A') {
      const r = num(); num(); num(); num()
      const sweep = num()
      const ex = num()
      const ey = num()
      // The centre of a short arc of radius r from (x, y) to (ex, ey).
      const mx = (x + ex) / 2
      const my = (y + ey) / 2
      const dx = ex - x
      const dy = ey - y
      const half = Math.hypot(dx, dy) / 2
      const along = Math.sqrt(Math.max(0, r * r - half * half))
      const side = sweep ? 1 : -1
      const cx = mx - side * (dy / (2 * half)) * along
      const cy = my + side * (dx / (2 * half)) * along
      let a0 = Math.atan2(y - cy, x - cx)
      let a1 = Math.atan2(ey - cy, ex - cx)
      if (sweep && a1 < a0) a1 += 2 * Math.PI
      if (!sweep && a1 > a0) a1 -= 2 * Math.PI
      for (let step = 1; step <= 8; step++) {
        const a = a0 + ((a1 - a0) * step) / 8
        shape.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
      }
      x = ex; y = ey
      a0 = a1
    } else if (command !== 'Z') {
      throw new Error(`Unexpected path command ${command}`)
    }
  }
  return shapes
}

// Every layer filled as a canvas fills it (nonzero), one sample per pixel,
// with a white quiet zone of a tenth of the size around it.
function pixels ({ size, layers }, scale) {
  const inner = Math.round(size * scale)
  const quiet = Math.round(inner / 10)
  const width = inner + 2 * quiet
  const data = new Uint8ClampedArray(width * width * 4).fill(255)
  for (const layer of layers) {
    const value = layer.fill === '#000000' ? 0 : 255
    const edges = []
    for (const shape of outlines(layer.d)) {
      for (let k = 0; k < shape.length; k++) {
        const [x0, y0] = shape[k]
        const [x1, y1] = shape[(k + 1) % shape.length]
        if (y0 !== y1) edges.push([x0 * scale, y0 * scale, x1 * scale, y1 * scale])
      }
    }
    for (let row = 0; row < inner; row++) {
      const sy = row + 0.5
      const crossings = []
      for (const [x0, y0, x1, y1] of edges) {
        if ((sy >= y0 && sy < y1) || (sy >= y1 && sy < y0)) {
          crossings.push([x0 + ((sy - y0) * (x1 - x0)) / (y1 - y0), y1 > y0 ? 1 : -1])
        }
      }
      crossings.sort((a, b) => a[0] - b[0])
      let winding = 0
      for (let c = 0; c < crossings.length - 1; c++) {
        winding += crossings[c][1]
        if (winding === 0) continue
        const from = Math.max(0, Math.ceil(crossings[c][0] - 0.5))
        const to = Math.min(inner - 1, Math.floor(crossings[c + 1][0] - 0.5))
        for (let col = from; col <= to; col++) {
          const at = ((row + quiet) * width + col + quiet) * 4
          data[at] = data[at + 1] = data[at + 2] = value
        }
      }
    }
  }
  return { data, width, height: width, colorSpace: 'srgb' }
}

async function readBack (text) {
  const code = drawQrCode(text)
  const found = await readBarcodes(pixels(code, 0.4), { formats: ['QRCode'], tryHarder: true })
  return found.map((result) => result.text)
}

describe('QR codes drawn with qr-creator, as the desktop elf draws them', () => {
  it('reads back a pairing code and a transfer link, as the desktop shows them', async () => {
    const pairing = `peersky-identity:${'3f'.repeat(32)}?deviceType=mobile&nonce=${'a1'.repeat(16)}&chat=1&notes=1`
    const link = `hyper://${'pbsxn8e7yqkr3cm4ow9t5nhbd6zgu1fa'.repeat(2).slice(0, 52)}/backup.zip`
    assert.deepEqual(await readBack(pairing), [pairing])
    assert.deepEqual(await readBack(link), [link])
  })

  it('reads back a PeerChat invite link', async () => {
    const invite = `https://peersky.p2plabs.xyz/chat#room=${'7c'.repeat(32)}&name=Trip%20planning`
    assert.deepEqual(await readBack(invite), [invite])
  })

  it('draws as the elf does: white behind, dots rounded, at its size', () => {
    const code = drawQrCode('hello')
    assert.equal(code.size, QR_SIZE)
    assert.deepEqual(code.layers[0], { fill: '#ffffff', d: `M0 0h${QR_SIZE}v${QR_SIZE}h-${QR_SIZE}Z` })
    assert.equal(code.layers[1].fill, '#000000')
    assert.match(code.layers[1].d, /A\d/)
    // The same text draws the same code.
    assert.deepEqual(drawQrCode('hello'), code)
  })

  it('draws a dot with no neighbours as a circle, as the elf does', () => {
    const code = drawQrCode(`peersky-identity:${'3f'.repeat(32)}?deviceType=mobile`)
    const lone = code.layers[1].d.split(/(?=M)/).filter((part) => (part.match(/A/g) || []).length === 4)
    assert.ok(lone.length > 0)
    for (const part of lone) {
      const [points] = outlines(part)
      const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length
      const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length
      const r = Number(part.match(/A(\d+(?:\.\d+)?)/)[1])
      for (const [x, y] of points) assert.ok(Math.abs(Math.hypot(x - cx, y - cy) - r) < 1.5, part)
    }
  })

  it('says so when the text is too long for any QR code, and leaves no canvas behind', () => {
    assert.throws(() => drawQrCode('x'.repeat(8000)), /Too long for a QR code/)
    assert.equal(typeof globalThis.HTMLCanvasElement, 'undefined')
  })
})
