import Contacts
import XCTest
@testable import CuateHelperCore

final class CapabilitiesTests: XCTestCase {
    func testRealReadoutMatchesTheSystem() {
        let capabilities = Capabilities.current(version: "test", build: "0")
        XCTAssertEqual(capabilities.sip, SystemSIPProbe().state())
        XCTAssertEqual(capabilities.contacts,
                       PermissionState.contacts(raw: CNContactStore.authorizationStatus(for: .contacts).rawValue))
        XCTAssertEqual(capabilities.automation,
                       PermissionState.automation(raw: SystemGrantProbe().automationRawValue(ask: false)))
        if capabilities.sip == .disabled {
            XCTAssertEqual(capabilities.fullDiskAccess, .notRequired)
            XCTAssertNil(capabilities.issue(for: .fullDiskAccess))
        } else {
            XCTAssertEqual(capabilities.fullDiskAccess,
                           ChatDatabase().count().ok ? .granted : .denied)
        }
    }

    func testReadingStateDoesNotPrompt() {
        let before = CNContactStore.authorizationStatus(for: .contacts).rawValue
        let start = Date()
        _ = Capabilities.current(version: "test", build: "0")
        let elapsed = Date().timeIntervalSince(start)
        let after = CNContactStore.authorizationStatus(for: .contacts).rawValue
        XCTAssertEqual(before, after)
        XCTAssertLessThan(elapsed, 5.0)
    }

    func testSIPDisabledMakesFullDiskAccessNotRequired() {
        let capabilities = Capabilities.current(sipProbe: StubSIPProbe(.disabled),
                                                grantProbe: StubGrantProbe(contacts: 3, automation: 0, readable: false),
                                                version: "test", build: "0")
        XCTAssertEqual(capabilities.sip, .disabled)
        XCTAssertEqual(capabilities.fullDiskAccess, .notRequired)
        XCTAssertNil(capabilities.issue(for: .fullDiskAccess))
        XCTAssertFalse(capabilities.badge)
        let setup = SetupModel(capabilities: capabilities)
        let row = setup.rows.first { $0.permission == .fullDiskAccess }
        XCTAssertEqual(row?.state, .notRequired)
        XCTAssertEqual(row?.buttonTitle, "Not needed while SIP is off")
        XCTAssertEqual(row?.buttonEnabled, false)
        let menu = MenuBarModel(capabilities: capabilities,
                                signing: SigningIdentity(name: "Developer ID Application: Example", team: "TEAM"))
        let menuRow = menu.permissionRows.first { $0.action.permission == .fullDiskAccess }
        XCTAssertEqual(menuRow?.title, "Full Disk Access: Not required")
    }

    func testSIPUnknownIsTreatedAsEnabledAndStricter() {
        let denied = Capabilities.current(sipProbe: StubSIPProbe(.unknown),
                                          grantProbe: StubGrantProbe(contacts: 3, automation: 0, readable: false),
                                          version: "test", build: "0")
        XCTAssertEqual(denied.sip, .unknown)
        XCTAssertEqual(denied.fullDiskAccess, .denied)
        XCTAssertNotNil(denied.issue(for: .fullDiskAccess))

        let granted = Capabilities.current(sipProbe: StubSIPProbe(.unknown),
                                           grantProbe: StubGrantProbe(contacts: 3, automation: 0, readable: true),
                                           version: "test", build: "0")
        XCTAssertEqual(granted.fullDiskAccess, .granted)
        XCTAssertNil(granted.issue(for: .fullDiskAccess))
    }

    func testSIPEnabledWithFullDiskAccessDenied() {
        let capabilities = Capabilities.current(sipProbe: StubSIPProbe(.enabled),
                                                grantProbe: StubGrantProbe(contacts: 3, automation: 0, readable: false),
                                                version: "test", build: "0")
        XCTAssertEqual(capabilities.fullDiskAccess, .denied)
        let issue = capabilities.issue(for: .fullDiskAccess)
        XCTAssertNotNil(issue)
        XCTAssertTrue(issue?.action.contains("System Settings > Privacy & Security > Full Disk Access") == true)
        let refusal = capabilities.refusal(for: .fullDiskAccess)
        XCTAssertTrue(refusal?.contains("System Settings > Privacy & Security > Full Disk Access") == true)
    }

    func testContactsDeniedFallsBackToAddress() {
        let capabilities = Capabilities.current(sipProbe: StubSIPProbe(.disabled),
                                                grantProbe: StubGrantProbe(contacts: 2, automation: 0, readable: true),
                                                version: "test", build: "0")
        XCTAssertEqual(capabilities.contacts, .denied)
        let issue = capabilities.issue(for: .contacts)
        XCTAssertTrue(issue?.action.contains("System Settings > Privacy & Security > Contacts") == true)
        let fallback = ContactName.fallback(address: "+15551234567", state: .denied)
        XCTAssertEqual(fallback.display, "+15551234567")
        XCTAssertNil(fallback.name)
        XCTAssertTrue(fallback.fallback)
        XCTAssertTrue(fallback.message?.contains("Contacts") == true)
    }

    func testContactsNotAskedOffersThePrompt() {
        let capabilities = Capabilities.current(sipProbe: StubSIPProbe(.disabled),
                                                grantProbe: StubGrantProbe(contacts: 0, automation: 0, readable: true),
                                                version: "test", build: "0")
        XCTAssertEqual(capabilities.contacts, .notAsked)
        let setup = SetupModel(capabilities: capabilities)
        let row = setup.rows.first { $0.permission == .contacts }
        XCTAssertEqual(row?.state, .notAsked)
        XCTAssertEqual(row?.buttonTitle, "Ask for Contacts")
    }

    func testAutomationDeniedRefusesSend() throws {
        let capabilities = Capabilities.current(sipProbe: StubSIPProbe(.disabled),
                                                grantProbe: StubGrantProbe(contacts: 3, automation: -1743, readable: true),
                                                version: "test", build: "0")
        XCTAssertEqual(capabilities.automation, .denied)
        XCTAssertTrue(capabilities.issue(for: .automationMessages)?.action.contains("Privacy & Security > Automation") == true)
        let setup = SetupModel(capabilities: capabilities)
        XCTAssertEqual(setup.rows.first { $0.permission == .automationMessages }?.buttonTitle,
                       "Open Automation Settings")

        let rpc = responder(sip: .disabled, contacts: 3, automation: -1743, readable: true)
        let response = try reply(rpc, method: "send.preflight")
        let result = response["result"] as? [String: Any]
        XCTAssertEqual(result?["permitted"] as? Bool, false)
        XCTAssertTrue((result?["message"] as? String)?.contains("Automation") == true)
        let attached = result?["capabilities"] as? [String: Any]
        XCTAssertEqual(attached?["automation"] as? String, "denied")
    }

    func testAutomationNotAskedOffersThePrompt() {
        let capabilities = Capabilities.current(sipProbe: StubSIPProbe(.disabled),
                                                grantProbe: StubGrantProbe(contacts: 3, automation: -1744, readable: true),
                                                version: "test", build: "0")
        XCTAssertEqual(capabilities.automation, .notAsked)
        let setup = SetupModel(capabilities: capabilities)
        XCTAssertEqual(setup.rows.first { $0.permission == .automationMessages }?.buttonTitle,
                       "Ask for Automation")
    }
}
