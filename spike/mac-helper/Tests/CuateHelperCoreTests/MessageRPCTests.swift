import Foundation
import IMsgRPC
import XCTest
@testable import CuateHelperCore

final class MessageRPCTests: XCTestCase {
    func testTaggedLibraryRoundTripAndDrainInsideHelper() async throws {
        let fixture = try HistoryFixture(rows: 0)
        defer { fixture.remove() }
        let output = MemoryRPCOutput()
        let rpc = MessageRPC(databasePath: fixture.path, output: output)
        let lines = AsyncThrowingStream<String, Error> { continuation in
            continuation.yield(#"{"jsonrpc":"2.0","id":479,"method":"not.a.method"}"#)
            continuation.yield(#"{"jsonrpc":"2.0","id":480,"method":"watch.unsubscribe","params":{"subscription":1}}"#)
            continuation.yield("not json")
            continuation.finish()
        }
        try await rpc.run(lines: lines)
        let replies = output.replies
        XCTAssertEqual(replies.count, 3)
        let success = try XCTUnwrap(replies.first { ($0["id"] as? Int) == 480 })
        XCTAssertNil(success["error"])
        XCTAssertEqual((success["result"] as? [String: Any])?["ok"] as? Bool, true)
        let unknown = try XCTUnwrap(replies.first { ($0["id"] as? Int) == 479 })
        XCTAssertEqual((unknown["error"] as? [String: Any])?["code"] as? Int, -32601)
        let malformed = try XCTUnwrap(replies.first { $0["id"] is NSNull })
        XCTAssertEqual((malformed["error"] as? [String: Any])?["code"] as? Int, -32700)
        XCTAssertTrue(output.flushed)
    }
}

private final class MemoryRPCOutput: RPCOutput, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [[String: Any]] = []
    private var didFlush = false

    var replies: [[String: Any]] { lock.lock(); defer { lock.unlock() }; return storage }
    var flushed: Bool { lock.lock(); defer { lock.unlock() }; return didFlush }

    func sendResponse(id: Any, result: Any) { record(["id": id, "result": result]) }
    func sendError(id: Any?, error: RPCError) {
        record(["id": id ?? NSNull(), "error": error.asDictionary()])
    }
    func sendNotification(method: String, params: Any) { record(["method": method, "params": params]) }
    func flush() { lock.lock(); defer { lock.unlock() }; didFlush = true }
    private func record(_ value: [String: Any]) { lock.lock(); defer { lock.unlock() }; storage.append(value) }
}
