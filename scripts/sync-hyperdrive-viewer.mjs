#!/usr/bin/env node
// Brings the Hyperdrive viewer over from a checkout of p2plabsxyz/upload, the
// repo it is written in, and rebuilds what is made from it:
//
//   node scripts/sync-hyperdrive-viewer.mjs ../hyperdrive
//
// assets/hyperdrive-viewer becomes a copy of that repo's viewer/ folder, files
// gone there go here too, and then backend/hyperdrive-viewer/viewer-runtime.mjs,
// app/i18n/viewer-strings.json and app/i18n/strings.json are written again.
// New text in the viewer still needs its translations in every catalog:
// node scripts/i18n.mjs --check lists them.
import { cpSync, existsSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isViewerNote, missingViewerFiles, sourceDir, writeViewerRuntime } from './generate-hyperdrive-viewer-runtime.mjs'
import { writeStringFiles } from './i18n.mjs'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const repo = process.argv[2]

if (!repo) {
  console.error('Usage: node scripts/sync-hyperdrive-viewer.mjs <path to the hyperdrive repo>')
  process.exit(1)
}

const viewer = join(resolve(repo), 'viewer')
if (!existsSync(viewer) || !statSync(viewer).isDirectory()) {
  console.error(`No viewer/ folder in ${resolve(repo)}`)
  process.exit(1)
}
if (!existsSync(join(viewer, 'index.html'))) {
  console.warn(`${join(viewer, 'index.html')} is missing: the viewer will not open until it is there.`)
}

rmSync(sourceDir, { recursive: true, force: true })
cpSync(viewer, sourceDir, {
  recursive: true,
  // Finder's and editors' leftovers stay behind, and so do the viewer's notes
  // for the people writing it, as VIEWER-API.md.
  filter: (source) => source === viewer || (!basename(source).startsWith('.') && !isViewerNote(basename(source)))
})

await writeViewerRuntime()
const strings = writeStringFiles()

console.log(`Copied ${viewer} to ${sourceDir.slice(root.length + 1)}`)
console.log(`Wrote backend/hyperdrive-viewer/viewer-runtime.mjs and the string lists: ${strings.viewer.strings.length} strings and ${strings.viewer.plurals.length} plurals in the viewer`)
for (const problem of strings.problems) console.error(problem)
if (strings.problems.length) process.exitCode = 1

// A module the viewer loads that is not in the copy keeps the page from
// starting at all.
const missing = await missingViewerFiles()
for (const file of missing) console.error(`viewer/${file} is loaded by the viewer but is not in the copy`)
if (missing.length) process.exitCode = 1
