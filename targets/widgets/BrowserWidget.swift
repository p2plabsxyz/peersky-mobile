import SwiftUI
import WidgetKit

// PeerSky's start page on the home screen. Small is the search bar. Medium
// adds the P2P apps under it, and large the newest bookmarks too.

struct BrowserEntry: TimelineEntry {
  let date: Date
  let bookmarks: [PeerSkyWidgetStore.Bookmark]
}

struct BrowserProvider: TimelineProvider {
  func placeholder(in context: Context) -> BrowserEntry {
    BrowserEntry(date: .now, bookmarks: [])
  }

  func getSnapshot(in context: Context, completion: @escaping (BrowserEntry) -> Void) {
    completion(entry())
  }

  // Nothing here changes by itself. The app reloads it when a bookmark does.
  func getTimeline(in context: Context, completion: @escaping (Timeline<BrowserEntry>) -> Void) {
    completion(Timeline(entries: [entry()], policy: .never))
  }

  private func entry() -> BrowserEntry {
    BrowserEntry(date: .now, bookmarks: PeerSkyWidgetStore.bookmarks())
  }
}

struct PeerSkyBrowserWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: PeerSkyWidgetStore.browserKind, provider: BrowserProvider()) { entry in
      BrowserWidgetView(entry: entry)
    }
    .configurationDisplayName("PeerSky")
    .description("Search, and open the P2P apps and your bookmarks.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    .contentMarginsDisabled()
  }
}

/// The apps on the start page, in its order (app/internal-apps-registry.mjs).
struct WidgetApp: Identifiable {
  let id: String
  let title: String
  let image: String
  let url: String
}

let widgetApps = [
  WidgetApp(id: "hyper", title: "Hyperdrive", image: "HyperdriveIcon", url: "peersky://p2p/hyperdrive/"),
  WidgetApp(id: "p2pmd", title: "P2PMD", image: "P2PMDIcon", url: "peersky://p2p/p2pmd/"),
  WidgetApp(id: "peerchat", title: "PeerChat", image: "PeerChatIcon", url: "peersky://p2p/peerchat/"),
  WidgetApp(id: "peertunes", title: "PeerTunes", image: "PeerTunesIcon", url: "peersky://p2p/peertunes/")
]

struct BrowserWidgetView: View {
  let entry: BrowserEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    content
      .containerBackground(for: .widget) {
        // The start page's own wallpaper, a little washed so the bar and the
        // labels read on any part of it.
        ZStack {
          Image("Wallpaper").resizable().scaledToFill()
          colorScheme == .dark ? Color.black.opacity(0.3) : Color.white.opacity(0.08)
        }
      }
  }

  @ViewBuilder
  private var content: some View {
    switch family {
    case .systemSmall:
      SmallSearch()
    case .systemLarge:
      VStack(spacing: 12) {
        SearchBar()
        AppRow()
        BookmarkList(bookmarks: entry.bookmarks)
        Spacer(minLength: 0)
      }
      .padding(16)
    default:
      VStack(spacing: 10) {
        SearchBar()
        AppRow()
      }
      .padding(14)
    }
  }
}

private struct SmallSearch: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Image("PeerSkyIcon")
        .resizable()
        .frame(width: 54, height: 54)
        .shadow(color: .black.opacity(0.25), radius: 4, y: 2)
      Spacer(minLength: 0)
      HStack(spacing: 6) {
        Image(systemName: "magnifyingglass")
        Text("Search")
        Spacer(minLength: 0)
      }
      .font(.system(size: 15, weight: .semibold))
      .foregroundStyle(.primary)
      .padding(.horizontal, 12)
      .frame(height: 40)
      .widgetPill()
    }
    .padding(14)
    .widgetURL(WidgetLinks.search)
  }
}

private struct SearchBar: View {
  var body: some View {
    Link(destination: WidgetLinks.search) {
      HStack(spacing: 10) {
        Image("PeerSkyIcon")
          .resizable()
          .frame(width: 26, height: 26)
        Text("Search or enter address")
          .font(.system(size: 15))
          .foregroundStyle(.secondary)
          .lineLimit(1)
        Spacer(minLength: 0)
        Image(systemName: "magnifyingglass")
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(.secondary)
      }
      .padding(.leading, 8)
      .padding(.trailing, 14)
      .frame(height: 42)
      .widgetPill()
    }
  }
}

private struct AppRow: View {
  var body: some View {
    HStack(spacing: 0) {
      ForEach(widgetApps) { app in
        Link(destination: WidgetLinks.open(app.url)) {
          VStack(spacing: 5) {
            Image(app.image)
              .resizable()
              .frame(width: 48, height: 48)
              .shadow(color: .black.opacity(0.2), radius: 3, y: 1)
            Text(app.title)
              .font(.system(size: 11, weight: .semibold))
              .foregroundStyle(.white)
              .shadow(color: .black.opacity(0.6), radius: 2, y: 1)
              .lineLimit(1)
              .minimumScaleFactor(0.8)
          }
          .frame(maxWidth: .infinity)
        }
      }
    }
  }
}

private struct BookmarkList: View {
  let bookmarks: [PeerSkyWidgetStore.Bookmark]

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Bookmarks")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.white)
        .shadow(color: .black.opacity(0.6), radius: 2, y: 1)
        .padding(.leading, 4)
      if bookmarks.isEmpty {
        Text("Pages you bookmark in PeerSky show up here.")
          .font(.system(size: 13))
          .foregroundStyle(.secondary)
          .lineLimit(2)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 12)
          .frame(height: 40)
          .widgetPill(cornerRadius: 12)
      } else {
        ForEach(bookmarks.prefix(3), id: \.self) { bookmark in
          Link(destination: WidgetLinks.open(bookmark.url)) {
            BookmarkRow(bookmark: bookmark)
          }
        }
      }
    }
  }
}

private struct BookmarkRow: View {
  let bookmark: PeerSkyWidgetStore.Bookmark

  private var host: String {
    guard let url = URL(string: bookmark.url), let host = url.host, !host.isEmpty else { return bookmark.url }
    if url.scheme == "hyper" { return "hyper://" + host.prefix(12) }
    return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
  }

  // A letter on a colour picked from the host, so a site keeps its colour.
  private var monogram: (letter: String, color: Color) {
    let palette: [Color] = [.blue, .teal, .indigo, .orange, .pink, .green, .purple, .red]
    let letter = (bookmark.title.first ?? host.first).map { String($0).uppercased() } ?? "?"
    let sum = host.unicodeScalars.reduce(0) { $0 + Int($1.value) }
    return (letter, palette[sum % palette.count])
  }

  var body: some View {
    HStack(spacing: 10) {
      Text(monogram.letter)
        .font(.system(size: 14, weight: .bold))
        .foregroundStyle(.white)
        .frame(width: 28, height: 28)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(monogram.color.gradient))
      VStack(alignment: .leading, spacing: 0) {
        Text(bookmark.title)
          .font(.system(size: 14, weight: .semibold))
          .foregroundStyle(.primary)
          .lineLimit(1)
        Text(host)
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 8)
    .frame(height: 40)
    .widgetPill(cornerRadius: 12)
  }
}

/// The bar and the rows: nearly opaque, so they read on any part of the
/// wallpaper.
private struct WidgetPill: ViewModifier {
  let cornerRadius: CGFloat?
  @Environment(\.colorScheme) private var colorScheme

  func body(content: Content) -> some View {
    let fill = colorScheme == .dark ? Color(white: 0.11).opacity(0.88) : Color.white.opacity(0.92)
    return content.background {
      if let cornerRadius {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).fill(fill)
      } else {
        Capsule().fill(fill)
      }
    }
  }
}

private extension View {
  func widgetPill(cornerRadius: CGFloat? = nil) -> some View {
    modifier(WidgetPill(cornerRadius: cornerRadius))
  }
}
