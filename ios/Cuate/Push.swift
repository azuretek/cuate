import FirebaseCore
import FirebaseMessaging
import Foundation
import UIKit

/// Push notifications with the app closed (issue 347, docs/push.md). The phone gets a Firebase push token for itself
/// and makes a 32-byte key once; the page hands both to its own server, which seals each notification with the key, so
/// the relay, Firebase and Apple carry only bytes they cannot read. The notification service extension opens them with
/// the same key, which is why it lives in the Keychain group the app and the extension share.
final class Push: NSObject, MessagingDelegate {
    static let shared = Push()

    /// The key the extension reads too; the account names it within the shared group.
    static let keyAccount = "push.key"

    private let lock = NSLock()
    private var token: String?
    private var waiters: [(String?) -> Void] = []
    private var configured = false

    /// Called at launch: Firebase reads the bundled GoogleService-Info.plist. A build without one (a fork that has not
    /// set up its own project) runs without push rather than failing to start.
    func configure() {
        guard !configured, Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil else { return }
        FirebaseApp.configure()
        Messaging.messaging().delegate = self
        configured = true
    }

    /// The APNs token Apple gave the app, handed to Firebase, which maps it to the push token the relay sends to.
    func apnsToken(_ data: Data) {
        guard configured else { return }
        Messaging.messaging().apnsToken = data
    }

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        lock.lock()
        token = fcmToken
        let pending = waiters
        waiters = []
        lock.unlock()
        pending.forEach { $0(fcmToken) }
    }

    /// The registration the page sends its server: the push token, the platform and the key, or nil when push cannot
    /// work here (no Firebase config, notifications not allowed, or no token within the wait).
    func registration(store: KeychainSecureStore, done: @escaping ([String: Any]?) -> Void) {
        guard configured else { done(nil); return }
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: break
            default: done(nil); return
            }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
            self.waitForToken(seconds: 15) { token in
                guard let token, let key = Self.key(store: store) else { done(nil); return }
                done(["token": token, "platform": "ios", "key": key])
            }
        }
    }

    private func waitForToken(seconds: Double, done: @escaping (String?) -> Void) {
        lock.lock()
        if let token { lock.unlock(); done(token); return }
        var settled = false
        let once: (String?) -> Void = { value in
            DispatchQueue.main.async {
                guard !settled else { return }
                settled = true
                done(value)
            }
        }
        waiters.append(once)
        lock.unlock()
        // Firebase may already hold a token from an earlier launch; asking for it settles the wait without a delegate call.
        Messaging.messaging().token { value, _ in if let value { once(value) } }
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { once(nil) }
    }

    /// The phone's key, made once and kept. 32 random bytes, base64url, as the server expects.
    static func key(store: KeychainSecureStore) -> String? {
        if let existing = store.get(keyAccount), !existing.isEmpty { return existing }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        let value = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        return store.set(keyAccount, value) ? value : nil
    }
}

/// The application delegate SwiftUI keeps, for the one thing it has no other way to hear: Apple's device token.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Push.shared.configure()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Push.shared.apnsToken(deviceToken)
    }
}
