import XCTest
@testable import Cuate

// Issue 167: the app icon chosen in Settings is applied on the iPhone as one of the alternate icon sets the build
// carries. Every icon the spec names but the default ships as one, the default is the primary icon, and the bridge's
// app.icon really changes the icon on show.
final class AppIconTests: XCTestCase {
    func testEveryChoiceButTheDefaultShipsAsAnAlternateIcon() throws {
        let spec = try XCTUnwrap(AppIcons.spec, "spec/app-icons.json is bundled")
        let expected = Set(spec.ids.filter { $0 != spec.defaultID }.map { "AppIcon-" + $0 })
        XCTAssertFalse(expected.isEmpty)
        XCTAssertEqual(AppIcons.alternates(), expected, "the built app carries every alternate icon set, and no other")
    }

    func testAnIdAsksForItsOwnIcon() throws {
        let spec = AppIcons.Spec(defaultID: "teal", ids: ["teal", "night"])
        XCTAssertEqual(AppIcons.target(for: "teal", spec: spec, alternates: ["AppIcon-night"]), .primary)
        XCTAssertEqual(AppIcons.target(for: "night", spec: spec, alternates: ["AppIcon-night"]), .alternate("AppIcon-night"))
        XCTAssertEqual(AppIcons.target(for: "night", spec: spec, alternates: []), .refused, "a set the build does not carry is never asked for")
        XCTAssertEqual(AppIcons.target(for: "nope", spec: spec, alternates: ["AppIcon-nope"]), .refused)
    }

    func testChoosingAnIconChangesTheIconOnShow() throws {
        let spec = try XCTUnwrap(AppIcons.spec)
        let other = try XCTUnwrap(spec.ids.first { $0 != spec.defaultID })
        XCTAssertTrue(UIApplication.shared.supportsAlternateIcons)
        let applied = apply(other)
        XCTAssertEqual(applied["applied"] as? Bool, true, "\(applied)")
        XCTAssertEqual(UIApplication.shared.alternateIconName, "AppIcon-" + other)
        let back = apply(spec.defaultID)
        XCTAssertEqual(back["applied"] as? Bool, true, "\(back)")
        XCTAssertNil(UIApplication.shared.alternateIconName, "the default is the primary icon")
        XCTAssertEqual(apply("nope")["applied"] as? Bool, false, "an id the spec does not name is refused")
    }

    private func apply(_ icon: String) -> [String: Any] {
        let done = expectation(description: "app.icon " + icon)
        var answer: [String: Any] = [:]
        AppIcons.apply(icon) { answer = $0; done.fulfill() }
        wait(for: [done], timeout: 15)
        return answer
    }
}
