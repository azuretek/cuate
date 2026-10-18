import Foundation

public struct SetupRow: Codable, Sendable, Equatable {
    public let permission: Permission
    public let title: String
    public let purpose: String
    public let state: CapabilityDisplay
    public let reason: String
    public let action: String
    public let buttonTitle: String
    public let buttonEnabled: Bool

    public init(permission: Permission, title: String, purpose: String, state: CapabilityDisplay,
                reason: String, action: String, buttonTitle: String, buttonEnabled: Bool) {
        self.permission = permission
        self.title = title
        self.purpose = purpose
        self.state = state
        self.reason = reason
        self.action = action
        self.buttonTitle = buttonTitle
        self.buttonEnabled = buttonEnabled
    }
}

public struct SetupModel: Codable, Sendable {
    public let title: String
    public let intro: String
    public let rows: [SetupRow]
    public let checkAgainTitle: String

    /// The setup step is a screen a person starts. It is never built on launch.
    public init(capabilities: Capabilities, permissions: [Permission] = Permission.allCases) {
        self.title = "Set Up Cuate Helper"
        self.intro = "Cuate Helper needs these permissions to work with Messages. Nothing is asked until you choose a button, and you can close this window at any time."
        self.rows = permissions.map { permission in
            let state = capabilities.displayState(for: permission)
            let issue = capabilities.issue(for: permission)
            let reason: String
            let action: String
            if let issue {
                reason = issue.reason
                action = issue.action
            } else if state == .notRequired {
                reason = "System Integrity Protection is off, so macOS does not enforce file permissions. Cuate can read Messages without this grant."
                action = "Nothing to do. If SIP is turned on later, choose Check Again and Cuate will ask for Full Disk Access."
            } else {
                reason = "Granted. Cuate can use this now."
                action = "You can open the setting to review or change it."
            }
            return SetupRow(
                permission: permission,
                title: permission.title,
                purpose: permission.purpose,
                state: state,
                reason: reason,
                action: action,
                buttonTitle: SetupModel.buttonTitle(for: permission, state: state),
                buttonEnabled: state != .notRequired
            )
        }
        self.checkAgainTitle = "Check Again"
    }

    public static func buttonTitle(for permission: Permission, state: CapabilityDisplay) -> String {
        switch permission {
        case .fullDiskAccess:
            return state == .notRequired ? "Not needed while SIP is off" : "Open Full Disk Access"
        case .automationMessages:
            return state == .notAsked ? "Ask for Automation" : "Open Automation Settings"
        case .contacts:
            return state == .notAsked ? "Ask for Contacts" : "Open Contacts Settings"
        }
    }
}

public enum SetupPresentation: Sendable {
    public enum Mode: String, Codable, Sendable { case agent, setup, oneShot }

    /// Only an explicit start shows the setup screen.
    public static func shouldOpenOnLaunch(mode: Mode) -> Bool {
        mode == .setup
    }
}
