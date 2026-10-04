import SwiftUI
import WidgetKit

@main
struct PeerSkyWidgets: WidgetBundle {
  var body: some Widget {
    PeerSkyBrowserWidget()
    PeerTunesWidget()
  }
}

/// Where a tap on a widget goes. Each is a peersky://shortcut/ link the app
/// reads in app/home-shortcuts.mjs.
enum WidgetLinks {
  static let search = URL(string: "peersky://shortcut/search")!
  static let peerTunes = open("peersky://p2p/peertunes/")

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
