import XCTest

// Issue 393: Edit contact on iPhone opens the system's own contact card on the person the conversation is with. The
// fixture (core/test/contacts-fixture.js) draws the real conversation header from this shell's app.info and presses
// Edit contact; the debug shell seeds the synthetic person first (ContactsFixture.swift). The test holds the bridge to
// answering true and the system card to being on screen with that person in it, outside the web view.
final class ContactEditorTests: XCTestCase {
    func testEditContactOpensTheSystemCard() {
        let app = XCUIApplication()
        app.launchArguments = ["--contacts-fixture"]
        // Should the simulator ask for Contacts despite the boot proof's grant, allow it, so the card can open.
        addUIInterruptionMonitor(withDescription: "Contacts access") { alert in
            for label in ["Allow Full Access", "OK", "Allow"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        // A first-use permission sheet is part of this flow, not a pre-granted simulator assumption.
        let permission = app.alerts.firstMatch
        if permission.waitForExistence(timeout: 10) {
            for label in ["Allow Full Access", "OK", "Allow"] where permission.buttons[label].exists {
                permission.buttons[label].tap()
                break
            }
        }
        let answer = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'contacts:answer '")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 60), app.debugDescription)
        XCTAssertEqual(answer.label, "contacts:answer true drawn=true", "the bridge opened the card for a drawn control")
        // The card is the system's own view controller, presented over the web view in a navigation controller, so its
        // Edit button sits in a navigation bar the page has none of.
        let edit = app.navigationBars.buttons["Edit"].firstMatch
        XCTAssertTrue(edit.waitForExistence(timeout: 20), "the system contact card is on screen" + SystemSurface.failureSuffix(app))
        // The page's own header also reads "Fixture Person", so the card's copy is the one outside the web view.
        let named = NSPredicate(format: "label == 'Fixture Person'")
        let everywhere = app.staticTexts.matching(named).count
        let inPage = app.webViews.staticTexts.matching(named).count
        XCTAssertGreaterThan(everywhere, inPage, "the card shows the seeded person" + SystemSurface.failureSuffix(app))
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "contact-card"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
