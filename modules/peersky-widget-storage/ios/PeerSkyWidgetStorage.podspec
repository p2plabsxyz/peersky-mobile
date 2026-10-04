Pod::Spec.new do |s|
  s.name           = 'PeerSkyWidgetStorage'
  s.version        = '1.0.0'
  s.summary        = 'Leaves what the home screen widgets show where they can read it.'
  s.description    = 'Writes to the App Group the PeerSky widgets read, and reloads them.'
  s.author         = 'P2P Labs'
  s.homepage       = 'https://github.com/p2plabsxyz/peersky-mobile'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.swift'
end
