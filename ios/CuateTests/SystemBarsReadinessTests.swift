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
    // Issue 517: the page's state wins past every bound, which is the run that failed: the field was focused, but XCTest
    // had spent the window idling after the press, and the deadline was read first.
    func testThePagesStateWinsPastEveryBound() {
        let rule = PressUntil(window: 15, maxPresses: 3, hardCap: 120)
        XCTAssertEqual(rule.next(reached: true, targetPresent: true, presses: 1, elapsed: 500, sinceLastPress: 400), .done)
        XCTAssertEqual(rule.next(reached: true, targetPresent: false, presses: 0, elapsed: 0, sinceLastPress: nil), .done)
    }
    func testTheWindowStartsWhenAPressReturnsSoXCTestsOwnTimeNeverCounts() {
        let rule = PressUntil(window: 15, maxPresses: 3, hardCap: 120)
        // The press took 30s inside XCTest (synthesis and its idle wait); the page still gets its full window after it.
        XCTAssertEqual(rule.next(reached: false, targetPresent: true, presses: 1, elapsed: 31, sinceLastPress: 1), .wait)
        XCTAssertEqual(rule.next(reached: false, targetPresent: true, presses: 1, elapsed: 44, sinceLastPress: 14), .wait)
        XCTAssertEqual(rule.next(reached: false, targetPresent: true, presses: 1, elapsed: 46, sinceLastPress: 15), .press, "a press the page never saw is made again")
    }
    func testPressesAreBoundedAndAMissingTargetDoesNotWaitForever() {
        let rule = PressUntil(window: 15, maxPresses: 3, hardCap: 120)
        XCTAssertEqual(rule.next(reached: false, targetPresent: true, presses: 0, elapsed: 0, sinceLastPress: nil), .press)
        XCTAssertEqual(rule.next(reached: false, targetPresent: true, presses: 3, elapsed: 60, sinceLastPress: 15), .failed)
        XCTAssertEqual(rule.next(reached: false, targetPresent: false, presses: 0, elapsed: 5, sinceLastPress: nil), .wait)
        XCTAssertEqual(rule.next(reached: false, targetPresent: false, presses: 0, elapsed: 15, sinceLastPress: nil), .failed)
        XCTAssertEqual(rule.next(reached: false, targetPresent: false, presses: 1, elapsed: 40, sinceLastPress: 20), .wait)
        XCTAssertEqual(rule.next(reached: false, targetPresent: true, presses: 1, elapsed: 120, sinceLastPress: 5), .failed, "the hard cap ends any step")
    }
}
