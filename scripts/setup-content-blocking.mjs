import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const targets = [
  'armv7-linux-androideabi',
  'aarch64-linux-android',
  'i686-linux-android',
  'x86_64-linux-android'
]

run(resolveRustTool('rustup'), ['target', 'add', ...targets])
run(resolveRustTool('cargo'), ['install', 'cargo-ndk', '--version', '4.1.2', '--locked'])

function resolveRustTool (name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name
  const userInstall = path.join(homedir(), '.cargo', 'bin', executable)
  return existsSync(userInstall) ? userInstall : executable
}

function run (command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit'
  })
  if (result.error?.code === 'ENOENT') {
    throw new Error(`${path.basename(command)} was not found. Install Rust from https://rustup.rs/ and try again.`)
  }
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed with exit code ${result.status}.`)
  }
}
