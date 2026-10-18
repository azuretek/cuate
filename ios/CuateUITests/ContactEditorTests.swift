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
        // The card is judged by the state waited for, not by a second look after it: it keeps drawing as it opens
        // (issue 446), so the wait holds out for the native card naming the synthetic person, beyond the web header.
        let named = NSPredicate(format: "label == 'Fixture Person'")
        var namesThePerson = false
        // Permission is a SpringBoard surface, may arrive late, and must be answered before the bridge completes.
        var continuedContacts = false
        let card = NSPredicate { _, _ in
            for owner in [springboard, app] {
                let alert = owner.alerts.firstMatch
                if alert.exists && alert.label.localizedCaseInsensitiveContains("contacts") {
                    for label in ["Continue", "Allow Full Access", "OK", "Allow"] where alert.buttons[label].exists {
                        if label == "Continue" { continuedContacts = true }
                        alert.buttons[label].tap()
                        break
                    }
                }
            }
            // Newer iOS first asks Continue, then offers full or selected access on a separate system surface.
            // iOS 27 labels the full choice "Share All N Contacts"; earlier releases said "Allow Full Access".
            if continuedContacts {
                let fullAccess = NSPredicate(format: "label BEGINSWITH 'Share All' OR label == 'Allow Full Access'")
                for owner in [springboard, app] {
                    let full = owner.buttons.matching(fullAccess).firstMatch
                    if full.exists && full.isHittable { full.tap() }
                }
            }
            guard edit.exists else { return false }
            namesThePerson = app.staticTexts.matching(named).count > app.webViews.staticTexts.matching(named).count
            return namesThePerson
        }
        let arrived = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: card, object: nil)], timeout: 90)
        guard arrived == .completed else {
            let failure = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            failure.name = "contacts-permission-failure"
            failure.lifetime = .keepAlways
            add(failure)
            XCTFail("Native contact card did not appear naming the synthetic person: " + app.debugDescription + springboard.debugDescription)
            return
        }
        XCTAssertTrue(namesThePerson, "The native card, not only the web header, must name the synthetic person")
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "contact-card"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
