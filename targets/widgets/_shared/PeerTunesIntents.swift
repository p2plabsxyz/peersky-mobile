import AppIntents
import Foundation

// The PeerTunes widget's buttons. As audio intents they run in the app, where
// the music plays, and PeerSkyAudioRoute hands them to the player page the
// way the buttons on earbuds reach it. The names are the page's own media
// session actions.
enum PeerTunesWidgetCommand {
  static let notification = Notification.Name("PeerSkyMediaCommand")

  static func send(_ command: String) async {
    await MainActor.run {
      NotificationCenter.default.post(name: notification, object: nil, userInfo: ["command": command])
    }
  }
}

@available(iOS 17.0, *)
struct PeerTunesPlayIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Play"
  static let isDiscoverable = false

  func perform() async throws -> some IntentResult {
    PeerSkyWidgetStore.setPlaying(true)
    await PeerTunesWidgetCommand.send("play")
    return .result()
  }
}

@available(iOS 17.0, *)
struct PeerTunesPauseIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Pause"
  static let isDiscoverable = false

  func perform() async throws -> some IntentResult {
    PeerSkyWidgetStore.setPlaying(false)
    await PeerTunesWidgetCommand.send("pause")
    return .result()
  }
}

@available(iOS 17.0, *)
struct PeerTunesNextIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Next Song"
  static let isDiscoverable = false

  func perform() async throws -> some IntentResult {
    await PeerTunesWidgetCommand.send("nexttrack")
    return .result()
  }
}

@available(iOS 17.0, *)
struct PeerTunesPreviousIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Previous Song"
  static let isDiscoverable = false

  func perform() async throws -> some IntentResult {
    await PeerTunesWidgetCommand.send("previoustrack")
    return .result()
  }
}
