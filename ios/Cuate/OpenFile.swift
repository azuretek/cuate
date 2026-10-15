import Foundation
import QuickLook
import UIKit

/// Open in (issue 374): a file from a conversation is written to a folder of its own under the app's temporary
/// directory and shown in Quick Look, whose share button reaches every other app on the phone. The copy is removed
/// when Quick Look is dismissed, and whatever an interrupted run left is the system's temporary directory to clear.
enum OpenFile {
    /// The folder every copy Open in writes lives under.
    static func root(in temporary: URL = FileManager.default.temporaryDirectory) -> URL {
        temporary.appendingPathComponent("open", isDirectory: true)
    }

    /// The name a copy is written under: the file's own last path part, with nothing that could leave its folder or that
    /// a file system refuses, and never empty, so Quick Look shows the name the file was sent under.
    static func safeName(_ name: String) -> String {
        let last = (name.replacingOccurrences(of: "\\", with: "/") as NSString).lastPathComponent
        let refused = CharacterSet(charactersIn: "/:").union(.controlCharacters)
        let cleaned = last.components(separatedBy: refused).joined(separator: "_")
            .trimmingCharacters(in: CharacterSet(charactersIn: ".").union(.whitespaces))
        return cleaned.isEmpty ? "Attachment" : String(cleaned.prefix(200))
    }

    /// Writes the bytes under their name in a fresh folder of their own, so two files with one name never meet, and
    /// answers the file; nil when the bytes are not base64, are empty, or cannot be written.
    static func stage(name: String, base64: String, root: URL = root()) -> URL? {
        guard let bytes = Data(base64Encoded: base64), !bytes.isEmpty else { return nil }
        let dir = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let file = dir.appendingPathComponent(safeName(name))
            try bytes.write(to: file, options: .atomic)
            return file
        } catch {
            return nil
        }
    }

    /// Removes one copy and the folder it was written in.
    static func remove(_ file: URL) {
        try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
    }
}

/// Quick Look's source for the one file it shows; when Quick Look is dismissed the copy goes with it.
final class QuickLookFile: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    let url: URL
    var dismissed: (() -> Void)?

    init(url: URL) {
        self.url = url
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        url as NSURL
    }

    func previewControllerDidDismiss(_ controller: QLPreviewController) {
        OpenFile.remove(url)
        dismissed?()
    }
}
