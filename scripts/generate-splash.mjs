/**
 * Draws the launch image from the bird and one colour.
 *
 * The native launch image and the startup screen the app draws itself are two
 * different pictures shown back to back, so any difference between them reads
 * as a flash. Generating one from the same numbers as the other is what keeps
 * them the same picture.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const WIDTH = 1284
const HEIGHT = 2778
// 336 of 1284 is the same fraction of the screen that the startup screen
// gives its badge, so the two are the same size when one replaces the other.
const DIAMETER = 336
const BADGE = [0x67, 0xfc, 0xe7]
const RING = [0x14, 0x14, 0x14]
const RING_WIDTH = 20
const BIRD_SCALE = 0.76
const SAMPLES = 4

const root = new URL('../', import.meta.url)
const bird = PNG.sync.read(readFileSync(new URL('assets/images/logo.png', root)))

// Light and dark, because the screen that follows this one is theme aware and
// a white flash before a dark app is the thing being fixed.
const VARIANTS = [
  { name: 'splash.png', background: [0xff, 0xff, 0xff] },
  { name: 'splash-dark.png', background: [0x18, 0x18, 0x1b] }
]

const centerX = WIDTH / 2
const centerY = HEIGHT / 2
const outer = DIAMETER / 2
const inner = outer - RING_WIDTH
const birdSize = Math.round(DIAMETER * BIRD_SCALE)
const birdLeft = Math.round(centerX - birdSize / 2)
const birdTop = Math.round(centerY - birdSize / 2)

for (const variant of VARIANTS) {
  const out = new PNG({ width: WIDTH, height: HEIGHT })

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      setPixel(out, x, y, blend(variant.background, RING, coverage(x, y, outer)))
    }
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const alpha = coverage(x, y, inner)
      if (alpha > 0) setPixel(out, x, y, blend(readPixel(out, x, y), BADGE, alpha))
    }
  }

  // The bird sits inside the ring at the same fraction the app uses.
  for (let y = 0; y < birdSize; y++) {
    for (let x = 0; x < birdSize; x++) {
      const sample = sampleBird((x + 0.5) / birdSize, (y + 0.5) / birdSize)
      if (sample[3] === 0) continue
      const [targetX, targetY] = [birdLeft + x, birdTop + y]
      setPixel(out, targetX, targetY, blend(
        readPixel(out, targetX, targetY),
        sample,
        sample[3] / 255
      ))
    }
  }

  writeFileSync(new URL(`assets/images/${variant.name}`, root), PNG.sync.write(out))
  console.log(`${variant.name} ${WIDTH}x${HEIGHT}, badge ${DIAMETER}px`)
}

// How much of this pixel falls inside the circle, supersampled so the edge is
// smooth rather than a staircase.
function coverage (x, y, radius) {
  const corner = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY)
  if (corner > radius + 1.5) return 0
  if (corner < radius - 1.5) return 1

  let hits = 0
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      const px = x + (sx + 0.5) / SAMPLES
      const py = y + (sy + 0.5) / SAMPLES
      if (Math.hypot(px - centerX, py - centerY) <= radius) hits++
    }
  }
  return hits / (SAMPLES * SAMPLES)
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

function blend (base, top, alpha) {
  return [
    Math.round(base[0] + (top[0] - base[0]) * alpha),
    Math.round(base[1] + (top[1] - base[1]) * alpha),
    Math.round(base[2] + (top[2] - base[2]) * alpha)
  ]
}

function readPixel (image, x, y) {
  const index = (y * image.width + x) * 4
  return [image.data[index], image.data[index + 1], image.data[index + 2]]
}

function setPixel (image, x, y, color) {
  const index = (y * image.width + x) * 4
  image.data[index] = color[0]
  image.data[index + 1] = color[1]
  image.data[index + 2] = color[2]
  image.data[index + 3] = 255
}
