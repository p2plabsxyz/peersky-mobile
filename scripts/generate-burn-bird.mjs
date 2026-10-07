/**
 * The bird for burning the tabs: the everyday drawing, angry and on fire.
 * Same outline and shape. Its blues turn to flame by brightness, golden at the
 * top of the body, orange lower down and red on the wing, and a lid slants
 * over the eye toward the beak under a heavy brow. The eye's position is a
 * fraction of the bird's measured box, so the same numbers hold at any size.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const root = new URL('../', import.meta.url)
const SOURCE = new URL('assets/images/logo.png', root)
const OUTPUT = new URL('assets/images/burn-bird.png', root)
const OUTPUT_SIZE = 512

// Measured from logo.png, as fractions of the bird's bounding box. The same
// numbers generate-sad-bird.mjs closes the eye with.
const EYE = { left: 0.577, top: 0.093, bottom: 0.374, width: 0.248 }

const image = PNG.sync.read(readFileSync(SOURCE))
const box = measureOpaque(image)

setAlight(image, box)
frown(image, box)

writeFileSync(OUTPUT, PNG.sync.write(scale(crop(image, box), OUTPUT_SIZE), { deflateLevel: 9 }))
console.log(`logo.png -> burn-bird.png, ${OUTPUT_SIZE}px`)

// Blues become flame and nothing else changes: the outline, the eye and the
// beak keep their colours. Brightness picks the colour, so the body and the
// darker wing come apart the way they did in blue, and an edge fading into
// the outline fades through dark red rather than turning brown.
function setAlight (image, box) {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4
      if (image.data[index + 3] === 0) continue
      const [hue, saturation, value] = toHsv(image.data[index], image.data[index + 1], image.data[index + 2])
      if (hue < 180 || hue > 235 || saturation < 0.25) continue

      const colour = flameAt(box, y, value)
      image.data[index] = colour[0]
      image.data[index + 1] = colour[1]
      image.data[index + 2] = colour[2]
    }
  }
}

function flameAt (box, y, value) {
  const down = Math.min(1, Math.max(0, (y - box.top) / box.height))
  const body = smoothstep(0.5, 0.9, value)
  const hue = lerp(6, lerp(46, 18, down), body)
  return toRgb(hue, lerp(0.9, 0.86, body), Math.min(1, value * lerp(1.25, 1, body)))
}

// The lid comes down toward the beak, which is what turns a stare into a
// glare, and a heavy brow sits on it. The lid follows the eye's own shape,
// found from its white, so nothing of the eye is left showing above it.
function frown (image, box) {
  const ink = [0, 0, 0]
  const left = box.left + box.width * EYE.left
  const width = box.width * EYE.width
  const top = box.top + box.height * EYE.top
  const height = box.height * (EYE.bottom - EYE.top)
  const lid = (u) => 0.1 + u * 0.56
  const brow = Math.max(3, height * 0.2)
  const toEye = (x, y) => [(x - left) / width, (y - top) / height]

  // Each row of the eye, edge to edge, so the pupil inside it counts too.
  const white = eyeWhite(image, Math.round(left + width / 2), Math.round(top + height / 2))
  const rows = new Map()
  for (const index of white) {
    const x = index % image.width
    const y = (index - x) / image.width
    const row = rows.get(y) || [x, x]
    rows.set(y, [Math.min(row[0], x), Math.max(row[1], x)])
  }
  for (const [y, [from, to]] of rows) {
    for (let x = from; x <= to; x++) {
      const [u, v] = toEye(x, y)
      if (v < lid(u)) setOpaque(image, x, y, flameAt(box, y, 1))
    }
  }

  // The stroke over the eye's top left, and its soft edge, now above the lid.
  // Only that side: toward the beak the head's own outline comes close.
  const reach = Math.max(2, Math.round(width * 0.09))
  for (const index of white) {
    const x = index % image.width
    const y = (index - x) / image.width
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const [u, v] = toEye(x + dx, y + dy)
        if (u > 0.72 || v >= lid(u)) continue
        setOpaque(image, x + dx, y + dy, flameAt(box, y + dy, 1))
      }
    }
  }

  for (let y = Math.floor(top - height * 0.3); y <= Math.ceil(top + height); y++) {
    for (let x = Math.floor(left - width * 0.3); x <= Math.ceil(left + width * 1.2); x++) {
      const [u] = toEye(x, y)
      if (u < -0.14 || u > 1.06) continue
      // Thickest over the eye, tapering at both ends.
      const taper = 1 - Math.min(1, Math.abs(u - 0.5) / 0.6) ** 2 * 0.6
      // The lid is the brow's lower edge, so the two read as one shape.
      const distance = Math.abs(y - (top + lid(u) * height - brow * taper * 0.3))
      if (distance <= (brow * taper) / 2) setOpaque(image, x, y, ink)
    }
  }
}

// The eye's white, as pixel indexes, filled out from the nearest white pixel
// to the middle of where the eye should be.
function eyeWhite (image, centreX, centreY) {
  const isWhite = (x, y) => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false
    const index = (y * image.width + x) * 4
    return image.data[index + 3] > 200 && image.data[index] > 200 && image.data[index + 1] > 200 && image.data[index + 2] > 200
  }
  let seed = null
  for (let distance = 0; distance < 120 && !seed; distance++) {
    for (let dy = -distance; dy <= distance && !seed; dy++) {
      for (let dx = -distance; dx <= distance && !seed; dx++) {
        if (isWhite(centreX + dx, centreY + dy)) seed = [centreX + dx, centreY + dy]
      }
    }
  }
  if (!seed) throw new Error('No eye found where it should be')

  const found = new Set([seed[1] * image.width + seed[0]])
  const queue = [seed]
  while (queue.length > 0) {
    const [x, y] = queue.pop()
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const index = ny * image.width + nx
      if (found.has(index) || !isWhite(nx, ny)) continue
      found.add(index)
      queue.push([nx, ny])
    }
  }
  return found
}

function toHsv (red, green, blue) {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let hue = 0
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6)
    else if (max === g) hue = 60 * ((b - r) / delta + 2)
    else hue = 60 * ((r - g) / delta + 4)
  }
  return [(hue + 360) % 360, max === 0 ? 0 : delta / max, max]
}

function toRgb (hue, saturation, value) {
  const chroma = value * saturation
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = value - chroma
  const [r, g, b] = hue < 60
    ? [chroma, x, 0]
    : hue < 120 ? [x, chroma, 0] : [0, chroma, x]
  return [r, g, b].map((channel) => Math.round((channel + m) * 255))
}

function lerp (from, to, amount) {
  return from + (to - from) * amount
}

function smoothstep (from, to, value) {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

function measureOpaque (image) {
  let left = image.width
  let top = image.height
  let right = -1
  let bottom = -1

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] <= 40) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }

  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 }
}

function setOpaque (image, x, y, colour) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return
  const index = (y * image.width + x) * 4
  // Only over the bird. The brow and lid must not paint the space around it.
  if (image.data[index + 3] === 0) return
  image.data[index] = colour[0]
  image.data[index + 1] = colour[1]
  image.data[index + 2] = colour[2]
  image.data[index + 3] = 255
}

// Square, so the screen can size it without deciding which way to letterbox.
function crop (image, box) {
  const size = Math.max(box.width, box.height)
  const out = new PNG({ width: size, height: size })
  out.data.fill(0)
  const offsetX = Math.round((size - box.width) / 2)
  const offsetY = Math.round((size - box.height) / 2)

  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const from = ((box.top + y) * image.width + box.left + x) * 4
      const to = ((y + offsetY) * size + x + offsetX) * 4
      for (let channel = 0; channel < 4; channel++) {
        out.data[to + channel] = image.data[from + channel]
      }
    }
  }
  return out
}

// Box filter through premultiplied alpha, so the transparent edge does not
// drag black into the outline.
function scale (image, size) {
  const out = new PNG({ width: size, height: size })
  const step = image.width / size

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      let samples = 0

      for (let sy = Math.floor(y * step); sy < Math.max(Math.floor(y * step) + 1, Math.floor((y + 1) * step)); sy++) {
        for (let sx = Math.floor(x * step); sx < Math.max(Math.floor(x * step) + 1, Math.floor((x + 1) * step)); sx++) {
          if (sy >= image.height || sx >= image.width) continue
          const index = (sy * image.width + sx) * 4
          const a = image.data[index + 3] / 255
          red += image.data[index] * a
          green += image.data[index + 1] * a
          blue += image.data[index + 2] * a
          alpha += a
          samples++
        }
      }

      const index = (y * size + x) * 4
      out.data[index] = alpha > 0 ? Math.round(red / alpha) : 0
      out.data[index + 1] = alpha > 0 ? Math.round(green / alpha) : 0
      out.data[index + 2] = alpha > 0 ? Math.round(blue / alpha) : 0
      out.data[index + 3] = samples > 0 ? Math.round((alpha / samples) * 255) : 0
    }
  }
  return out
}
