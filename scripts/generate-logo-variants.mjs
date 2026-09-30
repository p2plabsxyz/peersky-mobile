/**
 * The badge: the bird in its circle, as one image.
 *
 * The app draws this itself where it can, from one bird and a colour, but the
 * launch image is a file the system shows before any of our code runs. This
 * generates that file from the same numbers, so the badge on the launch screen
 * and the badge the app draws a moment later are the same picture.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const SIZE = 1024
const BADGE = [0x67, 0xfc, 0xe7]
const RING = [0x14, 0x14, 0x14]
const RING_WIDTH = 20
const BIRD_SCALE = 0.76
const SAMPLES = 4

const root = new URL('../', import.meta.url)
const bird = PNG.sync.read(readFileSync(new URL('assets/images/logo.png', root)))
const out = new PNG({ width: SIZE, height: SIZE })

const centre = SIZE / 2
const outer = SIZE / 2
const inner = outer - RING_WIDTH
const birdSize = Math.round(SIZE * BIRD_SCALE)
const birdLeft = Math.round(centre - birdSize / 2)
const birdTop = Math.round(centre - birdSize / 2)

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const ringAlpha = coverage(x, y, outer)
    const fillAlpha = coverage(x, y, inner)
    const colour = blend(RING, BADGE, fillAlpha)
    setPixel(out, x, y, colour, ringAlpha)
  }
}

for (let y = 0; y < birdSize; y++) {
  for (let x = 0; x < birdSize; x++) {
    const sample = sampleBird((x + 0.5) / birdSize, (y + 0.5) / birdSize)
    if (sample[3] === 0) continue
    const [targetX, targetY] = [birdLeft + x, birdTop + y]
    const index = (targetY * SIZE + targetX) * 4
    const under = [out.data[index], out.data[index + 1], out.data[index + 2]]
    const alpha = sample[3] / 255
    setPixel(out, targetX, targetY, blend(under, sample, alpha), Math.max(out.data[index + 3] / 255, alpha))
  }
}

writeFileSync(new URL('assets/images/logo-badge.png', root), PNG.sync.write(out))
console.log(`logo-badge.png ${SIZE}x${SIZE}`)

// How much of this pixel falls inside the circle, supersampled so the edge is
// smooth rather than a staircase.
function coverage (x, y, radius) {
  const corner = Math.hypot(x + 0.5 - centre, y + 0.5 - centre)
  if (corner > radius + 1.5) return 0
  if (corner < radius - 1.5) return 1

  let hits = 0
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      if (Math.hypot(x + (sx + 0.5) / SAMPLES - centre, y + (sy + 0.5) / SAMPLES - centre) <= radius) hits++
    }
  }
  return hits / (SAMPLES * SAMPLES)
}

function blend (base, top, alpha) {
  return [
    Math.round(base[0] + (top[0] - base[0]) * alpha),
    Math.round(base[1] + (top[1] - base[1]) * alpha),
    Math.round(base[2] + (top[2] - base[2]) * alpha)
  ]
}

function setPixel (image, x, y, colour, alpha) {
  const index = (y * image.width + x) * 4
  image.data[index] = colour[0]
  image.data[index + 1] = colour[1]
  image.data[index + 2] = colour[2]
  image.data[index + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
}

function sampleBird (u, v) {
  const x = Math.min(bird.width - 1, Math.max(0, u * bird.width - 0.5))
  const y = Math.min(bird.height - 1, Math.max(0, v * bird.height - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(bird.width - 1, x0 + 1)
  const y1 = Math.min(bird.height - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0

  const out = []
  for (let channel = 0; channel < 4; channel++) {
    const top = mix(at(x0, y0, channel), at(x1, y0, channel), fx)
    const bottom = mix(at(x0, y1, channel), at(x1, y1, channel), fx)
    out.push(Math.round(mix(top, bottom, fy)))
  }
  return out
}

function at (x, y, channel) {
  return bird.data[(y * bird.width + x) * 4 + channel]
}

function mix (a, b, t) {
  return a + (b - a) * t
}
