import XCTest

final class BackdropReadinessTests: XCTestCase {
    private let pink = (r: 230, g: 30, b: 160)
    private let surface = (r: 250, g: 249, b: 247)

    func testDOMReadyBeforePaintWaitsForActualPixel() {
        var state = BackdropReadiness(deadline: 90, colour: pink)
        // The failed capture and independent recording in run 39505078960 (issue 510).
        XCTAssertEqual(state.sample(at: 8.49, pixel: surface), .waiting)
        XCTAssertEqual(state.sample(at: 10.51, pixel: pink), .ready)
    }

    func testNeverPaintsTimesOutInsideTheOriginalBudget() {
        var state = BackdropReadiness(deadline: 90, colour: pink)
        XCTAssertEqual(state.sample(at: 89.99, pixel: surface), .waiting)
        XCTAssertEqual(state.sample(at: 90, pixel: surface), .timedOut)
    }

    func testUnreadableScreenIsNotReadiness() {
        var state = BackdropReadiness(deadline: 90, colour: pink)
        XCTAssertEqual(state.sample(at: 10, pixel: nil), .waiting)
        XCTAssertEqual(state.sample(at: 90, pixel: nil), .timedOut)
    }

    func testLatePaintCannotReviveTimeoutOrCreateANewBudget() {
        var state = BackdropReadiness(deadline: 90, colour: pink)
        XCTAssertEqual(state.sample(at: 90, pixel: pink), .timedOut)
        XCTAssertEqual(state.sample(at: 91, pixel: pink), .timedOut)
    }

    func testToleranceIsStillFortyInEveryChannel() {
        XCTAssertTrue(BackdropReadiness.matches((190, 70, 120), colour: pink))
        for pixel in [(189, 30, 160), (230, 71, 160), (230, 30, 201)] {
            XCTAssertFalse(BackdropReadiness.matches(pixel, colour: pink))
        }
        XCTAssertFalse(BackdropReadiness.matches(nil, colour: pink))
    }
}
