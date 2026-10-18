import Foundation

/// One permission the helper can use. The raw value is the contract between the
/// setup screen, the menu bar, the capability object and the tests.
public enum Permission: String, CaseIterable, Codable, Sendable {
    case fullDiskAccess
    case automationMessages
    case contacts

    public var title: String {
        switch self {
        case .fullDiskAccess: return "Full Disk Access"
        case .automationMessages: return "Automation > Messages"
        case .contacts: return "Contacts"
        }
    }

    /// The sentence a person reads. For Contacts and Automation this is also
    /// the Info.plist purpose string, so the prompt and the setup screen agree.
    public var purpose: String {
        switch self {
        case .fullDiskAccess:
            return "Read your Messages history and the attachments in it, so Cuate can show your conversations."
        case .automationMessages:
            return "Cuate Helper asks Messages to send the messages and reactions you write in Cuate."
        case .contacts:
            return "Cuate Helper reads your contacts so Cuate can show names and photos instead of phone numbers and addresses."
        }
    }

    /// The privacy key this permission needs in Info.plist. Full Disk Access has
    /// no purpose string; macOS only offers it as a switch in System Settings.
    public var plistKey: String? {
        switch self {
        case .fullDiskAccess: return nil
        case .automationMessages: return "NSAppleEventsUsageDescription"
        case .contacts: return "NSContactsUsageDescription"
        }
    }

    public var paneName: String {
        switch self {
        case .fullDiskAccess:
            return "System Settings > Privacy & Security > Full Disk Access"
        case .automationMessages:
            return "System Settings > Privacy & Security > Automation > Messages"
        case .contacts:
            return "System Settings > Privacy & Security > Contacts"
        }
    }

    /// Newer macOS first, older URL shape second.
    public var systemSettingsURLs: [String] {
        switch self {
        case .fullDiskAccess:
            return [
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles",
                "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
            ]
        case .automationMessages:
            return [
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation",
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
            ]
        case .contacts:
            return [
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Contacts",
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts",
            ]
        }
    }
}
