import XCTest
@testable import EmbeddedNativeHost
private final class Lines: @unchecked Sendable { let lock=NSLock(); var value:[String]=[]; func add(_ s:String){lock.lock();value.append(s);lock.unlock()} }
private struct ForcedFailure: Error {}
private struct Fake: NativeEngine {
    func run(lines: AsyncThrowingStream<String, Error>, emit: @escaping @Sendable (String)->Void) async throws {
        for try await line in lines { emit(line) }
    }
}
final class HostTests: XCTestCase {
    func testInjectedEngineDrains() async throws {
        let out=Lines()
        let lines=AsyncThrowingStream<String,Error> { $0.yield("synthetic");$0.finish() }
        try await NativeHost(engine:Fake()).run(lines:lines,emit:{ out.add($0) })
        XCTAssertEqual(out.value,["synthetic"])
    }
    func testSourceErrorPropagatesAfterAcceptedOutput() async {
        let out=Lines()
        let lines=AsyncThrowingStream<String,Error> { $0.yield("accepted");$0.finish(throwing:ForcedFailure()) }
        do { try await NativeHost(engine:Fake()).run(lines:lines,emit:{ out.add($0) }); XCTFail("error swallowed") } catch { XCTAssertTrue(error is ForcedFailure) }
        XCTAssertEqual(out.value,["accepted"])
    }
    func testActualLibrarySourceFailurePropagates() async {
        let out=Lines()
        let path=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        let lines=AsyncThrowingStream<String,Error> { $0.finish(throwing:ForcedFailure()) }
        do { try await NativeHost(engine:LibraryEngine(databasePath:path)).run(lines:lines,emit:{ out.add($0) }); XCTFail("source failure swallowed") } catch { XCTAssertTrue(error is ForcedFailure) }
        XCTAssertEqual(out.value,[])
    }
    func testActualLibraryCancellationPropagates() async {
        let path=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        let job=Task {
            withUnsafeCurrentTask { $0?.cancel() }
            let lines=AsyncThrowingStream<String,Error> { $0.yield(#"{"jsonrpc":"2.0","id":8,"method":"synthetic.unknown"}"#);$0.finish() }
            try await NativeHost(engine:LibraryEngine(databasePath:path)).run(lines:lines,emit:{ _ in })
        }
        do { try await job.value; XCTFail("cancellation swallowed") } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertFalse(FileManager.default.fileExists(atPath:path))
    }
    func testActualPinnedLibraryUnknownMethod() async throws {
        let out=Lines()
        let path=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        let lines=AsyncThrowingStream<String,Error> { $0.yield(#"{"jsonrpc":"2.0","id":7,"method":"synthetic.unknown"}"#);$0.finish() }
        try await NativeHost(engine:LibraryEngine(databasePath:path)).run(lines:lines,emit:{ out.add($0) })
        XCTAssertEqual(out.value.count,1)
        let result=try JSONSerialization.jsonObject(with:Data(out.value[0].utf8)) as! [String:Any]
        XCTAssertEqual(result["id"] as? Int,7)
        XCTAssertEqual((result["error"] as? [String:Any])?["code"] as? Int,-32601)
        XCTAssertFalse(FileManager.default.fileExists(atPath:path))
    }
}
