import XCTest

// Issue 453: a mention in a group read as plain words. The fixture (core/test/mention-fixture.js) draws the real
// conversation in this shell's own web view for a synthetic group whose messages carry mentions, of a member Contacts
// knows, of someone it does not, inside bold words and two side by side, and reports a verdict read from what the web
// view computed and the name each mention is titled with.
final class MentionTests: XCTestCase {
    func testEveryMentionIsSetApartAndNamesItsPerson() {
        let app = XCUIApplication()
        app.launchArguments = ["--mention-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let verdict = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'mention:'")).firstMatch
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'mention:pass' OR label BEGINSWITH 'mention:fail'"), object: verdict)
        _ = XCTWaiter().wait(for: [settled], timeout: 90)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "mention"
        shot.lifetime = .keepAlways
        add(shot)
        guard verdict.exists else {
            XCTFail("The mention fixture reported nothing" + SystemSurface.failureSuffix(app))
            return
        }
        print("mention verdict: " + verdict.label)
        XCTAssertTrue(verdict.label.hasPrefix("mention:pass"), "The mentions did not draw: " + verdict.label + SystemSurface.failureSuffix(app))
    }
}
