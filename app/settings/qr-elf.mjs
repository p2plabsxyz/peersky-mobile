// QR codes as the desktop draws them. Its qr-code elf (peersky-browser
// src/pages/static/elves/qr-code.js) hands qr-creator a canvas, with rounded
// dots and error correction L. The phone has no canvas, so it hands the same
// library one that writes down what is drawn as SVG paths. Same library, same
// settings, same code on both, instead of a QR module of the phone's own.
import './qr-globals.mjs'
import QrCreator from '../vendor/qr-creator/qr-creator.mjs'

// The elf draws at 1080 pixels and scales the picture to fit. A path is drawn
// at the same size and scaled by its viewBox.
export const QR_SIZE = 1080

const round = (value) => Math.round(value * 100) / 100

// The calls qr-creator makes on a 2d context, kept as SVG paths: each fill
// with the colour it was filled with, in the order drawn.
class RecordingContext {
  constructor () {
    this.layers = []
    this.path = ''
    this.x = 0
    this.y = 0
    this.fillStyle = '#000000'
  }

  clearRect () {
    this.layers = []
  }

  fillRect (x, y, width, height) {
    this.layers.push({ fill: this.fillStyle, d: `M${round(x)} ${round(y)}h${round(width)}v${round(height)}h${round(-width)}Z` })
  }

  beginPath () {
    this.path = ''
  }

  moveTo (x, y) {
    this.path += `M${round(x)} ${round(y)}`
    this.x = x
    this.y = y
  }

  lineTo (x, y) {
    this.path += `L${round(x)} ${round(y)}`
    this.x = x
    this.y = y
  }

  // A canvas arcTo: a line to where a circle of radius r touches the line to
  // (x1, y1), then the arc to where it touches the line from there to (x2, y2).
  arcTo (x1, y1, x2, y2, r) {
    const ax = this.x - x1
    const ay = this.y - y1
    const bx = x2 - x1
    const by = y2 - y1
    const la = Math.hypot(ax, ay)
    const lb = Math.hypot(bx, by)
    const cross = ax * by - ay * bx
    if (!r || !la || !lb || Math.abs(cross) < 1e-9) {
      this.lineTo(x1, y1)
      return
    }
    const angle = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))))
    const reach = r / Math.tan(angle / 2)
    const sx = x1 + (ax / la) * reach
    const sy = y1 + (ay / la) * reach
    const ex = x1 + (bx / lb) * reach
    const ey = y1 + (by / lb) * reach
    this.lineTo(sx, sy)
    // Turning clockwise on screen, where y grows downward, is sweep 1.
    this.path += `A${round(r)} ${round(r)} 0 0 ${cross < 0 ? 1 : 0} ${round(ex)} ${round(ey)}`
    this.x = ex
    this.y = ey
  }

  fill () {
    if (this.path) this.layers.push({ fill: this.fillStyle, d: this.path })
  }
}

class RecordingCanvas {
  constructor (size) {
    this.width = size
    this.height = size
    this.context = new RecordingContext()
  }

  getContext () {
    return this.context
  }
}

/**
 * The code for text, as qr-creator draws it: { size, layers }, each layer an
 * SVG path and its fill, the background first. Throws when text is too long.
 */
export function drawQrCode (text, { fg = '#000000', bg = '#ffffff', size = QR_SIZE } = {}) {
  const canvas = new RecordingCanvas(size)
  // qr-creator draws into an element it is given only when that element is a
  // canvas, which it asks HTMLCanvasElement. There is none on the phone, so
  // this canvas stands in for the one call.
  const standIn = typeof globalThis.HTMLCanvasElement === 'undefined'
  if (standIn) globalThis.HTMLCanvasElement = RecordingCanvas
  try {
    QrCreator.render({ text: String(text), radius: 0.5, ecLevel: 'L', fill: fg, background: bg, size }, canvas)
  } finally {
    if (standIn) delete globalThis.HTMLCanvasElement
  }
  // Text too long for any QR code draws nothing at all.
  const layers = canvas.context.layers
  if (layers.length === 0) throw new Error('Too long for a QR code')
  return { size, layers }
}
