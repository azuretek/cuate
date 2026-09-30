import Foundation
import Security

/// The shell's secure storage: a small Keychain-backed store for the values the
/// page keeps through the host bridge (the server URL, the device token).
///
/// The device token and the cache key never leave the Keychain in the clear,
/// which is why the shell owns this rather than letting the page keep them in
/// localStorage: a WKWebView wipes localStorage on uninstall and the values are
/// worth keeping across one.
final class KeychainSecureStore {
    private let service: String

    init(service: String) {
        self.service = service
    }

    func get(_ key: String) -> String? {
        var query = base(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// True when the value was written. A Keychain the simulator cannot unlock
    /// returns false rather than throwing, so the page degrades to a session
    /// value instead of failing to boot.
    func set(_ key: String, _ value: String) -> Bool {
        let data = Data(value.utf8)
        var query = base(key)
        let attributes: [String: Any] = [kSecValueData as String: data]
        let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if update == errSecSuccess { return true }
        guard update == errSecItemNotFound else { return false }
        query.merge(attributes) { _, new in new }
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    func delete(_ key: String) -> Bool {
        let status = SecItemDelete(base(key) as CFDictionary)
        return status == errSecSuccess
    }

    private func base(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }
}
