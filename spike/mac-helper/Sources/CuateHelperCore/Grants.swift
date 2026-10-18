import Contacts
import CoreServices
import Foundation

/// The three reads the helper can make without prompting. Injected so tests can
/// prove the state words and the degradation rows without touching a real grant.
public protocol GrantProbe: Sendable {
    func contactsRawValue() -> Int
    func automationRawValue(ask: Bool) -> Int32
    func canReadMessagesDatabase() -> Bool
}

public struct SystemGrantProbe: GrantProbe {
    public init() {}

    public func contactsRawValue() -> Int {
        CNContactStore.authorizationStatus(for: .contacts).rawValue
    }

    public func automationRawValue(ask: Bool) -> Int32 {
        var description = AEDesc()
        let bundleId = "com.apple.MobileSMS"
        let made = bundleId.withCString { pointer in
            AECreateDesc(typeApplicationBundleID, pointer, Int(strlen(pointer)), &description)
        }
        guard made == noErr else { return Int32(made) }
        defer { AEDisposeDesc(&description) }
        return Int32(AEDeterminePermissionToAutomateTarget(&description, typeWildCard, typeWildCard, ask))
    }

    public func canReadMessagesDatabase() -> Bool {
        ChatDatabase().count().ok
    }
}

public struct StubGrantProbe: GrantProbe {
    public let contacts: Int
    public let automation: Int32
    public let readable: Bool

    public init(contacts: Int = 0, automation: Int32 = -1744, readable: Bool = false) {
        self.contacts = contacts
        self.automation = automation
        self.readable = readable
    }

    public func contactsRawValue() -> Int { contacts }
    public func automationRawValue(ask: Bool) -> Int32 { automation }
    public func canReadMessagesDatabase() -> Bool { readable }
}
