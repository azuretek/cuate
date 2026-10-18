import XCTest
@testable import CuateHelperCore

final class SetupAndMenuTests: XCTestCase {
    func testSetupNeverOpensOnLaunch() {
        XCTAssertFalse(SetupPresentation.shouldOpenOnLaunch(mode: .agent))
        XCTAssertFalse(SetupPresentation.shouldOpenOnLaunch(mode: .oneShot))
        XCTAssertTrue(SetupPresentation.shouldOpenOnLaunch(mode: .setup))
    }

    func testMenuModelCoversEveryPermissionAndOpensItsPane() {
        let capabilities = Capabilities.stub()
        let model = MenuBarModel(capabilities: capabilities,
                                 signing: SigningIdentity(name: "Developer ID Application: Example (TEAM)", team: "TEAM"))
        XCTAssertEqual(model.permissionRows.count, Permission.allCases.count)
        for permission in Permission.allCases {
            let row = model.permissionRows.first { $0.action.permission == permission }
            XCTAssertNotNil(row, "\(permission.title) has no menu row")
            XCTAssertEqual(row?.action.kind, .openPermissionPane)
            XCTAssertTrue(row?.title.contains(permission.title) == true)
            XCTAssertEqual(row?.title.contains(row?.state?.displayName ?? "") == true, true)
            XCTAssertFalse(permission.systemSettingsURLs.isEmpty)
            XCTAssertTrue(permission.systemSettingsURLs.first?.contains("Privacy_") == true)
        }
        XCTAssertTrue(model.commandRows.contains { $0.action.kind == .openSetup })
        XCTAssertTrue(model.commandRows.contains { $0.action.kind == .checkAgain })
        XCTAssertTrue(model.commandRows.contains { $0.action.kind == .restart })
        XCTAssertTrue(model.commandRows.contains { $0.action.kind == .quit })
        XCTAssertTrue(model.versionLine.contains("0.0.1"))
        XCTAssertTrue(model.signingLine.contains("Signed by"))
        XCTAssertFalse(model.badge)
        XCTAssertEqual(model.statusLine, "Running. Every permission is available.")
        XCTAssertTrue(model.tooltip.contains("Every capability is available"))
        // The status item itself is AppKit and is not clicked in a headless test.
        // This asserts the model the item renders, including every row's action.
    }

    func testBadgeShowsWhenACapabilityIsMissing() {
        let capabilities = Capabilities.stub(contacts: .denied)
        let model = MenuBarModel(capabilities: capabilities,
                                 signing: SigningIdentity(name: "Developer ID Application: Example", team: "TEAM"))
        XCTAssertTrue(model.badge)
        XCTAssertTrue(model.tooltip.contains("1 capability needs attention"))
        XCTAssertEqual(model.statusLine, "Running. 1 permission needs attention.")
    }

    func testEverySetupRowNamesAPurposeAndAState() {
        let setup = SetupModel(capabilities: Capabilities.stub(contacts: .notAsked))
        for row in setup.rows {
            XCTAssertFalse(row.purpose.isEmpty)
            XCTAssertFalse(row.reason.isEmpty)
            XCTAssertFalse(row.action.isEmpty)
            XCTAssertFalse(row.state.displayName.isEmpty)
        }
    }
}
