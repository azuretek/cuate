import QuickLook
import XCTest
@testable import Cuate

/// Open in (issue 374): the copy Quick Look shows is written under the file's own name, in a folder of its own, and a
/// name or bytes that could do harm write nothing.
final class OpenFileTests: XCTestCase {
    private func scratch() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("open-test-" + UUID().uuidString, isDirectory: true)
    }

    func testACopyIsWrittenUnderItsOwnNameInAFolderOfItsOwn() throws {
        let root = scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let bytes = Data("%PDF-1.4".utf8)
        let a = try XCTUnwrap(OpenFile.stage(name: "booking.pdf", base64: bytes.base64EncodedString(), root: root))
        let b = try XCTUnwrap(OpenFile.stage(name: "booking.pdf", base64: bytes.base64EncodedString(), root: root))
        XCTAssertEqual(a.lastPathComponent, "booking.pdf")
        XCTAssertEqual(try Data(contentsOf: a), bytes)
        XCTAssertNotEqual(a.deletingLastPathComponent(), b.deletingLastPathComponent(), "two files with one name never meet")
        XCTAssertTrue(a.path.hasPrefix(root.path), "every copy lives under the Open in folder")
        OpenFile.remove(a)
        XCTAssertFalse(FileManager.default.fileExists(atPath: a.deletingLastPathComponent().path), "a dismissed copy goes with its folder")
        XCTAssertTrue(FileManager.default.fileExists(atPath: b.path), "and only its own")
    }

    func testANameCannotLeaveItsFolderAndIsNeverEmpty() {
        XCTAssertEqual(OpenFile.safeName("../../etc/passwd"), "passwd")
        XCTAssertEqual(OpenFile.safeName("dir\\notes.txt"), "notes.txt")
        XCTAssertEqual(OpenFile.safeName("a:b.txt"), "a_b.txt")
        XCTAssertEqual(OpenFile.safeName(""), "Attachment")
        XCTAssertEqual(OpenFile.safeName(".."), "Attachment")
    }

    func testBytesThatAreNotBase64OrAreEmptyWriteNothing() {
        let root = scratch()
        XCTAssertNil(OpenFile.stage(name: "x.pdf", base64: "not base64!", root: root))
        XCTAssertNil(OpenFile.stage(name: "x.pdf", base64: "", root: root))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
    }

    func testQuickLookShowsTheOneCopy() {
        let url = URL(fileURLWithPath: "/tmp/booking.pdf")
        let source = QuickLookFile(url: url)
        let controller = QLPreviewController()
        XCTAssertEqual(source.numberOfPreviewItems(in: controller), 1)
        XCTAssertEqual((source.previewController(controller, previewItemAt: 0) as? NSURL) as URL?, url)
    }
}
