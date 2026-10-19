import XCTest

// Issue 439: a group renamed showed no line in the conversation, only an empty message. The fixture
// (core/test/group-rename-fixture.js) draws the real conversation and the real chat list in this shell's own web view
// for a synthetic group whose history holds the group being named, its name being removed and a rename made from this
// app, and reports a verdict: every rename is a quiet line naming who did it, nothing is an empty message, and the list
// titles the group by its new name with the same words as its preview.
final class GroupRenameTests: XCTestCase {
    func testAGroupRenamedIsALineNamingWhoDidIt() {
        let app = XCUIApplication()
        app.launchArguments = ["--group-rename-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let verdict = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'rename:'")).firstMatch
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'rename:pass' OR label BEGINSWITH 'rename:fail'"), object: verdict)
        _ = XCTWaiter().wait(for: [settled], timeout: 90)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "group-rename"
        shot.lifetime = .keepAlways
        add(shot)
        guard verdict.exists else {
            XCTFail("The group rename fixture reported nothing" + SystemSurface.failureSuffix(app))
            return
        }
        print("group rename verdict: " + verdict.label)
        XCTAssertTrue(verdict.label.hasPrefix("rename:pass"), "A rename did not draw as its line: " + verdict.label + SystemSurface.failureSuffix(app))
        XCTAssertTrue(app.webViews.staticTexts["Sam Example removed the name from the conversation"].exists, "A removed name must read as a line naming who removed it")
    }
}
