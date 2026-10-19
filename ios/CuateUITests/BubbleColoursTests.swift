import XCTest

// Issue 459: the other person's bubble wears the theme's accent and ours is the quiet tint. The fixture
// (core/test/bubble-colours-fixture.js) draws the real conversation in this shell's own web view for synthetic messages
// from both sides, in the default palette and a synthetic imported theme, light and dark, and reports a verdict: the
// received bubble is the accent bubble, ours is not, each keeps its text at 4.5:1, and the received one stands out more.
final class BubbleColoursTests: XCTestCase {
    func testReceivedBubbleWearsTheAccent() {
        let app = XCUIApplication()
        app.launchArguments = ["--bubble-colours-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let verdict = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'bubbles:'")).firstMatch
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'bubbles:pass' OR label BEGINSWITH 'bubbles:fail'"), object: verdict)
        _ = XCTWaiter().wait(for: [settled], timeout: 90)
        let light = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        light.name = "bubble-colours-light"
        light.lifetime = .keepAlways
        add(light)
        guard verdict.exists else {
            XCTFail("The bubble colours fixture reported nothing" + SystemSurface.failureSuffix(app))
            return
        }
        print("bubble colours verdict: " + verdict.label)
        XCTAssertTrue(verdict.label.hasPrefix("bubbles:pass"), "The bubbles are not the right colours: " + verdict.label + SystemSurface.failureSuffix(app))
        let toDark = app.webViews.buttons["Show dark bubbles"]
        XCTAssertTrue(toDark.waitForExistence(timeout: 10), "The fixture offers no way to the dark capture" + SystemSurface.failureSuffix(app))
        toDark.tap()
        let darkened = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'bubbles:dark' OR label BEGINSWITH 'bubbles:fail'"), object: verdict)
        _ = XCTWaiter().wait(for: [darkened], timeout: 20)
        let dark = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        dark.name = "bubble-colours-dark"
        dark.lifetime = .keepAlways
        add(dark)
        XCTAssertTrue(verdict.label.hasPrefix("bubbles:dark"), "The dark capture did not draw: " + verdict.label + SystemSurface.failureSuffix(app))
    }
}
