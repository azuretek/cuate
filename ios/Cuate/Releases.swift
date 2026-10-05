import Foundation
import UIKit

/// Where a newer build of this app is learned of and installed from (issue 192), read from core/spec/releases.json.
///
/// The sibling app's strategy, copied: the phone reads the repository's public release feed, which needs no credential
/// and carries no rate limit, and the page decides whether the newest build on this build's channel is newer than the
/// running one (core/app/rules/updates.js). Every published test build passed the platforms gate, so the feed's newest
/// build is the newest one TestFlight can install. When it is newer, the notice's action opens TestFlight.
enum Releases {
    struct Spec: Decodable {
        struct TestFlight: Decodable {
            let app: String
            let store: String
        }

        let feed: String
        let testflight: TestFlight
    }

    static let spec: Spec? = try? BundledSpec.load("spec/releases.json", as: Spec.self)

    /// A template from the spec with its {names} filled in, or nil when one is missing, so a half-filled address is
    /// never fetched. The same rule as fillTemplate in core/app/rules/updates.js.
    static func fill(_ template: String, _ values: [String: String]) -> String? {
        var out = template
        for (key, value) in values { out = out.replacingOccurrences(of: "{" + key + "}", with: value) }
        return out.contains("{") ? nil : out
    }

    static var feedURL: URL? {
        guard let spec, !Naming.repo.isEmpty, let text = fill(spec.feed, ["repo": Naming.repo]) else { return nil }
        return URL(string: text)
    }

    /// How the feed is read. Injected so a test reads a fixture with no network, and so the real one is the only thing
    /// that touches it.
    typealias Fetch = (URL) async throws -> Data

    /// A plain GET that reads what is published now rather than a body cached from the last check.
    static func urlSessionFetch(_ url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        return data
    }

    /// The feed's body, for the page to decide from.
    static func readFeed(fetch: Fetch = urlSessionFetch) async throws -> String {
        guard let url = feedURL else { throw URLError(.badURL) }
        let data = try await fetch(url)
        guard let text = String(data: data, encoding: .utf8) else { throw URLError(.cannotDecodeContentData) }
        return text
    }
}

/// The one action that leaves this app for an update: send the reader into TestFlight, where the newer build is
/// installed. As in the sibling app, TestFlight's own scheme is opened first and the answer is read rather than probed
/// for (a canOpenURL probe would need the scheme declared as a query scheme); when nothing claims it, TestFlight's App
/// Store page is the fallback, the one page a person without TestFlight can act from.
@MainActor
enum TestFlight {
    typealias Open = @MainActor (URL) async -> Bool

    static var appURL: URL? { Releases.spec.flatMap { URL(string: $0.testflight.app) } }
    static var storeURL: URL? { Releases.spec.flatMap { URL(string: $0.testflight.store) } }

    static func systemOpen(_ url: URL) async -> Bool {
        await UIApplication.shared.open(url)
    }

    /// The URL that was accepted, or nil when neither was, which is logged rather than swallowed.
    @discardableResult
    static func open(_ opener: Open = systemOpen) async -> URL? {
        for url in [appURL, storeURL].compactMap({ $0 }) {
            if await opener(url) { return url }
        }
        NSLog("[cuate] neither TestFlight nor its App Store page could be opened")
        return nil
    }
}

/// The running build's channel and build number, read from the bundle (issue 192), so About shows both rather than
/// Unknown and the update check compares the build that is actually installed.
enum BuildIdentity {
    /// A test build names itself X.Y.Z-dev.<count>.<commit>; a version with no prerelease part is a stable one. The
    /// same split as channelOf in core/kit/rules/build.js.
    static func channel(of version: String) -> String {
        version.contains("-") ? "dev" : "stable"
    }

    /// CFBundleVersion: the release workflow sets it to the commit count, the number TestFlight lists the build under.
    static var build: String {
        let value = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        return value.hasPrefix("$(") ? "" : value
    }
    /// The architecture this build runs on, so About names it rather than Unknown.
    static var arch: String {
        #if arch(arm64)
        return "arm64"
        #elseif arch(x86_64)
        return "x86_64"
        #else
        return ""
        #endif
    }

    /// Whether this copy was installed (a release build) rather than run from source (a Debug build), so About reports
    /// how the copy was obtained on every platform.
    static var packaged: Bool {
        #if DEBUG
        return false
        #else
        return true
        #endif
    }

    /// How this copy was obtained: TestFlight signs a sandbox receipt, the App Store a production one, and a Debug run
    /// from Xcode none. A release build with no receipt yet (before the first refresh) reads as the App Store, which is
    /// where a receipted copy came from anyway.
    static var installSource: String {
        #if DEBUG
        return "source"
        #else
        guard let url = Bundle.main.appStoreReceiptURL else { return "App Store" }
        return url.lastPathComponent == "sandboxReceipt" ? "TestFlight" : "App Store"
        #endif
    }
}
