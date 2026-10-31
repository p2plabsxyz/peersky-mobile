import SwiftUI
import WidgetKit

@main
struct PeerSkyWidgets: WidgetBundle {
  var body: some Widget {
    PeerSkyBrowserWidget()
    PeerTunesWidget()
    PrivateSearchLockScreenWidget()
    BurnLockScreenWidget()
    BookmarksLockScreenWidget()
    P2PSitesLockScreenWidget()
    ClearP2PDataLockScreenWidget()
  }
}

/// Where a tap on a widget goes. Each is a peersky://shortcut/ link the app
/// reads in app/home-shortcuts.mjs.
enum WidgetLinks {
  static let search = URL(string: "peersky://shortcut/search")!
  // The lock screen buttons, each done as soon as the app opens.
  static let privateSearch = URL(string: "peersky://shortcut/private-search")!
  static let burn = URL(string: "peersky://shortcut/burn")!
  static let bookmarks = URL(string: "peersky://shortcut/bookmarks")!
  static let p2pSites = open("peersky://p2p/")
  static let clearP2PData = URL(string: "peersky://shortcut/clear-p2p-data")!
  private static let peerTunesApp = open("peersky://p2p/peertunes/")

  /// PeerTunes, and with a song on the widget, Now Playing with that song.
  /// The song goes in a parameter of its own, beside the address, so the
  /// PeerTunes tab keeps its plain address (app/home-shortcuts.mjs).
  static func peerTunes(showing song: PeerSkyWidgetStore.NowPlaying?) -> URL {
    guard let song else { return peerTunesApp }
    let id = song.id ?? ""
    let plain = id.count <= 64 && id.unicodeScalars.allSatisfy { $0.isASCII && CharacterSet.alphanumerics.contains($0) }
    guard plain else { return peerTunesApp }
    return URL(string: "\(peerTunesApp.absoluteString)&song=\(id)") ?? peerTunesApp
  }

  /// Opens an address in the app: an app goes back to its tab, anything else
  /// gets a new one.
  static func open(_ target: String) -> URL {
    // Everything but the unreserved characters, so an address with its own
    // query string arrives whole.
    let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    let encoded = target.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    return URL(string: "peersky://shortcut/open?url=\(encoded)") ?? search
  }
}
