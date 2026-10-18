import Foundation

/// The refusal sentences used outside the capability object. Each names the
/// exact pane that fixes it, so a refusal is actionable and never a dead end.
public enum Refusal {
    public static let fullDiskAccess = "Cuate Helper cannot read your Messages database because Full Disk Access is not granted. Open System Settings > Privacy & Security > Full Disk Access, turn on Cuate Helper, then choose Check Again."
    public static let automationMessages = "Cuate Helper cannot send through Messages because Automation for Messages is not granted. Open System Settings > Privacy & Security > Automation, turn on Messages under Cuate Helper, then choose Check Again."
    public static let contacts = "Cuate Helper cannot read Contacts because Contacts access is not granted. Cuate will show addresses instead of names. Open System Settings > Privacy & Security > Contacts, turn on Cuate Helper, then choose Check Again."
}
