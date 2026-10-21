import Foundation
import UserNotifications

/// Where a pressed message notice leads (issue 331). The system tells this delegate about a press, including the one
/// that launched the app, which arrives before the page or its bridge exists; the target is held until the page takes
/// it with notify.take, and a page already running is told through notify.opened to take it now.
final class NoticeRouter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NoticeRouter()

    /// The bridge of the page on screen, set when it is made.
    weak var bridge: HostBridge?

    private let lock = NSLock()
    private var pressed: [String: Any]?

    /// The target a notice is raised with, from the page's notify arguments: plain string ids, or nil.
    static func target(_ args: [String: Any]) -> [String: Any]? {
        func id(_ value: Any?) -> String? {
            guard let text = value as? String, !text.isEmpty, text.count <= 200 else { return nil }
            return text
        }
        guard let chat = id(args["chatId"]) else { return nil }
        var target: [String: Any] = ["chatId": chat]
        target["messageId"] = id(args["messageId"]) ?? NSNull()
        return target
    }

    /// The press held for the page, cleared as it is taken.
    func take() -> [String: Any]? {
        lock.lock()
        defer { lock.unlock() }
        let target = pressed
        pressed = nil
        return target
    }

    func hold(_ target: [String: Any]) {
        lock.lock()
        pressed = target
        lock.unlock()
        bridge?.emit("notify.opened")
    }

    // Registered phones use the remote notice even with the app open. Without this delegate iOS silently drops
    // foreground notices. Local notices use the same presentation path when push is unavailable.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        var args: [String: Any] = [:]
        for (key, value) in info { if let key = key as? String { args[key] = value } }
        if let target = Self.target(args) { hold(target) }
        completionHandler()
    }
}
