// What iOS shows for PeerSky in its own prompts, from Info.plist. Each
// language's copy is written to app/i18n/native by scripts/i18n.mjs, and the
// locales in app.json hand those to iOS. The English has to match app.json.
export const INFO_PLIST_TEXT = Object.freeze({
  NSCameraUsageDescription: 'PeerSky uses the camera to scan QR codes when you link a device or open a shared room or drive, and when a website you visit requests it and you allow access.',
  NSLocalNetworkUsageDescription: 'PeerSky uses your local network to discover and connect to nearby PeerSky devices.',
  NSLocationWhenInUseUsageDescription: 'PeerSky uses your location only when a website you visit requests it and you allow access.',
  NSMicrophoneUsageDescription: 'PeerSky uses the microphone only when a website you visit requests it and you allow access.',
  NSPhotoLibraryAddUsageDescription: 'PeerSky saves a picture or video to your photo library when you choose Save to Photos.'
})
