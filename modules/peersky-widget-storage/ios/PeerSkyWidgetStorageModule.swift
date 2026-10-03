import ExpoModulesCore
import WidgetKit

// What the home screen widgets show, left in the App Group both the app and
// targets/widgets belong to. JavaScript writes small JSON strings
// (app/widgets.ts) and reloads the widget whose data changed.
public class PeerSkyWidgetStorageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PeerSkyWidgetStorage")

    Function("getString") { (group: String, key: String) -> String? in
      UserDefaults(suiteName: group)?.string(forKey: key)
    }

    Function("setString") { (group: String, key: String, value: String) in
      UserDefaults(suiteName: group)?.set(value, forKey: key)
    }

    Function("reload") { (kind: String) in
      WidgetCenter.shared.reloadTimelines(ofKind: kind)
    }
  }
}
