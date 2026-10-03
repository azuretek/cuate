import Foundation
import UIKit
import UserNotifications
import WebKit

/// The shell's half of core/spec/host-bridge.json.
///
/// Every command a page may call lives in that spec and the shell refuses
/// anything else, so a platform difference is data in the spec rather than a
/// branch in core. The page reaches this through window.bridge.call, which the
/// injected script below installs; a reply is a call back into the page, so the
/// protocol is one message in and one JavaScript call out.
final class HostBridge: NSObject, WKScriptMessageHandler {
    /// The name the injected script posts under.
    static let messageName = "cuateBridge"

    /// The hook the shell calls to settle a pending call.
    static let resolveHook = "__cuateResolve"

    /// Storage keys are lower-case words joined by dots, the same shape the
    /// desktop enforces, so a key is a name and not an arbitrary string.
    private static let keyPattern = "^[a-z][a-z0-9.]{0,63}$"

    weak var webView: WKWebView?

    /// Keeps the web view on the system's scheme while the window shows the page's; registered on the first call.
    private var systemObserver: UITraitChangeRegistration?

    private let store: KeychainSecureStore
    private let commands: Set<String>

    init(store: KeychainSecureStore, commands: Set<String>) {
        self.store = store
        self.commands = commands
    }

    /// The command names the bundled spec declares.
    static func commandNames() -> Set<String> {
        guard let data = try? BundledSpec.data(at: "spec/host-bridge.json"),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let commands = object["commands"] as? [String: Any] else {
            return []
        }
        return Set(commands.keys)
    }

    /// The document-start script that installs window.bridge over the message
    /// handler. Installed before the page boots, because the page calls
    /// window.bridge during its own first render.
    static var injectedScript: String {
        var script = "(function () {\n"
        script += "  if (window.bridge) { return; }\n"
        script += "  window.__cuatePending = {};\n"
        script += "  window.__cuateSeq = 0;\n"
        script += "  window.\(resolveHook) = function (payload) {\n"
        script += "    var pending = window.__cuatePending[payload.id];\n"
        script += "    if (!pending) { return; }\n"
        script += "    delete window.__cuatePending[payload.id];\n"
        script += "    if (payload.ok) { pending.resolve(payload.value); }\n"
        script += "    else { pending.reject(new Error(String(payload.value))); }\n"
        script += "  };\n"
        script += "  window.bridge = {\n"
        script += "    call: function (name, args) {\n"
        script += "      return new Promise(function (resolve, reject) {\n"
        script += "        var id = String(++window.__cuateSeq);\n"
        script += "        window.__cuatePending[id] = { resolve: resolve, reject: reject };\n"
        script += "        window.webkit.messageHandlers.\(messageName).postMessage({ id: id, name: name, args: args || {} });\n"
        script += "      });\n"
        script += "    }\n"
        script += "  };\n"
        script += "})();\n"
        return script
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.messageName,
              let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let name = body["name"] as? String else { return }
        let args = body["args"] as? [String: Any] ?? [:]
        dispatch(id: id, name: name, args: args)
    }

    private func dispatch(id: String, name: String, args: [String: Any]) {
        guard commands.contains(name) else {
            settle(id: id, ok: false, value: "undeclared bridge command: " + name)
            return
        }
        switch name {
        case "storage.get":
            settle(id: id, ok: true, value: storageGet(args))
        case "storage.set":
            settle(id: id, ok: true, value: storageSet(args))
        case "storage.delete":
            settle(id: id, ok: true, value: storageDelete(args))
        case "app.info":
            settle(id: id, ok: true, value: appInfo())
        case "notify":
            settle(id: id, ok: true, value: notify(args))
        case "open.external":
            settle(id: id, ok: true, value: openExternal(args))
        case "updates.configure":
            // No self-updater on iOS, so there is nothing to configure, download or install; each answers false and
            // the page offers no action. The one bridge spec still declares them for the desktop.
            settle(id: id, ok: true, value: false)
        case "updates.download":
            settle(id: id, ok: true, value: false)
        case "updates.install":
            settle(id: id, ok: true, value: false)
        // A phone has no window to minimise, maximise or close, so the window commands answer false and the bar is
        // never drawn; the one bridge spec still declares them for the desktop.
        case "window.minimize":
            settle(id: id, ok: true, value: false)
        case "window.toggleMaximize":
            settle(id: id, ok: true, value: false)
        case "window.close":
            settle(id: id, ok: true, value: false)
        // The status bar draws over the page's colours, so its icons follow the page's scheme rather than the system's.
        case "window.appearance":
            settle(id: id, ok: true, value: appearance(args))
        default:
            settle(id: id, ok: false, value: "undeclared bridge command: " + name)
        }
    }

    /// Dark icons on a light page and light icons on a dark one, over the page's own fill, so the clock and the battery
    /// stay readable in either scheme. The page's choice wins over the system's, since it may differ.
    ///
    /// The status bar takes its style from the window, but the page reads the system's scheme from its web view, and a
    /// page that follows the system must keep seeing the system's. So the window takes the page's scheme and the web
    /// view keeps the scene's own, which a window's override never reaches, updated whenever the system's changes.
    private func appearance(_ args: [String: Any]) -> Bool {
        guard let webView, let window = webView.window, let scene = window.windowScene else { return false }
        let dark = (args["scheme"] as? String) == "dark"
        window.overrideUserInterfaceStyle = dark ? .dark : .light
        webView.overrideUserInterfaceStyle = scene.traitCollection.userInterfaceStyle
        if systemObserver == nil {
            systemObserver = scene.registerForTraitChanges([UITraitUserInterfaceStyle.self]) { [weak self] (scene: UIWindowScene, _: UITraitCollection) in
                self?.webView?.overrideUserInterfaceStyle = scene.traitCollection.userInterfaceStyle
            }
        }
        if let fill = Self.color(args["background"] as? String) {
            webView.backgroundColor = fill
            webView.scrollView.backgroundColor = fill
            webView.underPageBackgroundColor = fill
        }
        return true
    }

    /// A #rrggbb colour, the form the tokens write; anything else leaves the fill as it was.
    static func color(_ text: String?) -> UIColor? {
        guard let text, text.count == 7, text.hasPrefix("#"), let value = UInt32(text.dropFirst(), radix: 16) else { return nil }
        return UIColor(red: CGFloat((value >> 16) & 0xff) / 255, green: CGFloat((value >> 8) & 0xff) / 255,
                       blue: CGFloat(value & 0xff) / 255, alpha: 1)
    }

    private func storageGet(_ args: [String: Any]) -> Any {
        guard let key = validKey(args) else { return NSNull() }
        return store.get(key) ?? NSNull()
    }

    private func storageSet(_ args: [String: Any]) -> Bool {
        guard let key = validKey(args), let value = args["value"] as? String, value.utf8.count <= 8192 else { return false }
        return store.set(key, value)
    }

    private func storageDelete(_ args: [String: Any]) -> Bool {
        guard let key = validKey(args) else { return false }
        return store.delete(key)
    }

    private func validKey(_ args: [String: Any]) -> String? {
        guard let key = args["key"] as? String else { return nil }
        return key.range(of: Self.keyPattern, options: .regularExpression) != nil ? key : nil
    }

    private func appInfo() -> [String: Any] {
        return [
            "product": Naming.product,
            "version": Naming.buildVersion,
            "platform": "ios",
        ]
    }

    private func notify(_ args: [String: Any]) -> Bool {
        let title = String((args["title"] as? String ?? "").prefix(200))
        let body = String((args["body"] as? String ?? "").prefix(500))
        guard !title.isEmpty else { return false }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        // Authorization is asked for on the first notification rather than at
        // launch, so a fresh install is not greeted by a permission dialog
        // before it has drawn anything.
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        center.add(request)
        return true
    }

    private func openExternal(_ args: [String: Any]) -> Bool {
        guard let text = args["url"] as? String, let url = URL(string: text),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            return false
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url)
        }
        return true
    }

    /// Settle the page's pending call. The whole payload is one JSON object, so
    /// a value that is nil, a string, a bool or a dictionary travels the same
    /// way and the page's resolver has one shape to read.
    private func settle(id: String, ok: Bool, value: Any) {
        let payload: [String: Any] = ["id": id, "ok": ok, "value": value]
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.\(Self.resolveHook) && window.\(Self.resolveHook)(\(json));")
    }
}
