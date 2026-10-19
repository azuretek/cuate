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
        // Issue 446: the card is judged on the state the app's own hierarchy can read. Measured on iOS 27: the
        // system card draws its body in a remote view service, so a snapshot of this app carries the card's
        // navigation bar and its toolbar but never the contact's name, which the capture beside this test shows
        // drawn on screen. The card's own Edit control is therefore the native proof: it is not the web page, it
        // is the system editor the person's card was opened with, and the bridge opens it only for the single
        // contact whose number it matched. A bound that runs out says what the tree held.
        let editor = app.navigationBars.buttons["Edit"].firstMatch
        let judged = Date().addingTimeInterval(cardSeconds)
        while !(editor.exists && editor.isHittable) && Date() < judged {
            _ = XCTWaiter.wait(for: [XCTestExpectation(description: "the card draws on")], timeout: settleSeconds)
        }
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "contact-card"
        shot.lifetime = .keepAlways
        add(shot)
        var held: [String] = []
        if let tree = try? app.snapshot() { held = nativeTexts(tree) }
        XCTAssertTrue(editor.exists && editor.isHittable,
                      "The native card, not the web page, must be in front; the tree held " +
                        String(describing: held.prefix(12)) +
                        SystemSurface.failureSuffix(app))
    }

    private let cardSeconds: TimeInterval = 30
    private let settleSeconds: TimeInterval = 0.25

    /// Every text an element carries, whitespace-normalized, with whether it sits inside a web view.
    private func texts(_ node: XCUIElementSnapshot, inWebView: Bool, into found: inout [(text: String, web: Bool)]) {
        let web = inWebView || node.elementType == .webView
        for carried in [node.label, node.value as? String] {
            let text = normalized(carried ?? "")
            if !text.isEmpty { found.append((text, web)) }
        }
        for child in node.children { texts(child, inWebView: web, into: &found) }
    }

    /// The card wraps a long name and a snapshot can carry a non-breaking space, so the text is read by its words.
    private func normalized(_ text: String) -> String {
        text.replacingOccurrences(of: "\u{00a0}", with: " ")
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }

    private func nativeTexts(_ node: XCUIElementSnapshot) -> [String] {
        var found: [(text: String, web: Bool)] = []
        texts(node, inWebView: false, into: &found)
        return found.filter { !$0.web }.map(\.text)
    }

}
