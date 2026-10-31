import SwiftUI
import WidgetKit

// The lock screen buttons, as DuckDuckGo has them. Each opens PeerSky and does
// its one thing straight away (app/index.tsx), Burn and Clear all P2P data
// without asking first. Only the picture shows, on the lock screen's own
// glass, which iOS tints to suit the wallpaper.

struct LockScreenEntry: TimelineEntry {
  let date: Date
}

// Nothing on them ever changes.
struct LockScreenProvider: TimelineProvider {
  func placeholder(in context: Context) -> LockScreenEntry {
    LockScreenEntry(date: .now)
  }

  func getSnapshot(in context: Context, completion: @escaping (LockScreenEntry) -> Void) {
    completion(LockScreenEntry(date: .now))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<LockScreenEntry>) -> Void) {
    completion(Timeline(entries: [LockScreenEntry(date: .now)], policy: .never))
  }
}

/// The incognito hat and glasses of the app's Incognito button.
struct PrivateSearchLockScreenWidget: Widget {
  var body: some WidgetConfiguration {
    lockScreenButton(kind: "PeerSkyPrivateSearch", link: WidgetLinks.privateSearch, label: "Private search") {
      AppIcon(name: "IncognitoIcon")
    }
    .configurationDisplayName("Private search")
    .description("Opens an incognito tab, ready to search.")
  }
}

/// The flame of the app's Burn button.
struct BurnLockScreenWidget: Widget {
  var body: some WidgetConfiguration {
    lockScreenButton(kind: "PeerSkyBurn", link: WidgetLinks.burn, label: "Burn Tabs and Data") {
      AppIcon(name: "FireIcon")
    }
    .configurationDisplayName("Burn Tabs and Data")
    .description("Burns your tabs, history and cached data right away.")
  }
}

/// The app's Bookmarks button.
struct BookmarksLockScreenWidget: Widget {
  var body: some WidgetConfiguration {
    lockScreenButton(kind: "PeerSkyBookmarks", link: WidgetLinks.bookmarks, label: "Bookmarks") {
      AppIcon(name: "BookmarksIcon")
    }
    .configurationDisplayName("Bookmarks")
    .description("Opens your bookmarks.")
  }
}

/// Three peers joined to each other. The app has no picture of its own for
/// P2P sites.
struct P2PSitesLockScreenWidget: Widget {
  var body: some WidgetConfiguration {
    lockScreenButton(kind: "PeerSkyP2PSites", link: WidgetLinks.p2pSites, label: "P2P sites") {
      Image(systemName: "point.3.connected.trianglepath.dotted")
        .font(.system(size: 28, weight: .medium))
    }
    .configurationDisplayName("P2P sites")
    .description("Opens the list of hyper:// sites you have opened")
  }
}

/// The trash can of the app's delete buttons.
struct ClearP2PDataLockScreenWidget: Widget {
  var body: some WidgetConfiguration {
    lockScreenButton(kind: "PeerSkyClearP2PData", link: WidgetLinks.clearP2PData, label: "Clear all P2P data") {
      AppIcon(name: "TrashIcon")
    }
    .configurationDisplayName("Clear all P2P data")
    .description("Clears all P2P data and this device's identity right away, without asking.")
  }
}

private func lockScreenButton<Icon: View>(
  kind: String,
  link: URL,
  label: LocalizedStringKey,
  @ViewBuilder icon: @escaping () -> Icon
) -> some WidgetConfiguration {
  StaticConfiguration(kind: kind, provider: LockScreenProvider()) { _ in
    ZStack {
      AccessoryWidgetBackground()
      icon()
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(label))
    .widgetURL(link)
    .containerBackground(for: .widget) { Color.clear }
  }
  .supportedFamilies([.accessoryCircular])
}

/// One of the app's own Bootstrap icons (assets/icons/bootstrap), copied into
/// Assets.xcassets. Drawn as a template, so the lock screen tints it like a
/// symbol.
private struct AppIcon: View {
  let name: String

  var body: some View {
    Image(name)
      .renderingMode(.template)
      .resizable()
      .scaledToFit()
      .frame(width: 28, height: 28)
  }
}
