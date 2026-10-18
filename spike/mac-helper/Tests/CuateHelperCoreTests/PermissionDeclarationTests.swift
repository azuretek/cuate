import XCTest
@testable import CuateHelperCore

final class PermissionDeclarationTests: XCTestCase {
    private func infoPlist() throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Info.plist.in")
        let data = try Data(contentsOf: url)
        let object = try PropertyListSerialization.propertyList(from: data, options: [], format: nil)
        return object as? [String: Any] ?? [:]
    }

    /// The declared list and the offered list must be equal: every declared
    /// permission has a setup row and a menu row, and nothing else is offered.
    func testDeclaredListEqualsTheOfferedList() {
        let capabilities = Capabilities.stub()
        let setup = SetupModel(capabilities: capabilities)
        let menu = MenuBarModel(capabilities: capabilities,
                                signing: SigningIdentity(name: "Developer ID Application: Example", team: "TEAM"))
        XCTAssertEqual(DeclarationCheck.missingPermissions(declared: Permission.allCases,
                                                           setup: setup.rows,
                                                           menu: menu.permissionRows), [])
        XCTAssertEqual(DeclarationCheck.unexpectedPermissions(declared: Permission.allCases,
                                                              setup: setup.rows,
                                                              menu: menu.permissionRows), [])
        XCTAssertEqual(DeclarationCheck.offeredPermissions(setup: setup.rows, menu: menu.permissionRows),
                       Set(Permission.allCases))
    }

    /// This is the test that must fail when a permission is declared in code but
    /// missing from the setup step. The bad list is fed deliberately.
    func testMissingSetupRowIsCaught() {
        let capabilities = Capabilities.stub()
        let incomplete = SetupModel(capabilities: capabilities, permissions: [.fullDiskAccess, .contacts])
        let menu = MenuBarModel(capabilities: capabilities,
                                signing: SigningIdentity(name: "Developer ID Application: Example", team: "TEAM"))
        XCTAssertEqual(DeclarationCheck.missingPermissions(declared: Permission.allCases,
                                                           setup: incomplete.rows,
                                                           menu: menu.permissionRows),
                       [.automationMessages])
    }

    func testInfoPlistDeclaresExactlyTheNeededPrivacyKeys() throws {
        let plist = try infoPlist()
        let keys = DeclarationCheck.privacyKeys(in: plist)
        XCTAssertEqual(keys, DeclarationCheck.expectedPrivacyKeys(for: Permission.allCases))
        XCTAssertEqual(keys, ["NSAppleEventsUsageDescription", "NSContactsUsageDescription"])
        XCTAssertFalse(keys.contains("NSAppleMusicUsageDescription"))
        XCTAssertFalse(keys.contains("NSAccessibilityUsageDescription"))
    }

    func testPurposeStringsMatchInfoPlist() throws {
        let plist = try infoPlist()
        for permission in Permission.allCases {
            guard let key = permission.plistKey else { continue }
            XCTAssertEqual(plist[key] as? String, permission.purpose,
                           "\(permission.title) purpose string and Info.plist disagree")
        }
    }
}
