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
        let declared: Set<String> = ["storage.get", "storage.set", "storage.delete", "app.info", "notify", "open.external", "updates.check", "updates.configure", "updates.download", "updates.install", "window.minimize", "window.toggleMaximize", "window.close", "window.appearance"]
        XCTAssertEqual(HostBridge.commandNames(), declared)
    }

    func testTheEngineBundleIsBundledAndDefinesItsGlobal() {
        XCTAssertTrue(Engine.makeContext() != nil, "build/engine.js must be copied in and define the engine global")
    }
}
