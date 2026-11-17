import XCTest

// Issue 535: scrolling a long conversation waited at each page edge. The fixture (core/test/history-scroll-fixture.js),
// the same walk the desktop history proof runs, signs the real page in to a stand-in server in this shell's own web view
// and scrolls half a screen at a time up past several evicted pages and back down to the newest message, every page
// landing only once the reader has read another screen. It fails at the step where a message about to come into view
// was not already loaded, a page was asked for late, the message on screen moved when a page landed, two pages were on
// their way in one direction, or the window held more than three pages.
final class HistoryScrollTests: XCTestCase {
    func testHistoryLoadsAheadBothWays() {
        let app = XCUIApplication()
        app.launchArguments = ["--history-scroll-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let verdict = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'scroll:'")).firstMatch
        // The fixture signs in, and signing in asks for notifications (issue 327). The question is answered here, the way
        // LateNoticeTests answers it, so it is never left open when this test ends: the late notice test runs next, and in
        // #536's iOS run 44017390960, with this one left open, its own sign-in timed out waiting to be told notifications
        // were allowed.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let clearAlerts = {
            for owner in [springboard, app] {
                let alert = owner.alerts.firstMatch
                guard alert.exists else { continue }
                for name in ["Allow", "OK"] where alert.buttons[name].exists {
                    alert.buttons[name].tap()
                    break
                }
            }
        }
        let settled = NSPredicate { _, _ in
            clearAlerts()
            return verdict.exists && (verdict.label.hasPrefix("scroll:pass") || verdict.label.hasPrefix("scroll:fail"))
        }
        _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: nil)], timeout: 180)
        clearAlerts()
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "history-scroll"
        shot.lifetime = .keepAlways
        add(shot)
        guard verdict.exists else {
            XCTFail("The history scroll fixture reported nothing" + SystemSurface.failureSuffix(app))
            return
        }
        print("history scroll verdict: " + verdict.label)
        let report = XCTAttachment(string: verdict.label)
        report.name = "history-scroll report"
        report.lifetime = .keepAlways
        add(report)
        XCTAssertTrue(verdict.label.hasPrefix("scroll:pass"), "History did not load ahead both ways: " + verdict.label + SystemSurface.failureSuffix(app))
    }
}
