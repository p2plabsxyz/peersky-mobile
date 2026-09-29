const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`

// Debug builds talk to the Metro dev server, which is wherever the developer's
// machine is on the network and speaks plain HTTP.
const DEBUG_NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`

function write (dir, contents) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'network_security_config.xml'), contents)
}

module.exports = function withAndroidLoopbackCleartext (config) {
  config = withAndroidManifest(config, (androidConfig) => {
    const application = androidConfig.modResults.manifest.application?.[0]
    const applicationAttributes = application?.$

    if (applicationAttributes) {
      applicationAttributes['android:networkSecurityConfig'] = '@xml/network_security_config'
      delete applicationAttributes['android:usesCleartextTraffic']
    }

    return androidConfig
  })

  return withDangerousMod(config, ['android', async (androidConfig) => {
    const root = androidConfig.modRequest.platformProjectRoot
    write(path.join(root, 'app/src/main/res/xml'), NETWORK_SECURITY_CONFIG)
    // Debug only, and it overrides the one above for that build type alone. A
    // development build loads its JavaScript from Metro over plain HTTP on the
    // machine's LAN address, which the shipped rule refuses, so every launch
    // opened on "CLEARTEXT communication not permitted" until it was reloaded.
    write(path.join(root, 'app/src/debug/res/xml'), DEBUG_NETWORK_SECURITY_CONFIG)

    return androidConfig
  }])
}
