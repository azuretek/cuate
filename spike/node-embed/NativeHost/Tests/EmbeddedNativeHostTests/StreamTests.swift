import XCTest
@testable import EmbeddedNativeHost
private struct Echo: NativeEngine {
    func run(lines: AsyncThrowingStream<String, Error>, emit: @escaping @Sendable (String) -> Void) async throws {
        for try await line in lines { try Task.checkCancellation(); emit(line) }
    }
}
final class StreamTests: XCTestCase {
    func testBoundedAdmissionAndEOFDrain() async {
        let s=NativeSession(capacity:2)
        XCTAssertEqual(s.write("a"),0); XCTAssertEqual(s.write("b"),0); XCTAssertEqual(s.write("c"),1)
        XCTAssertEqual(s.write(String(repeating:"x",count:65537)),3)
        XCTAssertTrue(s.close(cancel:false)); XCTAssertFalse(s.close(cancel:false)); XCTAssertEqual(s.write("late"),2)
        let output=expectation(description:"accepted output"); output.expectedFulfillmentCount=2
        let terminal=expectation(description:"terminal"); terminal.assertForOverFulfill=true
        s.start(engine:Echo(),emit:{ _ in output.fulfill(); return true },end:{ code in XCTAssertEqual(code,0); terminal.fulfill() })
        await fulfillment(of:[output,terminal],timeout:3)
    }
    func testOutputOverflowTerminates() async {
        let s=NativeSession(); XCTAssertEqual(s.write("one"),0)
        let terminal=expectation(description:"overflow terminal")
        s.start(engine:Echo(),emit:{ _ in false },end:{ code in XCTAssertEqual(code,3); terminal.fulfill() })
        await fulfillment(of:[terminal],timeout:3); XCTAssertEqual(s.write("late"),2)
    }
    func testCancelLiveSourceCompletesExactlyOnce() async {
        let s=NativeSession(); let terminal=expectation(description:"cancel terminal"); terminal.assertForOverFulfill=true
        s.start(engine:Echo(),emit:{ _ in true },end:{ code in XCTAssertEqual(code,1); terminal.fulfill() })
        XCTAssertTrue(s.close(cancel:true)); XCTAssertFalse(s.close(cancel:true))
        await fulfillment(of:[terminal],timeout:3); XCTAssertEqual(s.write("late"),2)
    }

    func testCancelBeforeStartHasNoDelivery() async {
        let s=NativeSession(); XCTAssertEqual(s.write("accepted"),0); XCTAssertTrue(s.close(cancel:true))
        let terminal=expectation(description:"prestart cancel")
        s.start(engine:Echo(),emit:{ _ in XCTFail("delivery after cancel");return true },end:{ code in XCTAssertEqual(code,1);terminal.fulfill() })
        await fulfillment(of:[terminal],timeout:3)
    }
}
