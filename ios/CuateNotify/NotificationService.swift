import CryptoKit
import Foundation
import UserNotifications

/// Opens a sealed push notification (issue 347, docs/push.md). The server sealed it with AES-256-GCM under the key this
/// phone made, as base64url of the 12-byte nonce, the ciphertext and the 16-byte tag, which is CryptoKit's combined
/// form. The key is read from the Keychain group the app shares with this extension. What arrives readable is only a
/// placeholder; a notification that cannot be opened is shown as that placeholder rather than dropped.
final class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var content: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        handler = contentHandler
        let mutable = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        content = mutable
        if let notice = Self.open(request.content.userInfo, key: SharedKey.read()) {
            mutable.title = notice.title
            mutable.body = notice.body
            mutable.threadIdentifier = notice.chatId
            // The keys the app's notice router reads, so a tap opens the conversation (issue 331).
            mutable.userInfo["chatId"] = notice.chatId
            mutable.userInfo["messageId"] = notice.messageId
        }
        mutable.userInfo["sealed"] = nil
        contentHandler(mutable)
    }

    override func serviceExtensionTimeWillExpire() {
        if let handler, let content { handler(content) }
    }

    struct Notice: Decodable {
        let v: Int
        let chatId: String
        let messageId: String
        let title: String
        let body: String
    }

    static func open(_ info: [AnyHashable: Any], key: String?) -> Notice? {
        guard let key, let keyData = base64url(key), keyData.count == 32,
              let sealed = info["sealed"] as? String, let bytes = base64url(sealed), bytes.count > 28,
              let box = try? AES.GCM.SealedBox(combined: bytes),
              let plain = try? AES.GCM.open(box, using: SymmetricKey(data: keyData)),
              let notice = try? JSONDecoder().decode(Notice.self, from: plain), notice.v == 1 else { return nil }
        return notice
    }

    static func base64url(_ text: String) -> Data? {
        var s = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        return Data(base64Encoded: s)
    }
}

/// The phone's push key, from the Keychain group the app and this extension share. The service is the app's bundle id,
/// the one KeychainSecureStore uses, read from this extension's own Info.plist so no id is spelled here.
enum SharedKey {
    static func read() -> String? {
        guard let service = Bundle.main.object(forInfoDictionaryKey: "CuateAppBundleID") as? String else { return nil }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "push.key",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
