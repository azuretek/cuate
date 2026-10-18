import XCTest
@testable import CuateHelperCore

final class RPCTests: XCTestCase {
    func testFullDiskAccessMissingRow() throws {
        // This row cannot be reached live on this Mac while SIP is off. The flag
        // is stubbed to enabled and the probe refuses the read, and the test
        // says so rather than presenting a simulated grant as measured.
        let rpc = responder(sip: .enabled, contacts: 3, automation: 0, readable: false)
        let capabilities = try reply(rpc, method: "capabilities")
        let result = capabilities["result"] as? [String: Any]
        XCTAssertEqual(result?["fullDiskAccess"] as? String, "denied")
        XCTAssertEqual(result?["contacts"] as? String, "granted")
        XCTAssertEqual(result?["automation"] as? String, "granted")

        let history = try reply(rpc, method: "chatdb.count")
        let historyResult = history["result"] as? [String: Any]
        XCTAssertEqual(historyResult?["ok"] as? Bool, false)
        XCTAssertTrue((historyResult?["message"] as? String)?.contains("Full Disk Access") == true)
        XCTAssertTrue((historyResult?["message"] as? String)?.contains("System Settings > Privacy & Security > Full Disk Access") == true)
        XCTAssertEqual((historyResult?["capabilities"] as? [String: Any])?["fullDiskAccess"] as? String, "denied")

        // Everything that does not read the store still answers.
        let contact = try reply(rpc, method: "contacts.resolve", params: ["address": "+15551234567"])
        XCTAssertEqual((contact["result"] as? [String: Any])?["display"] as? String, "Test Person")
    }

    func testContactsMissingRowStillAnswersEverything() throws {
        let rpc = responder(sip: .disabled, contacts: 2, automation: 0, readable: true,
                            contact: ContactName.fallback(address: "+15551234567", state: .denied))
        let contact = try reply(rpc, method: "contacts.resolve", params: ["address": "+15551234567"])
        let result = contact["result"] as? [String: Any]
        XCTAssertEqual(result?["display"] as? String, "+15551234567")
        XCTAssertEqual(result?["fallback"] as? Bool, true)
        XCTAssertNil(contact["error"])
        XCTAssertEqual((result?["capabilities"] as? [String: Any])?["contacts"] as? String, "denied")
    }

    func testAutomationMissingRowRefusesBeforeAnyWrite() throws {
        let rpc = responder(sip: .disabled, contacts: 3, automation: -1743, readable: true)
        let response = try reply(rpc, method: "send.preflight")
        let result = response["result"] as? [String: Any]
        XCTAssertEqual(result?["permitted"] as? Bool, false)
        XCTAssertTrue((result?["message"] as? String)?.contains("Automation for Messages") == true)
        let capabilities = result?["capabilities"] as? [String: Any]
        XCTAssertEqual(capabilities?["automation"] as? String, "denied")
        XCTAssertEqual(capabilities?["contacts"] as? String, "granted")
    }

    func testSIPUnknownRowTreatsTheStricterCase() throws {
        let rpc = responder(sip: .unknown, contacts: 3, automation: 0, readable: false)
        let response = try reply(rpc, method: "capabilities")
        let result = response["result"] as? [String: Any]
        XCTAssertEqual(result?["sip"] as? String, "unknown")
        XCTAssertEqual(result?["fullDiskAccess"] as? String, "denied")
    }

    func testEveryReplyAndEveryErrorCarriesCapabilities() throws {
        let rpc = responder(sip: .disabled, contacts: 3, automation: 0, readable: true)
        let good = try reply(rpc, method: "hello")
        XCTAssertNotNil(good["capabilities"])
        let bad = try reply(rpc, method: "not.a.method")
        XCTAssertNotNil(bad["error"])
        XCTAssertNotNil(bad["capabilities"])
        let parse = rpc.respond(to: Data("not json".utf8))
        let parseObject = try JSONSerialization.jsonObject(with: parse) as? [String: Any]
        XCTAssertNotNil(parseObject?["capabilities"])
    }

    func testUnreadableDatabaseNamesThePane() throws {
        let rpc = responder(sip: .enabled, contacts: 3, automation: 0, readable: false,
                            databasePath: "/nonexistent/chat.db")
        let response = try reply(rpc, method: "chatdb.count")
        let result = response["result"] as? [String: Any]
        XCTAssertEqual(result?["ok"] as? Bool, false)
        XCTAssertTrue((result?["message"] as? String)?.contains("System Settings > Privacy & Security > Full Disk Access") == true)
    }

    func testRefusalConstantsNameTheirPanes() {
        XCTAssertTrue(Refusal.fullDiskAccess.contains("System Settings > Privacy & Security > Full Disk Access"))
        XCTAssertTrue(Refusal.automationMessages.contains("System Settings > Privacy & Security > Automation"))
        XCTAssertTrue(Refusal.contacts.contains("System Settings > Privacy & Security > Contacts"))
    }
}
