import XCTest

// Issue 393: prove the native system contact card, not a JavaScript marker behind a modal.
final class ContactEditorTests: XCTestCase {
    func testEditContactOpensTheSystemCard() {
        let app = XCUIApplication()
        app.launchArguments = ["--contacts-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let edit = app.navigationBars.buttons["Edit"].firstMatch
        // Permission is a SpringBoard surface, may arrive late, and must be answered before the bridge completes.
        let card = NSPredicate { _, _ in
            for owner in [springboard, app] {
                let alert = owner.alerts.firstMatch
                if alert.exists && alert.label.localizedCaseInsensitiveContains("contacts") {
                    for label in ["Allow Full Access", "OK", "Allow"] where alert.buttons[label].exists {
                        alert.buttons[label].tap()
                        break
                    }
                }
            }
            return edit.exists
        }
        let arrived = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: card, object: nil)], timeout: 90)
        guard arrived == .completed else {
            XCTFail("Native contact card did not appear: " + app.debugDescription + springboard.debugDescription)
            return
        }
        let named = NSPredicate(format: "label == 'Fixture Person'")
        XCTAssertGreaterThan(app.staticTexts.matching(named).count, app.webViews.staticTexts.matching(named).count,
                             "The native card, not only the web header, must name the synthetic person")
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "contact-card"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
