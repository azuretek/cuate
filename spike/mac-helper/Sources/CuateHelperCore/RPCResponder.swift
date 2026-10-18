import Contacts
import Foundation

/// The spike's line-delimited JSON-RPC methods. Every reply, success or error,
/// carries the same capability object the setup screen and menu bar read.
public final class RPCResponder: @unchecked Sendable {
    private let info: HelperInfo
    private let sipProbe: SIPProbe
    private let grantProbe: GrantProbe
    private let database: ChatDatabase
    private let contacts: ContactsResolving

    public init(info: HelperInfo = .current(),
                sipProbe: SIPProbe = SystemSIPProbe(),
                grantProbe: GrantProbe = SystemGrantProbe(),
                database: ChatDatabase = ChatDatabase(),
                contacts: ContactsResolving = ContactsLookup()) {
        self.info = info
        self.sipProbe = sipProbe
        self.grantProbe = grantProbe
        self.database = database
        self.contacts = contacts
    }

    public func capabilities() -> Capabilities {
        Capabilities.current(sipProbe: sipProbe, grantProbe: grantProbe,
                             version: info.version, build: info.build)
    }

    public func respond(to line: Data) -> Data {
        var reply: [String: Any] = ["jsonrpc": "2.0"]
        let current = capabilities()
        guard let object = try? JSONSerialization.jsonObject(with: line),
              let request = object as? [String: Any] else {
            reply["id"] = NSNull()
            reply["capabilities"] = encoded(current)
            reply["error"] = ["code": -32700, "message": "parse error"]
            return data(reply)
        }
        reply["id"] = request["id"] ?? NSNull()
        reply["capabilities"] = encoded(current)
        let method = request["method"] as? String ?? ""
        let params = request["params"] as? [String: Any] ?? [:]

        switch method {
        case "hello":
            reply["result"] = encoded(info)
        case "capabilities":
            reply["result"] = encoded(current)
        case "permissions.state":
            reply["result"] = encoded(current)
        case "chatdb.count":
            let result = database.count()
            var payload = encoded(result) as? [String: Any] ?? [:]
            if !result.ok {
                payload["message"] = current.refusal(for: .fullDiskAccess) ?? Refusal.fullDiskAccess
            }
            payload["capabilities"] = encoded(current)
            reply["result"] = payload
        case "tcc.preflight":
            reply["result"] = [
                "contacts": grantProbe.contactsRawValue(),
                "automationMessages": Int(grantProbe.automationRawValue(ask: false)),
                "capabilities": encoded(current),
            ]
        case "tcc.request":
            reply["result"] = requestGrants()
        case "setup.model":
            reply["result"] = encoded(SetupModel(capabilities: current))
        case "menu.model":
            reply["result"] = encoded(MenuBarModel(capabilities: current, signing: .current()))
        case "contacts.resolve":
            let address = params["address"] as? String ?? ""
            var payload = encoded(contacts.resolve(address: address)) as? [String: Any] ?? [:]
            payload["capabilities"] = encoded(current)
            reply["result"] = payload
        case "send.preflight":
            let permitted = current.automation == .granted
            var payload: [String: Any] = [
                "permitted": permitted,
                "capabilities": encoded(current),
            ]
            if !permitted {
                payload["message"] = current.refusal(for: .automationMessages) ?? Refusal.automationMessages
            }
            reply["result"] = payload
        default:
            reply["error"] = ["code": -32601, "message": "method not found"]
        }
        return data(reply)
    }

    private func requestGrants() -> [String: Any] {
        let done = DispatchSemaphore(value: 0)
        var granted = false
        var failure = ""
        CNContactStore().requestAccess(for: .contacts) { ok, error in
            granted = ok
            failure = error.map { String(describing: $0) } ?? ""
            done.signal()
        }
        _ = done.wait(timeout: .now() + 120)
        _ = grantProbe.automationRawValue(ask: true)
        let current = capabilities()
        var payload: [String: Any] = [
            "contactsGranted": granted,
            "contactsError": failure,
            "capabilities": encoded(current),
        ]
        if let issue = current.issue(for: .automationMessages) {
            payload["automationMessage"] = issue.reason + " " + issue.action
        }
        return payload
    }

    private func encoded<T: Encodable>(_ value: T) -> Any {
        guard let data = try? JSONEncoder().encode(value),
              let object = try? JSONSerialization.jsonObject(with: data) else { return NSNull() }
        return object
    }

    private func data(_ reply: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys])) ?? Data()
    }
}
