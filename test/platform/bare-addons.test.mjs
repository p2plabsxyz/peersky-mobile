import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

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
