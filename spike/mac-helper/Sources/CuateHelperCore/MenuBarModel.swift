import Foundation

public enum MenuBarActionKind: String, Codable, Sendable, Equatable {
    case openPermissionPane
    case openSetup
    case checkAgain
    case restart
    case quit
}

public struct MenuBarAction: Codable, Sendable, Equatable {
    public let kind: MenuBarActionKind
    public let permission: Permission?

    public init(kind: MenuBarActionKind, permission: Permission? = nil) {
        self.kind = kind
        self.permission = permission
    }
}

public struct MenuBarRow: Codable, Sendable, Equatable {
    public let title: String
    public let state: CapabilityDisplay?
    public let action: MenuBarAction
    public let isPermissionRow: Bool

    public init(title: String, state: CapabilityDisplay?, action: MenuBarAction, isPermissionRow: Bool) {
        self.title = title
        self.state = state
        self.action = action
        self.isPermissionRow = isPermissionRow
    }
}

/// The menu bar item's model. The status item itself is AppKit and is not
/// clicked in a headless test; this model is what the item renders.
public struct MenuBarModel: Codable, Sendable {
    public let helperName: String
    public let statusLine: String
    public let versionLine: String
    public let signingLine: String
    public let tooltip: String
    public let badge: Bool
    public let permissionRows: [MenuBarRow]
    public let commandRows: [MenuBarRow]

    public init(capabilities: Capabilities, signing: SigningIdentity = .current()) {
        self.helperName = "Cuate Helper"
        let count = capabilities.issues.count
        self.statusLine = count == 0
            ? "Running. Every permission is available."
            : "Running. " + String(count) + (count == 1 ? " permission needs attention." : " permissions need attention.")
        self.versionLine = "Cuate Helper " + capabilities.version + " (" + capabilities.build + ")"
        self.signingLine = signing.display
        self.permissionRows = Permission.allCases.map { permission in
            let state = capabilities.displayState(for: permission)
            return MenuBarRow(
                title: permission.title + ": " + state.displayName,
                state: state,
                action: MenuBarAction(kind: .openPermissionPane, permission: permission),
                isPermissionRow: true
            )
        }
        self.commandRows = [
            MenuBarRow(title: "Set Up Permissions...", state: nil, action: MenuBarAction(kind: .openSetup), isPermissionRow: false),
            MenuBarRow(title: "Check Again", state: nil, action: MenuBarAction(kind: .checkAgain), isPermissionRow: false),
            MenuBarRow(title: "Restart Helper", state: nil, action: MenuBarAction(kind: .restart), isPermissionRow: false),
            MenuBarRow(title: "Quit Cuate Helper", state: nil, action: MenuBarAction(kind: .quit), isPermissionRow: false),
        ]
        self.badge = capabilities.badge
        self.tooltip = count == 0
            ? "Cuate Helper is running. Every capability is available."
            : "Cuate Helper is running. " + String(count) + (count == 1 ? " capability needs attention." : " capabilities need attention.")
    }
}
