/**
 * Re-frames the adaptive icon layers so the launcher's mask cannot clip them.
 * Android cuts a shape out of a 108dp canvas and only the middle 66dp circle
 * is sure to survive. The source bird fills about 60% of the canvas, a little
 * left of centre, so its beak and legs met the mask. The artwork is measured
 * rather than given a fixed margin, so a redrawn bird still fits.
 *
 * It is centred on its weight, not its box. The legs are thin lines below the
 * body, so the middle of the box sat under the body and the bird looked high.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const SIZE = 1024
// 66dp of 108dp, less a little so nothing sits right on the cut line.
const SAFE_RADIUS = SIZE * (33 / 108) * 0.94

const root = new URL('../', import.meta.url)
const LAYERS = [
  { from: 'assets/app-icons/android/foreground-source.png', to: 'assets/app-icons/android/foreground.png' },
  { from: 'assets/app-icons/android/monochrome-source.png', to: 'assets/app-icons/android/monochrome.png' }
]

for (const layer of LAYERS) {
  const source = PNG.sync.read(readFileSync(new URL(layer.from, root)))
  const bounds = measure(source)
  const out = new PNG({ width: SIZE, height: SIZE })
  out.data.fill(0)

  // Scale so the furthest visible pixel lands on the safe circle, measured
  // from the bird's weight, and put that weight in the middle of the canvas.
  const scale = SAFE_RADIUS / bounds.radius

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sourceX = bounds.centerX + (x + 0.5 - SIZE / 2) / scale
      const sourceY = bounds.centerY + (y + 0.5 - SIZE / 2) / scale
      if (sourceX < 0 || sourceX >= source.width || sourceY < 0 || sourceY >= source.height) continue
      const pixel = sample(source, sourceX, sourceY)
      const index = (y * SIZE + x) * 4
      out.data[index] = pixel[0]
      out.data[index + 1] = pixel[1]
      out.data[index + 2] = pixel[2]
      out.data[index + 3] = pixel[3]
    }
  }

  writeFileSync(new URL(layer.to, root), PNG.sync.write(out))
  const check = measure(out)
  console.log(
    `${layer.to.split('/').pop()}: ${(check.radius / SIZE * 100).toFixed(1)}% radius, ` +
    `centre off by ${check.offsetX.toFixed(1)},${check.offsetY.toFixed(1)}`
  )
}

// The visible artwork: where its weight sits, by opacity, and how far its
// furthest pixel is from there.
function measure (image) {
  let weight = 0
  let sumX = 0
  let sumY = 0

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const alpha = image.data[(y * image.width + x) * 4 + 3]
      if (alpha <= 8) continue
      weight += alpha
      sumX += (x + 0.5) * alpha
      sumY += (y + 0.5) * alpha
    }
  }

  const centerX = sumX / weight
  const centerY = sumY / weight
  let radius = 0
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] <= 8) continue
      radius = Math.max(radius, Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY))
    }
  }

  return {
    centerX,
    centerY,
    radius,
    offsetX: centerX - image.width / 2,
    offsetY: centerY - image.height / 2
  }
}

// Bilinear, and through premultiplied alpha. Blending straight colour across
// a transparent edge drags whatever the fully clear pixels happen to hold into
// the outline, which on this artwork is a black fringe.
function sample (image, x, y) {
  const fx = Math.min(image.width - 1, Math.max(0, x - 0.5))
  const fy = Math.min(image.height - 1, Math.max(0, y - 0.5))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(image.width - 1, x0 + 1)
  const y1 = Math.min(image.height - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0

  let red = 0
  let green = 0
  let blue = 0
  let alpha = 0

  for (const [px, py, weight] of [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x1, y0, tx * (1 - ty)],
    [x0, y1, (1 - tx) * ty],
    [x1, y1, tx * ty]
  ]) {
    const index = (py * image.width + px) * 4
    const a = image.data[index + 3] / 255
    red += image.data[index] * a * weight
    green += image.data[index + 1] * a * weight
    blue += image.data[index + 2] * a * weight
    alpha += a * weight
  }

  if (alpha <= 0) return [0, 0, 0, 0]
  return [
    Math.round(red / alpha),
    Math.round(green / alpha),
    Math.round(blue / alpha),
    Math.round(alpha * 255)
  ]
}
