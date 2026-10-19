import XCTest
@testable import CuateHelperCore

/// The degradation rows from issue #479, each with the capability missing.
/// The menu bar item itself cannot be clicked in a headless test; these tests
/// assert the model the item renders and say so.
final class DegradationTests: XCTestCase {
    func testEveryMissingFieldCarriesAReasonAndAnAction() {
        let cases: [(SIPState, FullDiskAccessState, PermissionState, PermissionState)] = [
            (.enabled, .denied, .granted, .granted),
            (.enabled, .granted, .denied, .granted),
            (.enabled, .granted, .granted, .denied),
            (.enabled, .granted, .notAsked, .notAsked),
            (.unknown, .denied, .denied, .denied),
            (.disabled, .notRequired, .granted, .granted),
        ]
        for (sip, fullDiskAccess, contacts, automation) in cases {
            let capabilities = Capabilities.stub(sip: sip, fullDiskAccess: fullDiskAccess,
                                                 contacts: contacts, automation: automation)
            for issue in capabilities.issues {
                XCTAssertFalse(issue.reason.isEmpty, issue.capability + " has no reason")
                XCTAssertFalse(issue.action.isEmpty, issue.capability + " has no action")
                XCTAssertTrue(issue.action.contains("System Settings > Privacy & Security"),
                              issue.capability + " action does not name a pane")
            }
            let setup = SetupModel(capabilities: capabilities)
            for row in setup.rows {
                XCTAssertFalse(row.purpose.isEmpty)
                XCTAssertFalse(row.reason.isEmpty)
                XCTAssertFalse(row.action.isEmpty)
            }
        }
    }

    func testSIPOffAndSIPOnDifferOnlyInFullDiskAccess() {
        let off = Capabilities.stub(sip: .disabled, fullDiskAccess: .notRequired,
                                    contacts: .denied, automation: .denied)
        let on = Capabilities.stub(sip: .enabled, fullDiskAccess: .denied,
                                   contacts: .denied, automation: .denied)
        XCTAssertNotEqual(off.fullDiskAccess, on.fullDiskAccess)
        XCTAssertEqual(off.contacts, on.contacts)
        XCTAssertEqual(off.automation, on.automation)
        XCTAssertEqual(off.issues.filter { $0.capability != Permission.fullDiskAccess.rawValue },
                       on.issues.filter { $0.capability != Permission.fullDiskAccess.rawValue })
    }

    func testHistoryRouteNeverUsesAJSONRPCErrorWhenFullDiskAccessIsMissing() throws {
        let rpc = responder(sip: .enabled, contacts: 3, automation: 0, readable: false)
        let response = try reply(rpc, method: "chatdb.count")
        XCTAssertNil(response["error"])
        let result = response["result"] as? [String: Any]
        XCTAssertEqual(result?["ok"] as? Bool, false)
        XCTAssertNotNil(result?["message"])
        XCTAssertNotNil(result?["capabilities"])
    }

    func testSIPOffReadsEmptyAndPopulatedHistoryWithoutAFullDiskAccessGrant() throws {
        for rows in [0, 3] {
            let fixture = try HistoryFixture(rows: rows)
            defer { fixture.remove() }
            let rpc = responder(sip: .disabled, contacts: 3, automation: 0,
                                readable: true, databasePath: fixture.path)
            let response = try reply(rpc, method: "chatdb.count")
            XCTAssertNil(response["error"])
            let result = try XCTUnwrap(response["result"] as? [String: Any])
            XCTAssertEqual(result["ok"] as? Bool, true)
            XCTAssertEqual(result["rows"] as? Int, rows)
            XCTAssertNil(result["message"])
            let capabilities = try XCTUnwrap(result["capabilities"] as? [String: Any])
            XCTAssertEqual(capabilities["fullDiskAccess"] as? String, "notRequired")
        }
    }

    // Opt-in device evidence, not a unit fixture or proof of grant retention.
    func testLiveSIPOffHistoryReadWhenExplicitlyRequested() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["CUATE_HELPER_LIVE_HISTORY"] == "1",
                          "Run separately on a device with CUATE_HELPER_LIVE_HISTORY=1.")
        let capabilities = Capabilities.current(version: "test", build: "0")
        try XCTSkipUnless(capabilities.sip == .disabled, "Requires a SIP-off device.")
        XCTAssertEqual(capabilities.fullDiskAccess, .notRequired)
        XCTAssertNil(capabilities.issue(for: .fullDiskAccess))
        let opened = ChatDatabase().count()
        XCTAssertTrue(opened.ok, opened.message ?? "chat.db did not open")
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(opened.rows), 0)
    }
}
