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
    const xmlDir = path.join(androidConfig.modRequest.platformProjectRoot, 'app/src/main/res/xml')
    const xmlPath = path.join(xmlDir, 'network_security_config.xml')

    fs.mkdirSync(xmlDir, { recursive: true })
    fs.writeFileSync(xmlPath, NETWORK_SECURITY_CONFIG)

    return androidConfig
  }])
}
