import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// Holesail is AGPL. The phone speaks its protocol through its own tunnel
// (backend/holesail/tunnel.mjs) and keeps the package only to test against.
test('holesail stays out of the app', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(pkg.dependencies.holesail, undefined)
  assert.ok(pkg.devDependencies.holesail)
  const bundle = await read('app/app.bundle.mjs')
  assert.doesNotMatch(bundle, /\/node_modules\/(holesail|holesail-client|holesail-server|holesail-logger|barely-colours)\//)
  for (const file of ['backend/holesail/session.mjs', 'backend/holesail/tunnel.mjs']) {
    assert.doesNotMatch(await read(file), /from 'holesail/, file)
  }
})

// bare-link copies every add-on of the app's dependencies into
// react-native-bare-kit and never removes one, so a package the app dropped
// kept shipping its native code. The patched link scripts start empty.
test('the Bare add-ons are linked fresh on every build', async () => {
  const patch = await read('patches/react-native-bare-kit+0.13.3.patch')
  for (const platform of ['ios', 'android']) {
    assert.match(patch, new RegExp(`\\+\\+\\+ b/node_modules/react-native-bare-kit/${platform}/link\\.mjs`))
  }
  assert.equal(patch.match(/\+fs\.rmSync\(out, \{ recursive: true, force: true \}\)/g).length, 2)
})
