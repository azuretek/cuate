import XCTest

// Issue 437: an edited message could not show what it said before. The fixture (core/test/edit-history-fixture.js) draws
// the real conversation in this shell's own web view for a synthetic edited message with earlier versions, presses its
// Edited control and reports a verdict: the versions above the message, oldest first, the control reading Hide edits, a
// live edit adding the words it replaced, a second press folding them away, and the plain mark where nothing was kept.
final class EditHistoryTests: XCTestCase {
    func testEditedShowsWhatTheMessageSaidBefore() {
        let app = XCUIApplication()
        app.launchArguments = ["--edit-history-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let verdict = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'edits:'")).firstMatch
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'edits:pass' OR label BEGINSWITH 'edits:fail'"), object: verdict)
        _ = XCTWaiter().wait(for: [settled], timeout: 90)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "edit-history"
        shot.lifetime = .keepAlways
        add(shot)
        guard verdict.exists else {
            XCTFail("The edit history fixture reported nothing" + SystemSurface.failureSuffix(app))
            return
        }
        print("edit history verdict: " + verdict.label)
        XCTAssertTrue(verdict.label.hasPrefix("edits:pass"), "Edited did not show the earlier versions: " + verdict.label + SystemSurface.failureSuffix(app))
    }
}
