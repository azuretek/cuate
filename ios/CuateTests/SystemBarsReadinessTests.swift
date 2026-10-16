import XCTest

final class SystemBarsReadinessTests: XCTestCase {
    func testTwoValidBarContractsSurviveAnUnrelatedClockTick() {
        var readiness = SystemBarsReadiness()
        // Both snapshots pass the colour, contrast and inset checks. The clock is allowed to tick between them.
        XCTAssertFalse(readiness.observe(scheme: "light", problems: []))
        XCTAssertTrue(readiness.observe(scheme: "light", problems: []))
    }
    func testAnyInvalidOrUnreadableSampleResetsConsecutiveEvidence() {
        for problem in ["wrong colour", "wrong contrast", "bad inset", "unreadable capture"] {
            var readiness = SystemBarsReadiness()
            XCTAssertFalse(readiness.observe(scheme: "light", problems: []))
            XCTAssertFalse(readiness.observe(scheme: "light", problems: [problem]))
            XCTAssertFalse(readiness.observe(scheme: "light", problems: []))
            XCTAssertTrue(readiness.observe(scheme: "light", problems: []))
        }
    }
    func testSamplesFromDifferentSchemesCannotBeCombined() {
        var readiness = SystemBarsReadiness()
        XCTAssertFalse(readiness.observe(scheme: "dark", problems: []))
        XCTAssertFalse(readiness.observe(scheme: "light", problems: []))
        XCTAssertTrue(readiness.observe(scheme: "light", problems: []))
    }
    func testDroppedTapCanBeReadmittedButFocusedFieldIsNeverRetapped() {
        XCTAssertEqual(FieldFocusReadiness.action(now: 0, deadline: 30, exists: true, focused: false), .tap)
        XCTAssertEqual(FieldFocusReadiness.action(now: 3, deadline: 30, exists: true, focused: false), .tap)
        XCTAssertEqual(FieldFocusReadiness.action(now: 4, deadline: 30, exists: true, focused: true), .ready)
    }
    func testMissingFieldAndMissingFocusStayBounded() {
        XCTAssertEqual(FieldFocusReadiness.action(now: 1, deadline: 30, exists: false, focused: false), .waitForElement)
        XCTAssertEqual(FieldFocusReadiness.action(now: 30, deadline: 30, exists: false, focused: false), .timedOut)
        XCTAssertEqual(FieldFocusReadiness.action(now: 30, deadline: 30, exists: true, focused: false), .timedOut)
    }
}
