import XCTest

final class LivePhotoReadinessTests: XCTestCase {
    func testMarkerAfterOldFirstDeadlineCanStillBecomeReadyWithinStartupBudget() {
        var state = LivePhotoReadiness(deadline: 120)
        XCTAssertEqual(state.sample(at: 61, exists: false, label: ""), .waiting)
        XCTAssertEqual(state.sample(at: 85, exists: true, label: "live:boot at=123"), .waiting)
        XCTAssertEqual(state.firstObservedAt, 85)
        XCTAssertEqual(state.sample(at: 95, exists: true, label: "live:ready"), .ready)
    }
    func testMissingMarkerAndBootThatNeverFinishesFailAtDeadline() {
        for present in [false, true] {
            var state = LivePhotoReadiness(deadline: 120)
            XCTAssertEqual(state.sample(at: 120, exists: present, label: "live:boot"), .timedOut)
            XCTAssertEqual(state.sample(at: 121, exists: true, label: "live:ready"), .timedOut)
        }
    }
    func testFixtureFailureIsNeverReadiness() {
        var state = LivePhotoReadiness(deadline: 120)
        XCTAssertEqual(state.sample(at: 30, exists: true, label: "live:fail fixture"), .failed)
    }
}
