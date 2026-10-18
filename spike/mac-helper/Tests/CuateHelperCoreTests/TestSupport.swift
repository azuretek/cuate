import Foundation
import CuateHelperCore

func testInfo() -> HelperInfo {
    HelperInfo(version: "0.0.1", build: "1", bundleId: "com.azuretek.cuate.helper",
               executable: "/tmp/cuate-helper", commit: "test")
}

func reply(_ responder: RPCResponder, method: String, params: [String: Any]? = nil) throws -> [String: Any] {
    var request: [String: Any] = ["jsonrpc": "2.0", "id": 1, "method": method]
    if let params { request["params"] = params }
    let input = try JSONSerialization.data(withJSONObject: request)
    let output = responder.respond(to: input)
    guard let object = try JSONSerialization.jsonObject(with: output) as? [String: Any] else {
        throw NSError(domain: "tests", code: 1)
    }
    return object
}

func namedContact() -> ContactName {
    ContactName(ok: true, address: "+15551234567", name: "Test Person",
                display: "Test Person", fallback: false, message: nil)
}

func responder(sip: SIPState, contacts: Int, automation: Int32, readable: Bool,
               databasePath: String = "/nonexistent/chat.db",
               contact: ContactName = namedContact()) -> RPCResponder {
    RPCResponder(info: testInfo(),
                 sipProbe: StubSIPProbe(sip),
                 grantProbe: StubGrantProbe(contacts: contacts, automation: automation, readable: readable),
                 database: ChatDatabase(path: databasePath),
                 contacts: StubContactsLookup(result: contact))
}
