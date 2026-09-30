import Foundation

/// What this product is called, read from core/spec/naming.json at runtime.
///
/// The same file is what the desktop reads, so the two interfaces cannot
/// disagree about what the app is called or which ids it owns. A name is a
/// string, and a string that decides what a home screen says is worth no
/// cleverness at all, so this holds no logic beyond the read.
enum Naming {
    private struct Spec: Decodable {
        struct Ids: Decodable {
            let ios: String
            let android: String
            let desktop: String
            let server: String
        }

        let product: String
        let storeName: String
        let slug: String
        let repo: String
        let ids: Ids
    }

    /// The top-level keys this decodes. Decoding a subset in silence is how a
    /// client ends up knowing less than the file says, so the test asserts the
    /// two sets are equal.
    static let decodedKeys: Set<String> = ["description", "product", "storeName", "slug", "repo", "ids"]

    private static let spec: Spec? = try? BundledSpec.load("spec/naming.json", as: Spec.self)

    /// What a person calls this app, and what the home screen, the app switcher
    /// and notification titles show. Info.plist carries the same value for both
    /// of its name keys, and the test asserts that against this.
    static var product: String { spec?.product ?? "" }

    /// The formal name for the App Store record, where a unique string is
    /// required. No surface in the app prints it.
    static var storeName: String { spec?.storeName ?? "" }

    /// The bundle id for this platform, which owns the App Store record, the
    /// provisioning profile and the Keychain service.
    static var bundleIdentifier: String { spec?.ids.ios ?? "" }

    static var repo: String { spec?.repo ?? "" }

    /// The app's own identity for this build, read from the bundle rather than
    /// written twice: the release workflow derives the value and project.yml
    /// names the setting it arrives in. The full identity rather than
    /// CFBundleShortVersionString, because that one is trimmed to the three
    /// integers App Store Connect accepts and so cannot name a dev build.
    static var buildVersion: String {
        if let identity = Bundle.main.object(forInfoDictionaryKey: "CuateBuildVersion") as? String,
           !identity.isEmpty, !identity.hasPrefix("$(") {
            return identity
        }
        return Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }
}
