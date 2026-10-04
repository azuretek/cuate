import XCTest
@testable import Cuate

// Issue 167: the app icon chosen in Settings is applied on the iPhone as one of the alternate icon sets the build
// carries. Every fixed choice the spec names ships as one, a choice with no colours of its own (Follow theme) is the
// primary icon, and the bridge's
// app.icon asks iOS for the right set and reports what it settled on. The system call itself sits behind
// AppIcons.Runtime, as in the sibling app (mobile/Chela AppIconsTests): iOS answers a real change with an alert of its
// own that a unit test cannot dismiss, so a real change here would hang the run. The device proves the change; this
// proves the bridge asks iOS for the right set.
final class AppIconTests: XCTestCase {
    func testEveryFixedChoiceShipsAsAnAlternateIcon() throws {
        let spec = try XCTUnwrap(AppIcons.spec, "spec/app-icons.json is bundled")
        let expected = Set(spec.fixed.map { "AppIcon-" + $0 })
        XCTAssertFalse(expected.isEmpty)
        XCTAssertEqual(AppIcons.alternates(), expected, "the built app carries every alternate icon set, and no other")
    }

    func testAnIdAsksForItsOwnIcon() throws {
        let spec = AppIcons.Spec(defaultID: "theme", ids: ["theme", "night"], fixed: ["night"])
        XCTAssertEqual(AppIcons.target(for: "theme", spec: spec, alternates: ["AppIcon-night"]), .primary)
        XCTAssertEqual(AppIcons.target(for: "night", spec: spec, alternates: ["AppIcon-night"]), .alternate("AppIcon-night"))
        XCTAssertEqual(AppIcons.target(for: "night", spec: spec, alternates: []), .refused, "a set the build does not carry is never asked for")
        XCTAssertEqual(AppIcons.target(for: "nope", spec: spec, alternates: ["AppIcon-nope"]), .refused)
    }

    func testChoosingAnIconAsksIOSForTheSetAndReportsWhatItSettledOn() throws {
        let spec = try XCTUnwrap(AppIcons.spec)
        let other = try XCTUnwrap(spec.ids.first { $0 != spec.defaultID })
        let app = FakeIconRuntime()

        let applied = apply(other, runtime: app.runtime)
        XCTAssertEqual(applied["applied"] as? Bool, true, "\(applied)")
        XCTAssertEqual(app.requests, ["AppIcon-" + other], "the bridge asks iOS for the chosen set")
        XCTAssertEqual(app.current, "AppIcon-" + other, "and settles on it")

        app.requests.removeAll()
        let back = apply(spec.defaultID, runtime: app.runtime)
        XCTAssertEqual(back["applied"] as? Bool, true, "\(back)")
        XCTAssertEqual(app.requests, ["AppIcon-" + spec.defaultID], "the default is its own alternate set")
        XCTAssertEqual(app.current, "AppIcon-" + spec.defaultID)

        // Follow theme has no colours of its own: iOS cannot recolour, so it asks for the primary, the store icon.
        let plain = try XCTUnwrap(spec.ids.first { !spec.fixed.contains($0) })
        app.requests.removeAll()
        let themed = apply(plain, runtime: app.runtime)
        XCTAssertEqual(themed["applied"] as? Bool, true, "\(themed)")
        XCTAssertEqual(app.requests, [""], "Follow theme asks iOS for the primary icon")
        XCTAssertNil(app.current, "iOS cannot recolour, so the store icon stands for Follow theme")

        app.requests.removeAll()
        let refused = apply("nope", runtime: app.runtime)
        XCTAssertEqual(refused["applied"] as? Bool, false, "an id the spec does not name is refused")
        XCTAssertEqual(app.requests, [], "a refused id never reaches iOS")
    }

    private func apply(_ icon: String, runtime: AppIcons.Runtime) -> [String: Any] {
        let done = expectation(description: "app.icon " + icon)
        var answer: [String: Any] = [:]
        AppIcons.apply(icon, runtime: runtime) { answer = $0; done.fulfill() }
        wait(for: [done], timeout: 5)
        return answer
    }
}

/// Stands in for UIApplication: it records the icon iOS is asked for and answers as iOS would, so the test never
/// raises the system alert a real change shows.
private final class FakeIconRuntime {
    var current: String?
    var requests: [String] = []
    var runtime: AppIcons.Runtime {
        AppIcons.Runtime(
            supportsAlternateIcons: { true },
            alternateIconName: { self.current },
            setAlternateIconName: { name, completion in
                self.requests.append(name ?? "")
                self.current = name
                completion(nil)
            }
        )
    }
}
