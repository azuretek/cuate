import XCTest

// Issue 414: a message notice pressed before its message reached the server. The fixture (core/test/late-notice-fixture.js)
// signs the real page in to a stand-in server and raises a real notice for a message that server does not have yet;
// this test sends the app to the home screen, presses the banner the system draws, and the message lands a moment after
// the press. The proof is the fixture's: the conversation the press opened brought that late message into view.
final class LateNoticeTests: XCTestCase {
    func testPressedNoticeRevealsALateMessage() {
        checkNotice(body: "Late fixture message")
    }

    // The hosted runner injects this payload with simctl before this focused test. It models the already-opened
    // notification content the service extension hands the app, not APNs delivery or service-extension execution.
    func testInjectedNoticeRevealsALateMessage() throws {
        guard ProcessInfo.processInfo.environment["CUATE_INJECTED_NOTICE_PROBE"] == "1" else {
            throw XCTSkip("Run the hosted injected-notice probe after simctl push")
        }
        checkNotice(body: "Injected synthetic remote notice")
    }

    private func checkNotice(body: String) {
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

        // The shell adds the notice once the app has left for the home screen, due a few seconds later, so it is drawn as a
        // banner over the home screen and never while the app is in front (issue 466).
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
        let notice = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", body)).firstMatch
        // A banner is drawn for a few seconds and a slow host can miss it, so a notice not seen as a banner is pressed
        // where the system keeps it, in Notification Center, which is the same notice and the same press. The wait for
        // the banner allows for a busy simulator, whose snapshots alone can take tens of seconds.
        // The system slides a notice in from the top, as a banner and in Notification Center alike, so a notice that
        // exists may still be above the screen; it is pressed only once it is on screen and has held still (issue 466).
        if !pressable(notice, in: springboard, timeout: 30) {
            keep("late-notice-no-banner")
            let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.005))
            top.press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.7)))
            guard pressable(notice, in: springboard, timeout: 30) else {
                keep("late-notice-not-in-center")
                XCTFail("The notice was neither shown as a banner nor kept in Notification Center: " + springboard.debugDescription)
                return
            }
            print("late notice pressed from Notification Center")
        } else {
            print("late notice pressed from its banner")
        }
        // A press in Notification Center can land on the cell without opening it, the first press only expanding it, so a
        // notice still there and pressable after a while is pressed once more before the app is required in front.
        notice.tap()
        if !app.wait(for: .runningForeground, timeout: 15), pressable(notice, in: springboard, timeout: 5) {
            keep("late-notice-pressed-again")
            print("late notice pressed again")
            notice.tap()
        }
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "Pressing the notice brings the app back")

        let settled = NSPredicate { _, _ in label("late-notice:pass").exists || label("late-notice:fail").exists }
        _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: nil)], timeout: 60)
        keep("late-notice-revealed")
        let failure = label("late-notice:fail")
        XCTAssertFalse(failure.exists, failure.exists ? failure.label : "")
        XCTAssertTrue(label("late-notice:pass").exists, "The late message was brought into view: " + app.debugDescription)
    }

    /// Whether the notice can be pressed: hittable, its centre on the screen, and its frame the same on consecutive reads,
    /// so it is neither still sliding in nor sliding away. False when that does not hold within the timeout.
    private func pressable(_ notice: XCUIElement, in springboard: XCUIApplication, timeout: TimeInterval) -> Bool {
        var last = CGRect.null
        var still = 0
        let ready = NSPredicate { _, _ in
            guard notice.exists, notice.isHittable else { still = 0; last = .null; return false }
            let frame = notice.frame
            let screen = springboard.frame
            guard !frame.isEmpty, frame.minY >= screen.minY, screen.contains(CGPoint(x: frame.midX, y: frame.midY)) else { still = 0; last = .null; return false }
            still = frame == last ? still + 1 : 0
            last = frame
            return still >= 2
        }
        return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: timeout) == .completed
    }

    private func keep(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
