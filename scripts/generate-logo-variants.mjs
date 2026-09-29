/**
 * The bird for dark backgrounds.
 *
 * The artwork is drawn with black outlines, so on a dark screen the outline
 * disappears and the bird loses its shape. Putting white behind it, following
 * the bird rather than boxing it in, gives the outline something to sit
 * against and keeps the loose sticker look.
 *
 * The white is the bird's own silhouette grown outwards: a max filter over the
 * alpha channel, which is separable, so this is two cheap passes rather than
 * one expensive one.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const HALO = 20
const root = new URL('../', import.meta.url)
const bird = PNG.sync.read(readFileSync(new URL('assets/images/logo.png', root)))

const alpha = new Uint8Array(bird.width * bird.height)
for (let i = 0; i < alpha.length; i++) alpha[i] = bird.data[i * 4 + 3]

const grown = growVertically(growHorizontally(alpha, bird.width, bird.height), bird.width, bird.height)
const out = new PNG({ width: bird.width, height: bird.height })

for (let i = 0; i < alpha.length; i++) {
  const index = i * 4
  const birdAlpha = bird.data[index + 3] / 255
  const haloAlpha = grown[i] / 255
  // White underneath, the bird over it. Straight alpha over an opaque white
  // backing, so no premultiplying needed.
  const combined = haloAlpha + birdAlpha * (1 - haloAlpha)
  if (combined <= 0) {
    out.data[index] = out.data[index + 1] = out.data[index + 2] = out.data[index + 3] = 0
    continue
  }

  for (let channel = 0; channel < 3; channel++) {
    const over = bird.data[index + channel] * birdAlpha
    const under = 255 * haloAlpha * (1 - birdAlpha)
    out.data[index + channel] = Math.round((over + under) / combined)
  }
  out.data[index + 3] = Math.round(combined * 255)
}

writeFileSync(new URL('assets/images/logo-on-dark.png', root), PNG.sync.write(out))
console.log(`logo-on-dark.png ${out.width}x${out.height}, halo ${HALO}px`)

function growHorizontally (source, width, height) {
  const target = new Uint8Array(source.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let best = 0
      const from = Math.max(0, x - HALO)
      const to = Math.min(width - 1, x + HALO)
      for (let sx = from; sx <= to; sx++) {
        const value = source[row + sx]
        if (value > best) best = value
      }
      target[row + x] = best
    }
  }
  return target
}

function growVertically (source, width, height) {
  const target = new Uint8Array(source.length)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let best = 0
      const from = Math.max(0, y - HALO)
      const to = Math.min(height - 1, y + HALO)
      for (let sy = from; sy <= to; sy++) {
        const value = source[sy * width + x]
        if (value > best) best = value
      }
      target[y * width + x] = best
    }
  }
  return target
}
