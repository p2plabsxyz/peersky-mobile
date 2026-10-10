import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

const appDir = new URL('../../app/', import.meta.url).pathname

async function sourceFiles (dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...await sourceFiles(path))
    else if (entry.name.endsWith('.tsx')) found.push(path)
  }
  return found
}

// The opening tag ends at the first '>' outside braces, so an arrow function
// in a prop does not end it early.
function openingTag (source, start) {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    const char = source[i]
    if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === '>' && depth === 0) return source.slice(start, i + 1)
  }
  return source.slice(start)
}

function modals (source) {
  const blocks = []
  let at = source.indexOf('<Modal')
  while (at !== -1) {
    const end = source.indexOf('</Modal>', at)
    blocks.push({ tag: openingTag(source, at), body: source.slice(at, end === -1 ? undefined : end) })
    at = source.indexOf('<Modal', at + 1)
  }
  return blocks
}

test('a full-screen modal with a SafeAreaView brings its own provider', async () => {
  // A Modal is its own root view on iOS. A SafeAreaView inside one, with no
  // provider of its own, got no insets: Reader view's close button and the
  // image preview's sat under the status bar, out of reach.
  const missing = []
  let checked = 0
  for (const file of await sourceFiles(appDir)) {
    const source = await readFile(file, 'utf8')
    for (const modal of modals(source)) {
      if (/\btransparent\b/.test(modal.tag) || /pageSheet/.test(modal.tag)) continue
      if (!modal.body.includes('<SafeAreaView')) continue
      checked++
      if (!modal.body.includes('<SafeAreaProvider initialMetrics={initialWindowMetrics}>')) {
        missing.push(file.slice(appDir.length))
      }
    }
  }
  assert.ok(checked >= 8, `only ${checked} full-screen modals found`)
  assert.deepEqual(missing, [])
})

test('a scanner Cancel placed absolutely adds the insets itself', async () => {
  // Absolute children ignore a SafeAreaView's padding, so Cancel sat on the
  // status bar icons in the Hyperdrive and P2PMD scanners.
  const hyperdrive = await readFile(join(appDir, 'hyperdrive/HyperdriveScreen.tsx'), 'utf8')
  const index = await readFile(join(appDir, 'index.tsx'), 'utf8')
  assert.match(hyperdrive, /style=\{\[styles\.scannerClose, \{ right: 16 \+ insets\.right, top: 12 \+ insets\.top \}\]\}/)
  assert.match(index, /style=\{\[styles\.p2pmdScannerClose, \{ right: 16 \+ browserInsets\.right, top: 12 \+ browserInsets\.top \}\]\}/)
})
