import XCTest

// Issue 533 (Abi, 2026-11-16): React offered the full emoji panel on a conversation that carries only the six classic
// reactions, and refused the pick afterwards; and a reaction that arrived as text from Android or over SMS could show as
// a stray message. The fixture (core/test/reaction-choices-fixture.js), the one the Android test and the desktop smoke run,
// draws the real conversation in this shell's own web view for an SMS, an RCS and two message-service conversations, opens
// React in each, and folds every cited phrasing of a reaction that arrived as text, then reports a verdict: SMS and RCS
// offer exactly the six with no search, the message service with an engine that sends any emoji offers the full panel,
// and every reaction is a chip on its message or a labelled line, never a bubble.
final class ReactionChoicesTests: XCTestCase {
    func testReactOffersWhatTheConversationCarriesAndTextReactionsFold() {
        let app = XCUIApplication()
        app.launchArguments = ["--reaction-choices-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let verdict = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'reactions:'")).firstMatch
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'reactions:pass' OR label BEGINSWITH 'reactions:fail'"), object: verdict)
        _ = XCTWaiter().wait(for: [settled], timeout: 90)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "reaction-choices"
        shot.lifetime = .keepAlways
        add(shot)
        guard verdict.exists else {
            XCTFail("The reaction choices fixture reported nothing" + SystemSurface.failureSuffix(app))
            return
        }
        print("reaction choices verdict: " + verdict.label)
        XCTAssertTrue(verdict.label.hasPrefix("reactions:pass"), "React offered what the conversation cannot carry, or a reaction showed as a message: " + verdict.label + SystemSurface.failureSuffix(app))
    }
}
