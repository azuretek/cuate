import Foundation

/// The guard that fails when the code declares a permission the person cannot
/// reach. It is deliberately plain data so a test can feed it a bad list.
public enum DeclarationCheck {
    public static func offeredInSetup(_ setup: [SetupRow]) -> Set<Permission> {
        Set(setup.map(\.permission))
    }

    public static func offeredInMenu(_ menu: [MenuBarRow]) -> Set<Permission> {
        Set(menu.compactMap(\.action.permission))
    }

    public static func offeredPermissions(setup: [SetupRow], menu: [MenuBarRow]) -> Set<Permission> {
        offeredInSetup(setup).union(offeredInMenu(menu))
    }

    public static func missingFromSetup(declared: [Permission], setup: [SetupRow]) -> [Permission] {
        let offered = offeredInSetup(setup)
        return declared.filter { !offered.contains($0) }
    }

    public static func missingFromMenu(declared: [Permission], menu: [MenuBarRow]) -> [Permission] {
        let offered = offeredInMenu(menu)
        return declared.filter { !offered.contains($0) }
    }

    /// A permission missing from EITHER the setup step or the menu is reported.
    public static func missingPermissions(declared: [Permission], setup: [SetupRow], menu: [MenuBarRow]) -> [Permission] {
        let setupMissing = missingFromSetup(declared: declared, setup: setup)
        let menuMissing = missingFromMenu(declared: declared, menu: menu)
        return declared.filter { setupMissing.contains($0) || menuMissing.contains($0) }
    }

    /// Anything offered that the code does not declare. Together with
    /// missingPermissions this makes the two lists equal, not merely a subset.
    public static func unexpectedPermissions(declared: [Permission], setup: [SetupRow], menu: [MenuBarRow]) -> [Permission] {
        let declaredSet = Set(declared)
        return offeredPermissions(setup: setup, menu: menu).filter { !declaredSet.contains($0) }.sorted { $0.rawValue < $1.rawValue }
    }

    public static func privacyKeys(in plist: [String: Any]) -> [String] {
        plist.keys.filter { $0.hasPrefix("NS") && $0.hasSuffix("UsageDescription") }.sorted()
    }

    public static func expectedPrivacyKeys(for declared: [Permission]) -> [String] {
        declared.compactMap(\.plistKey).sorted()
    }
}
