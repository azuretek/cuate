import Contacts
import Foundation

#if DEBUG
/// Debug builds only (issue 393): the contacts fixture's synthetic person, written into the simulator's Contacts store
/// before the page asks for its card, so the system editor has someone to open. Inert without --contacts-fixture, and
/// the store is only written when the simulator has granted Contacts to the app.
enum ContactsFixture {
    static let phone = "+15555550123"

    static func seedIfAsked() {
        guard ProcessInfo.processInfo.arguments.contains("--contacts-fixture") else { return }
        guard CNContactStore.authorizationStatus(for: .contacts) == .authorized else { return }
        let store = CNContactStore()
        let keys: [CNKeyDescriptor] = [CNContactIdentifierKey as CNKeyDescriptor]
        let existing = (try? store.unifiedContacts(matching: CNContact.predicateForContacts(matching: CNPhoneNumber(stringValue: phone)), keysToFetch: keys)) ?? []
        if !existing.isEmpty { return }
        let person = CNMutableContact()
        person.givenName = "Fixture"
        person.familyName = "Person"
        person.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone))]
        let save = CNSaveRequest()
        save.add(person, toContainerWithIdentifier: nil)
        try? store.execute(save)
    }
}
#endif
