/**
 * Draws the launch image.
 *
 * The native launch image and the startup screen the app draws itself are two
 * pictures shown back to back, so any difference between them reads as a
 * flash. Generating one from the same numbers as the other is what keeps them
 * the same picture: the bird, at the same size, in the middle, and nothing
 * else.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const WIDTH = 1284
const HEIGHT = 2778
// 420 of 1284 is 140pt on a three times screen, which is what the startup
// screen draws the bird at.
const BIRD_BOX = 420

const root = new URL('../', import.meta.url)

// Light and dark, because the screen that follows this one is theme aware and
// a white flash before a dark app is the thing being fixed. The dark one uses
// the bird with white behind it: the artwork is drawn with black outlines and
// they vanish against a dark screen.
const VARIANTS = [
  { name: 'splash.png', background: [0xff, 0xff, 0xff], bird: 'assets/images/logo.png' },
  { name: 'splash-dark.png', background: [0x18, 0x18, 0x1b], bird: 'assets/images/logo-on-dark.png' }
]

const birdLeft = Math.round((WIDTH - BIRD_BOX) / 2)
const birdTop = Math.round((HEIGHT - BIRD_BOX) / 2)

for (const variant of VARIANTS) {
  const bird = PNG.sync.read(readFileSync(new URL(variant.bird, root)))
  const out = new PNG({ width: WIDTH, height: HEIGHT })

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      setPixel(out, x, y, variant.background)
    }
  }

  for (let y = 0; y < BIRD_BOX; y++) {
    for (let x = 0; x < BIRD_BOX; x++) {
      const sample = sampleBird(bird, (x + 0.5) / BIRD_BOX, (y + 0.5) / BIRD_BOX)
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
  console.log(`${variant.name} ${WIDTH}x${HEIGHT}, bird ${BIRD_BOX}px`)
}

function sampleBird (bird, u, v) {
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
    const top = mix(at(bird, x0, y0, channel), at(bird, x1, y0, channel), fx)
    const bottom = mix(at(bird, x0, y1, channel), at(bird, x1, y1, channel), fx)
    out.push(Math.round(mix(top, bottom, fy)))
  }
  return out
}

function at (bird, x, y, channel) {
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
