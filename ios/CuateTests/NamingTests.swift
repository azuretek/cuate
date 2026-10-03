import XCTest
@testable import Cuate

/// The shell's half of the parity the repository holds every client to: the
/// values it reads at runtime are the repository's, and the commands the bridge
/// answers are exactly the ones core/spec/host-bridge.json declares.
final class NamingTests: XCTestCase {
    func testTheProductNameComesFromTheRepositorySpec() {
        XCTAssertEqual(Naming.product, "Cuate")
        XCTAssertEqual(Naming.storeName, "Cuate Chat")
    }

    func testTheBundleIdentifierIsTheIosIdFromTheSpec() {
        XCTAssertEqual(Naming.bundleIdentifier, "com.azuretek.cuate")
    }

    func testTheBridgeAnswersExactlyTheHostBridgeSpec() {
        let declared: Set<String> = ["storage.get", "storage.set", "storage.delete", "app.info", "notify", "open.external", "updates.check", "updates.releases", "updates.configure", "updates.download", "updates.install", "window.minimize", "window.toggleMaximize", "window.close", "window.appearance", "icon.redraw"]
        XCTAssertEqual(HostBridge.commandNames(), declared)
    }

    // Issue 192: the build About shows, and the build the update check compares, come from the bundle.
    func testTheChannelFollowsTheVersionAndTheBuildIsTheBundleVersion() {
        XCTAssertEqual(BuildIdentity.channel(of: "0.0.1-dev.98.7699911abc"), "dev")
        XCTAssertEqual(BuildIdentity.channel(of: "1.0.0"), "stable")
        XCTAssertEqual(BuildIdentity.build, Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String)
        XCTAssertFalse(BuildIdentity.build.isEmpty, "a build always carries a build number")
    }

    // The feed and TestFlight's addresses are core/spec/releases.json's, so the shell holds no copy of either.
    func testTheReleaseFeedIsTheRepositorysPublicFeed() {
        XCTAssertEqual(Releases.feedURL?.absoluteString, "https://github.com/" + Naming.repo + "/releases.atom")
        XCTAssertNil(Releases.fill("{repo}/{missing}", ["repo": "a/b"]), "a half-filled address is never fetched")
    }

    func testTheFeedIsReadThroughTheFetchItIsGiven() async throws {
        let body = try await Releases.readFeed(fetch: { url in
            XCTAssertEqual(url, Releases.feedURL)
            return Data("<feed></feed>".utf8)
        })
        XCTAssertEqual(body, "<feed></feed>")
    }

    // TestFlight link: TestFlight's own scheme first, and its App Store page only when nothing claimed the scheme.
    @MainActor
    func testTestFlightOpensTheAppFirstAndFallsBackToItsStorePage() async {
        var tried: [String] = []
        let opened = await TestFlight.open { url in tried.append(url.absoluteString); return true }
        XCTAssertEqual(opened?.absoluteString, "itms-beta://")
        XCTAssertEqual(tried, ["itms-beta://"])
        tried = []
        let fallback = await TestFlight.open { url in tried.append(url.absoluteString); return url.scheme == "https" }
        XCTAssertEqual(fallback?.absoluteString, "https://apps.apple.com/app/testflight/id899247664")
        XCTAssertEqual(tried, ["itms-beta://", "https://apps.apple.com/app/testflight/id899247664"])
        let none = await TestFlight.open { _ in false }
        XCTAssertNil(none)
    }

    func testTheEngineBundleIsBundledAndDefinesItsGlobal() {
        XCTAssertTrue(Engine.makeContext() != nil, "build/engine.js must be copied in and define the engine global")
    }
}
