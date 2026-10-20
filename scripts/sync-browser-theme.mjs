#!/usr/bin/env node
// Brings the desktop's theme style over from a checkout of
// p2plabsxyz/peersky-browser, for browser://theme/style.css on the phone:
//
//   node scripts/sync-browser-theme.mjs ../peersky-browser
//
// assets/browser-theme/style.css becomes a copy of the desktop's
// src/pages/theme/style.css, and app/browser-theme-style.mjs is written again
// from it. vars.css is the phone's own (app/browser-theme.mjs).
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
export const STYLE_ASSET = join(root, 'assets', 'browser-theme', 'style.css')
export const STYLE_MODULE = join(root, 'app', 'browser-theme-style.mjs')

export function writeStyleModule () {
  const css = readFileSync(STYLE_ASSET, 'utf8')
  writeFileSync(STYLE_MODULE, '// Written by scripts/sync-browser-theme.mjs from assets/browser-theme/style.css.\n' +
    `export default ${JSON.stringify(css)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = process.argv[2]
  if (repo) {
    const source = join(resolve(repo), 'src', 'pages', 'theme', 'style.css')
    if (!existsSync(source)) {
      console.error(`No src/pages/theme/style.css in ${resolve(repo)}`)
      process.exit(1)
    }
    copyFileSync(source, STYLE_ASSET)
  }
  writeStyleModule()
  console.log(`Wrote ${STYLE_MODULE}`)
}
