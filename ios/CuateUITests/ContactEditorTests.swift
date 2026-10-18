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
            return edit.exists
        }
        let arrived = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: card, object: nil)], timeout: 90)
        guard arrived == .completed else {
            let failure = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            failure.name = "contacts-permission-failure"
            failure.lifetime = .keepAlways
            add(failure)
            XCTFail("Native contact card did not appear: " + app.debugDescription + springboard.debugDescription)
            return
        }
        // Issue 446: the card is judged on one reading of the window. Two queries are two looks at a view that may have
        // drawn on between them, so the native names and the web header's are both counted from one snapshot.
        guard let window = try? app.snapshot() else {
            XCTFail("The window could not be read" + SystemSurface.failureSuffix(app))
            return
        }
        let names = personNames(window, inWebView: false)
        XCTAssertGreaterThan(names.native, 0,
                             "The native card, not only the web header, must name the synthetic person (in the web header: \(names.web))")
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "contact-card"
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// How many static texts name the synthetic person in one snapshot, outside any web view and inside one.
    private func personNames(_ node: XCUIElementSnapshot, inWebView: Bool) -> (native: Int, web: Int) {
        let web = inWebView || node.elementType == .webView
        var count: (native: Int, web: Int) = (0, 0)
        if node.elementType == .staticText && node.label == "Fixture Person" {
            if web { count.web += 1 } else { count.native += 1 }
        }
        for child in node.children {
            let inner = personNames(child, inWebView: web)
            count.native += inner.native
            count.web += inner.web
        }
        return count
    }
}
