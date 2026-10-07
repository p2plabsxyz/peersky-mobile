import Foundation

/// What the app leaves for its widgets in the App Group both can read. The
/// app writes it from JavaScript (app/widgets.ts) as JSON strings.
enum PeerSkyWidgetStore {
  static let appGroup = "group.xyz.p2plabs.peersky"
  static let browserKind = "PeerSkyBrowser"
  static let peerTunesKind = "PeerTunesNowPlaying"

  private static let bookmarksKey = "browserBookmarks"
  private static let nowPlayingKey = "peertunesNowPlaying"
  private static let artworkKey = "peertunesArtwork"

  struct Bookmark: Codable, Hashable {
    let title: String
    let url: String
  }

  struct NowPlaying: Codable {
    /// The player page is open and takes the buttons.
    var live: Bool
    var playing: Bool
    var title: String
    var artist: String
    var album: String
  }

  private static var defaults: UserDefaults? {
    UserDefaults(suiteName: appGroup)
  }

  static func bookmarks() -> [Bookmark] {
    decode([Bookmark].self, forKey: bookmarksKey) ?? []
  }

  static func nowPlaying() -> NowPlaying? {
    decode(NowPlaying.self, forKey: nowPlayingKey)
  }

  static func artwork() -> Data? {
    guard let base64 = defaults?.string(forKey: artworkKey), !base64.isEmpty else { return nil }
    return Data(base64Encoded: base64)
  }

  /// What a button just asked for, shown before the page says so itself.
  static func setPlaying(_ playing: Bool) {
    guard var state = nowPlaying(), state.live else { return }
    state.playing = playing
    guard let data = try? JSONEncoder().encode(state) else { return }
    defaults?.set(String(decoding: data, as: UTF8.self), forKey: nowPlayingKey)
  }

  private static func decode<Value: Decodable>(_ type: Value.Type, forKey key: String) -> Value? {
    guard let json = defaults?.string(forKey: key) else { return nil }
    return try? JSONDecoder().decode(type, from: Data(json.utf8))
  }
}
