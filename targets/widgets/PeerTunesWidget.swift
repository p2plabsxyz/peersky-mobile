import SwiftUI
import UIKit
import WidgetKit

// What PeerTunes is playing. Small is the cover with the song on it; medium
// lays the cover beside the song with the buttons under it. A tap anywhere
// else opens PeerTunes.

struct PeerTunesEntry: TimelineEntry {
  let date: Date
  let nowPlaying: PeerSkyWidgetStore.NowPlaying?
  let artwork: UIImage?
}

struct PeerTunesProvider: TimelineProvider {
  func placeholder(in context: Context) -> PeerTunesEntry {
    PeerTunesEntry(date: .now, nowPlaying: nil, artwork: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (PeerTunesEntry) -> Void) {
    completion(entry())
  }

  // The app reloads this when the song or whether it plays changes.
  func getTimeline(in context: Context, completion: @escaping (Timeline<PeerTunesEntry>) -> Void) {
    completion(Timeline(entries: [entry()], policy: .never))
  }

  private func entry() -> PeerTunesEntry {
    PeerTunesEntry(
      date: .now,
      nowPlaying: PeerSkyWidgetStore.nowPlaying(),
      artwork: PeerSkyWidgetStore.artwork().flatMap { UIImage(data: $0) }
    )
  }
}

struct PeerTunesWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: PeerSkyWidgetStore.peerTunesKind, provider: PeerTunesProvider()) { entry in
      PeerTunesWidgetView(entry: entry)
    }
    .configurationDisplayName("PeerTunes")
    .description("What is playing. The medium size has the controls.")
    .supportedFamilies([.systemSmall, .systemMedium])
    .contentMarginsDisabled()
  }
}

struct PeerTunesWidgetView: View {
  let entry: PeerTunesEntry
  @Environment(\.widgetFamily) private var family

  // The colours of PeerTunes' own blank cover (assets/peertunes).
  private static let blankCover = [
    Color(red: 0.204, green: 0.227, blue: 0.267),
    Color(red: 0.071, green: 0.078, blue: 0.098)
  ]

  private var song: PeerSkyWidgetStore.NowPlaying? {
    guard let nowPlaying = entry.nowPlaying, !nowPlaying.title.isEmpty else { return nil }
    return nowPlaying
  }

  var body: some View {
    Group {
      if family == .systemMedium {
        medium
      } else {
        small
      }
    }
    .widgetURL(WidgetLinks.peerTunes)
    .containerBackground(for: .widget) { background }
  }

  @ViewBuilder
  private var background: some View {
    if family == .systemSmall, let artwork = entry.artwork {
      Image(uiImage: artwork).resizable().scaledToFill()
    } else {
      LinearGradient(
        colors: entry.artwork?.peerTunesTint ?? Self.blankCover,
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    }
  }

  private var small: some View {
    ZStack(alignment: .bottomLeading) {
      if entry.artwork != nil {
        LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom)
      }
      VStack(alignment: .leading, spacing: 2) {
        HStack {
          Image("PeerTunesIcon")
            .resizable()
            .frame(width: 24, height: 24)
            .shadow(color: .black.opacity(0.3), radius: 2, y: 1)
          Spacer(minLength: 0)
          if song?.playing == true {
            Image(systemName: "waveform")
              .font(.system(size: 13, weight: .bold))
              .foregroundStyle(.white)
              .shadow(color: .black.opacity(0.4), radius: 2)
          }
        }
        Spacer(minLength: 0)
        Text(song?.title ?? "Nothing playing")
          .font(.system(size: 15, weight: .bold))
          .foregroundStyle(.white)
          .lineLimit(2)
        Text(song.map(subtitle) ?? "Tap to open PeerTunes")
          .font(.system(size: 12))
          .foregroundStyle(.white.opacity(0.8))
          .lineLimit(1)
      }
      .padding(14)
    }
  }

  private var medium: some View {
    HStack(spacing: 14) {
      cover
        .frame(width: 118, height: 118)
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Image("PeerTunesIcon")
            .resizable()
            .frame(width: 16, height: 16)
          Text(status)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.white.opacity(0.75))
            .textCase(.uppercase)
        }
        Text(song?.title ?? "Nothing playing")
          .font(.system(size: 16, weight: .bold))
          .foregroundStyle(.white)
          .lineLimit(2)
        Text(song.map(subtitle) ?? "Tap to open PeerTunes")
          .font(.system(size: 13))
          .foregroundStyle(.white.opacity(0.8))
          .lineLimit(1)
        Spacer(minLength: 0)
        if let song, song.live {
          controls(playing: song.playing)
        } else if song != nil {
          // The buttons need PeerTunes open to play anything.
          Text("Tap to open PeerTunes")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.white.opacity(0.7))
        }
      }
      Spacer(minLength: 0)
    }
    .padding(14)
  }

  private var cover: some View {
    Group {
      if let artwork = entry.artwork {
        Image(uiImage: artwork).resizable().scaledToFill()
      } else {
        ZStack {
          LinearGradient(colors: Self.blankCover, startPoint: .topLeading, endPoint: .bottomTrailing)
          Image(systemName: "music.note")
            .font(.system(size: 38, weight: .semibold))
            .foregroundStyle(.white.opacity(0.55))
        }
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    .shadow(color: .black.opacity(0.3), radius: 6, y: 3)
  }

  private func controls(playing: Bool) -> some View {
    HStack(spacing: 0) {
      Button(intent: PeerTunesPreviousIntent()) {
        controlIcon("backward.fill", size: 18)
      }
      .accessibilityLabel("Previous song")
      if playing {
        Button(intent: PeerTunesPauseIntent()) {
          controlIcon("pause.fill", size: 24)
        }
        .accessibilityLabel("Pause")
      } else {
        Button(intent: PeerTunesPlayIntent()) {
          controlIcon("play.fill", size: 24)
        }
        .accessibilityLabel("Play")
      }
      Button(intent: PeerTunesNextIntent()) {
        controlIcon("forward.fill", size: 18)
      }
      .accessibilityLabel("Next song")
    }
    .buttonStyle(.plain)
  }

  private func controlIcon(_ name: String, size: CGFloat) -> some View {
    Image(systemName: name)
      .font(.system(size: size, weight: .semibold))
      .foregroundStyle(.white)
      .frame(width: 48, height: 40)
      .contentShape(Rectangle())
  }

  private var status: String {
    guard let song else { return "PeerTunes" }
    if song.playing { return "Now playing" }
    return song.live ? "Paused" : "Last played"
  }

  private func subtitle(_ song: PeerSkyWidgetStore.NowPlaying) -> String {
    [song.artist, song.album].filter { !$0.isEmpty }.joined(separator: " · ")
  }
}

private extension UIImage {
  /// Two shades of the cover's own colour to sit behind it, dark enough for
  /// white text whatever the cover.
  var peerTunesTint: [Color]? {
    guard let cgImage else { return nil }
    let side = 8
    var pixels = [UInt8](repeating: 0, count: side * side * 4)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
      guard let context = CGContext(
        data: buffer.baseAddress,
        width: side,
        height: side,
        bitsPerComponent: 8,
        bytesPerRow: side * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      ) else { return false }
      context.interpolationQuality = .medium
      context.draw(cgImage, in: CGRect(x: 0, y: 0, width: side, height: side))
      return true
    }
    guard drawn else { return nil }

    var red = 0.0
    var green = 0.0
    var blue = 0.0
    for index in stride(from: 0, to: pixels.count, by: 4) {
      red += Double(pixels[index])
      green += Double(pixels[index + 1])
      blue += Double(pixels[index + 2])
    }
    let count = Double(side * side) * 255
    let average = (red / count, green / count, blue / count)
    return [
      Color(red: average.0 * 0.55, green: average.1 * 0.55, blue: average.2 * 0.55),
      Color(red: average.0 * 0.25, green: average.1 * 0.25, blue: average.2 * 0.25)
    ]
  }
}
