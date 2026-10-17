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

        // System alerts can cover the app at any point and are answered wherever they land: signing in asks for
        // notifications, and the icon following the theme raises the system's note that the icon changed. Either one
        // holds the app in front, where a notice is never drawn.
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
        let posted = NSPredicate { _, _ in
            clearAlerts()
            return label("late-notice:posted").exists || label("late-notice:fail").exists
        }
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: posted, object: nil)], timeout: 90) == .completed,
              !label("late-notice:fail").exists else {
            keep("late-notice-not-posted")
            XCTFail("The notice was not raised: " + app.debugDescription)
            return
        }

        // The shell has the notice shown a few seconds later, once the app is on the home screen, as a banner over it.
        let away = NSPredicate { _, _ in
            clearAlerts()
            if app.state == .runningForeground { XCUIDevice.shared.press(.home) }
            return app.state != .runningForeground
        }
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: away, object: nil)], timeout: 30) == .completed else {
            keep("late-notice-still-in-front")
            XCTFail("The app did not leave for the home screen: " + springboard.debugDescription)
            return
        }
        let notice = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Late fixture message")).firstMatch
        // A banner is drawn for a few seconds and a slow host can miss it, so a notice not seen as a banner is pressed
        // where the system keeps it, in Notification Center, which is the same notice and the same press.
        if !notice.waitForExistence(timeout: 15) {
            keep("late-notice-no-banner")
            let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.005))
            top.press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.7)))
            guard notice.waitForExistence(timeout: 15) else {
                keep("late-notice-not-in-center")
                XCTFail("The notice was neither shown as a banner nor kept in Notification Center: " + springboard.debugDescription)
                return
            }
            print("late notice pressed from Notification Center")
        } else {
            print("late notice pressed from its banner")
        }
        notice.tap()
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
