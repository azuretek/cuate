import XCTest

// Issue 447: bold, italic, underlined and struck-through words drew as plain words. The fixture
// (core/test/text-format-fixture.js) draws the real conversation in this shell's own web view for synthetic messages
// carrying each style, several on one stretch, one around a link and one beside a text effect, and reports a verdict
// read from what the web view computed for each stretch.
final class TextFormatTests: XCTestCase {
    func testEveryStyleDrawsOnItsStretch() {
        let app = XCUIApplication()
        app.launchArguments = ["--text-format-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let verdict = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'textfmt:'")).firstMatch
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'textfmt:pass' OR label BEGINSWITH 'textfmt:fail'"), object: verdict)
        _ = XCTWaiter().wait(for: [settled], timeout: 90)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "text-format"
        shot.lifetime = .keepAlways
        add(shot)
        guard verdict.exists else {
            XCTFail("The text formatting fixture reported nothing" + SystemSurface.failureSuffix(app))
            return
        }
        print("text formatting verdict: " + verdict.label)
        XCTAssertTrue(verdict.label.hasPrefix("textfmt:pass"), "The styles did not draw: " + verdict.label + SystemSurface.failureSuffix(app))
    }
}
