import XCTest

// Issue 414: a message notice pressed before its message reached the server. The fixture (core/test/late-notice-fixture.js)
// signs the real page in to a stand-in server and raises a real notice for a message that server does not have yet;
// this test sends the app to the home screen, presses the banner the system draws, and the message lands a moment after
// the press. The proof is the fixture's: the conversation the press opened brought that late message into view.
final class LateNoticeTests: XCTestCase {
    func testPressedNoticeRevealsALateMessage() {
        let app = XCUIApplication()
        app.launchArguments = ["--late-notice-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let label = { (prefix: String) in app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch }

        // Signing in asks for notifications; the system's question is answered on SpringBoard, wherever it lands.
        let posted = NSPredicate { _, _ in
            for owner in [springboard, app] {
                let alert = owner.alerts.firstMatch
                if alert.exists, alert.buttons["Allow"].exists { alert.buttons["Allow"].tap() }
            }
            return label("late-notice:posted").exists || label("late-notice:fail").exists
        }
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: posted, object: nil)], timeout: 90) == .completed,
              !label("late-notice:fail").exists else {
            keep("late-notice-not-posted")
            XCTFail("The notice was not raised: " + app.debugDescription)
            return
        }

        // The notice is shown a moment later, as a banner over the home screen.
        XCUIDevice.shared.press(.home)
        let banner = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Late fixture message")).firstMatch
        guard banner.waitForExistence(timeout: 30) else {
            keep("late-notice-no-banner")
            XCTFail("No banner for the notice: " + springboard.debugDescription)
            return
        }
        banner.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "Pressing the notice brings the app back")

        let settled = NSPredicate { _, _ in label("late-notice:pass").exists || label("late-notice:fail").exists }
        _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: nil)], timeout: 60)
        keep("late-notice-revealed")
        let failure = label("late-notice:fail")
        XCTAssertFalse(failure.exists, failure.exists ? failure.label : "")
        XCTAssertTrue(label("late-notice:pass").exists, "The late message was brought into view: " + app.debugDescription)
    }

    private func keep(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
