import Foundation

public enum SIPState: String, Codable, Sendable, Equatable {
    case enabled
    case disabled
    case unknown

    public var displayName: String {
        switch self {
        case .enabled: return "enabled"
        case .disabled: return "disabled"
        case .unknown: return "unknown"
        }
    }
}

public enum FullDiskAccessState: String, Codable, Sendable, Equatable {
    case granted
    case denied
    case notRequired

    public var displayName: String {
        switch self {
        case .granted: return "Granted"
        case .denied: return "Not granted"
        case .notRequired: return "Not required"
        }
    }
}

public enum PermissionState: String, Codable, Sendable, Equatable {
    case granted
    case denied
    case notAsked

    public var displayName: String {
        switch self {
        case .granted: return "Granted"
        case .denied: return "Not granted"
        case .notAsked: return "Not asked"
        }
    }

    /// CNAuthorizationStatus: 0 not determined, 1 restricted, 2 denied,
    /// 3 authorized, 4 limited.
    public static func contacts(raw: Int) -> PermissionState {
        switch raw {
        case 3, 4: return .granted
        case 1, 2: return .denied
        default: return .notAsked
        }
    }

    /// AEDeterminePermissionToAutomateTarget: 0 granted, -1743 denied,
    /// -1744 would ask, -600 the target is not running.
    public static func automation(raw: Int32) -> PermissionState {
        switch raw {
        case 0: return .granted
        case -1744: return .notAsked
        case -600: return .notAsked
        case -1743: return .denied
        default: return .denied
        }
    }
}

/// What the setup screen and the menu bar show for one permission.
public enum CapabilityDisplay: String, Codable, Sendable, Equatable {
    case granted
    case denied
    case notAsked
    case notRequired

    public var displayName: String {
        switch self {
        case .granted: return "Granted"
        case .denied: return "Not granted"
        case .notAsked: return "Not asked"
        case .notRequired: return "Not required"
        }
    }
}

public struct CapabilityIssue: Codable, Sendable, Equatable {
    public let capability: String
    public let state: String
    public let reason: String
    public let action: String

    public init(capability: String, state: String, reason: String, action: String) {
        self.capability = capability
        self.state = state
        self.reason = reason
        self.action = action
    }
}

/// The single answer to "can this happen". Measured at launch and on every
/// permission read, never cached. Every server reply carries it, so a client
/// and the menu bar cannot disagree about the same missing capability.
public struct Capabilities: Codable, Sendable, Equatable {
    public let sip: SIPState
    public let fullDiskAccess: FullDiskAccessState
    public let contacts: PermissionState
    public let automation: PermissionState
    public let issues: [CapabilityIssue]
    public let measuredAt: String
    public let version: String
    public let build: String

    public init(sip: SIPState, fullDiskAccess: FullDiskAccessState, contacts: PermissionState,
                automation: PermissionState, issues: [CapabilityIssue], measuredAt: String,
                version: String, build: String) {
        self.sip = sip
        self.fullDiskAccess = fullDiskAccess
        self.contacts = contacts
        self.automation = automation
        self.issues = issues
        self.measuredAt = measuredAt
        self.version = version
        self.build = build
    }

    public var missing: [String] { issues.map(\.capability) }
    public var badge: Bool { issues.isEmpty == false }

    public func displayState(for permission: Permission) -> CapabilityDisplay {
        switch permission {
        case .fullDiskAccess:
            switch fullDiskAccess {
            case .granted: return .granted
            case .denied: return .denied
            case .notRequired: return .notRequired
            }
        case .contacts:
            switch contacts {
            case .granted: return .granted
            case .denied: return .denied
            case .notAsked: return .notAsked
            }
        case .automationMessages:
            switch automation {
            case .granted: return .granted
            case .denied: return .denied
            case .notAsked: return .notAsked
            }
        }
    }

    public func issue(for permission: Permission) -> CapabilityIssue? {
        issues.first { $0.capability == permission.rawValue }
    }

    /// The sentence a route returns when it cannot do its job.
    public func refusal(for permission: Permission) -> String? {
        guard let issue = issue(for: permission) else { return nil }
        return issue.reason + " " + issue.action
    }

    public static func current(sipProbe: SIPProbe = SystemSIPProbe(),
                               grantProbe: GrantProbe = SystemGrantProbe(),
                               version: String = HelperInfo.current().version,
                               build: String = HelperInfo.current().build) -> Capabilities {
        let sip = sipProbe.state()
        let fullDiskAccess: FullDiskAccessState
        if sip == .disabled {
            fullDiskAccess = .notRequired
        } else {
            // Unknown is treated as enabled, the stricter case.
            fullDiskAccess = grantProbe.canReadMessagesDatabase() ? .granted : .denied
        }
        let contacts = PermissionState.contacts(raw: grantProbe.contactsRawValue())
        let automation = PermissionState.automation(raw: grantProbe.automationRawValue(ask: false))
        var issues: [CapabilityIssue] = []

        if fullDiskAccess == .denied {
            issues.append(CapabilityIssue(
                capability: Permission.fullDiskAccess.rawValue,
                state: fullDiskAccess.rawValue,
                reason: "Cuate cannot read your Messages history or attachments because Full Disk Access is not granted.",
                action: "Open System Settings > Privacy & Security > Full Disk Access and turn on Cuate Helper."
            ))
        }

        if contacts != .granted {
            issues.append(CapabilityIssue(
                capability: Permission.contacts.rawValue,
                state: contacts.rawValue,
                reason: "Cuate cannot read Contacts, so it will show phone numbers and addresses instead of names and photos.",
                action: contacts == .notAsked
                    ? "Choose Ask for Contacts in Set Up Permissions, or open System Settings > Privacy & Security > Contacts."
                    : "Open System Settings > Privacy & Security > Contacts and turn on Cuate Helper."
            ))
        }

        if automation != .granted {
            issues.append(CapabilityIssue(
                capability: Permission.automationMessages.rawValue,
                state: automation.rawValue,
                reason: "Cuate cannot send through Messages because Automation for Messages is not granted.",
                action: automation == .notAsked
                    ? "Choose Ask for Automation in Set Up Permissions, or open System Settings > Privacy & Security > Automation."
                    : "Open System Settings > Privacy & Security > Automation and turn on Messages under Cuate Helper."
            ))
        }

        let formatter = ISO8601DateFormatter()
        return Capabilities(sip: sip, fullDiskAccess: fullDiskAccess, contacts: contacts,
                            automation: automation, issues: issues,
                            measuredAt: formatter.string(from: Date()),
                            version: version, build: build)
    }

    public static func stub(sip: SIPState = .disabled, fullDiskAccess: FullDiskAccessState = .notRequired,
                            contacts: PermissionState = .granted, automation: PermissionState = .granted,
                            version: String = "0.0.1", build: String = "1") -> Capabilities {
        let base = Capabilities(sip: sip, fullDiskAccess: fullDiskAccess, contacts: contacts,
                                automation: automation, issues: [], measuredAt: "2026-10-18T00:00:00Z",
                                version: version, build: build)
        var issues: [CapabilityIssue] = []
        if fullDiskAccess == .denied {
            issues.append(CapabilityIssue(capability: Permission.fullDiskAccess.rawValue, state: fullDiskAccess.rawValue,
                                          reason: "Cuate cannot read your Messages history or attachments because Full Disk Access is not granted.",
                                          action: "Open System Settings > Privacy & Security > Full Disk Access and turn on Cuate Helper."))
        }
        if contacts != .granted {
            issues.append(CapabilityIssue(capability: Permission.contacts.rawValue, state: contacts.rawValue,
                                          reason: "Cuate cannot read Contacts, so it will show phone numbers and addresses instead of names and photos.",
                                          action: contacts == .notAsked
                                            ? "Choose Ask for Contacts in Set Up Permissions, or open System Settings > Privacy & Security > Contacts."
                                            : "Open System Settings > Privacy & Security > Contacts and turn on Cuate Helper."))
        }
        if automation != .granted {
            issues.append(CapabilityIssue(capability: Permission.automationMessages.rawValue, state: automation.rawValue,
                                          reason: "Cuate cannot send through Messages because Automation for Messages is not granted.",
                                          action: automation == .notAsked
                                            ? "Choose Ask for Automation in Set Up Permissions, or open System Settings > Privacy & Security > Automation."
                                            : "Open System Settings > Privacy & Security > Automation and turn on Messages under Cuate Helper."))
        }
        return Capabilities(sip: sip, fullDiskAccess: fullDiskAccess, contacts: contacts,
                            automation: automation, issues: issues, measuredAt: base.measuredAt,
                            version: version, build: build)
    }
}
