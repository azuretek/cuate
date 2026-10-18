import XCTest

// Issue 456: a person added to a group, removed, or leaving drew nothing but an empty message. The fixture
// (core/test/group-members-fixture.js) draws the real conversation in this shell's own web view for a synthetic group
// whose people changed (Sam added someone Contacts does not know, removed someone it does, someone left, and you added a
// person) and reports a verdict read from what the web view drew. The test then reads the accessibility tree VoiceOver
// reads, where each line must be there in words.
final class GroupMembersTests: XCTestCase {
    func testEveryChangeIsALineNamingWhoAndWhom() {
        let app = XCUIApplication()
        app.launchArguments = ["--group-members-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let verdict = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'members:'")).firstMatch
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'members:pass' OR label BEGINSWITH 'members:fail'"), object: verdict)
        _ = XCTWaiter().wait(for: [settled], timeout: 90)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "group-members"
        shot.lifetime = .keepAlways
        add(shot)
        guard verdict.exists else {
            XCTFail("The group members fixture reported nothing" + SystemSurface.failureSuffix(app))
            return
        }
        print("group members verdict: " + verdict.label)
        XCTAssertTrue(verdict.label.hasPrefix("members:pass"), "The changes did not draw as lines: " + verdict.label + SystemSurface.failureSuffix(app))
        for line in ["Sam Example added riley@example.com to the conversation", "Sam Example removed Jordan Example from the conversation", "riley@example.com left the conversation", "You added Jordan Example to the conversation"] {
            let spoken = app.webViews.staticTexts.matching(NSPredicate(format: "label == %@", line)).firstMatch
            XCTAssertTrue(spoken.waitForExistence(timeout: 15), "VoiceOver is not given the line: " + line + SystemSurface.failureSuffix(app))
        }
    }
}
