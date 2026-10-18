@preconcurrency import Contacts
import Foundation

public struct ContactName: Codable, Sendable {
    public let ok: Bool
    public let address: String
    public let name: String?
    public let display: String
    public let fallback: Bool
    public let message: String?

    public init(ok: Bool, address: String, name: String?, display: String, fallback: Bool, message: String?) {
        self.ok = ok
        self.address = address
        self.name = name
        self.display = display
        self.fallback = fallback
        self.message = message
    }

    /// A refused Contacts read is not an error for Cuate: the address is the
    /// display value, and the message names the pane that would restore names.
    public static func fallback(address: String, state: PermissionState) -> ContactName {
        let message = state == .granted ? nil
            : "Cuate will show " + address + " instead of a name. " + Refusal.contacts
        return ContactName(ok: state == .granted, address: address, name: nil,
                           display: address, fallback: true, message: message)
    }
}

public protocol ContactsResolving: Sendable {
    func resolve(address: String) -> ContactName
}

public struct ContactsLookup: ContactsResolving {
    private let store: CNContactStore

    public init(store: CNContactStore = CNContactStore()) {
        self.store = store
    }

    public func resolve(address: String) -> ContactName {
        let state = PermissionState.contacts(raw: CNContactStore.authorizationStatus(for: .contacts).rawValue)
        guard state == .granted else { return ContactName.fallback(address: address, state: state) }
        let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactOrganizationNameKey] as [CNKeyDescriptor]
        let predicate: NSPredicate
        if address.contains("@") {
            predicate = CNContact.predicateForContacts(matchingEmailAddress: address)
        } else {
            predicate = CNContact.predicateForContacts(matching: CNPhoneNumber(stringValue: address))
        }
        do {
            let matches = try store.unifiedContacts(matching: predicate, keysToFetch: keys)
            if let first = matches.first {
                let person = [first.givenName, first.familyName].filter { !$0.isEmpty }.joined(separator: " ")
                let display = person.isEmpty ? (first.organizationName.isEmpty ? address : first.organizationName) : person
                return ContactName(ok: true, address: address, name: display == address ? nil : display,
                                   display: display, fallback: display == address, message: nil)
            }
        } catch {
            return ContactName.fallback(address: address, state: .denied)
        }
        return ContactName(ok: true, address: address, name: nil, display: address, fallback: true, message: nil)
    }
}

public struct StubContactsLookup: ContactsResolving {
    private let result: ContactName

    public init(result: ContactName) {
        self.result = result
    }

    public func resolve(address: String) -> ContactName {
        result
    }
}
