import XCTest

/// Runs the extension's actual decoder with a synthetic vector emitted by server/src/push.js seal().
/// This proves cross-language opening and authentication, not OS extension launch or APNs delivery.
final class PushSealingTests: XCTestCase {
    private let key = Data(repeating: 0x42, count: 32).base64EncodedString() // Synthetic only.
    private let sealed = "wWns4kI-K-MH5iVBO91wr9zBk0NSuzKJeq1uc0tkLNRO9a23NI5tEwrUFJFoub79YQ0MHnbdBIl0TfU6KCwIMxPGh3fE3Ooe2zBGxdpwAY3JpRRNLBgcH1d7eEd5vxUvopGt-k7-o-KM7Cir05V8a9Fh9xNOHBsBfokn-LZ3Doiwo7g-Xmtq9m1vxHI"

    func testServerSealedNoticeOpensWithItsOwnKeyAndRetainsTapTarget() throws {
        let notice = try XCTUnwrap(NotificationService.open(["sealed": sealed], key: key))
        XCTAssertEqual(notice.v, 1)
        XCTAssertEqual(notice.chatId, "fixture-late")
        XCTAssertEqual(notice.messageId, "m-late")
        XCTAssertEqual(notice.title, "Synthetic sender")
        XCTAssertEqual(notice.body, "Synthetic sealed notice")
    }

    func testWrongKeyTamperingAndAbsentKeyAreRefused() throws {
        XCTAssertNil(NotificationService.open(["sealed": sealed], key: nil))
        XCTAssertNil(NotificationService.open(["sealed": sealed], key: Data(repeating: 0x43, count: 32).base64EncodedString()))
        var bytes = try XCTUnwrap(NotificationService.base64url(sealed))
        bytes[bytes.count - 1] ^= 1
        XCTAssertNil(NotificationService.open(["sealed": bytes.base64EncodedString()], key: key))
        XCTAssertNil(NotificationService.open(["sealed": "not-a-sealed-notice"], key: key))
    }
}
