import XCTest

// Issue 453: a mention in a group read as plain words. The fixture (core/test/mention-fixture.js) draws the real
// conversation in this shell's own web view for a synthetic group whose messages carry mentions, of a member Contacts
// knows, of someone it does not, inside bold words, over an effect, inside a link and two side by side, and reports a
// verdict read from what the web view computed and the name each mention is given. The test then reads the accessibility
// tree VoiceOver reads, where each mention must name its person.
//
// Issue 485: the fixture gives its verdict only once its conversation is on screen, and the test judges one reading of
// the tree, taken again until both mentions are in it, bounded. A wait that runs out reports the reading it last held.
final class MentionTests: XCTestCase {
    private let spokenLabels = ["Sam, mention of Sam Example", "Riley, mention of riley@example.com"]

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
            XCTFail("The mention fixture reported nothing; the window held: " + labels(app).prefix(20).joined(separator: " | ") + SystemSurface.failureSuffix(app))
            return
        }
        print("mention verdict: " + verdict.label)
        XCTAssertTrue(verdict.label.hasPrefix("mention:pass"), "The mentions did not draw: " + verdict.label + SystemSurface.failureSuffix(app))
        var spoken = Set<String>()
        var last = "the window could not be read"
        let judged = Date().addingTimeInterval(30)
        while true {
            let held = labels(app)
            spoken = Set(spokenLabels.filter { held.contains($0) })
            if spoken.count == spokenLabels.count { break }
            last = "the last reading held: " + held.prefix(20).joined(separator: " | ")
            if Date() >= judged { break }
            _ = XCTWaiter.wait(for: [XCTestExpectation(description: "the mention draws on")], timeout: 0.25)
        }
        for label in spokenLabels {
            XCTAssertTrue(spoken.contains(label), "VoiceOver is not told who the mention names: " + label + " (" + last + ")" + SystemSurface.failureSuffix(app))
        }
        print("mention spoken: " + spoken.sorted().joined(separator: ", "))
    }

    /// Every label in one snapshot of the app's window, in tree order.
    private func labels(_ app: XCUIApplication) -> [String] {
        guard let window = try? app.snapshot() else { return [] }
        var out: [String] = []
        collect(window, into: &out)
        return out
    }

    private func collect(_ node: XCUIElementSnapshot, into out: inout [String]) {
        if out.count >= 400 { return }
        let label = node.label.trimmingCharacters(in: .whitespacesAndNewlines)
        if !label.isEmpty { out.append(label) }
        for child in node.children { collect(child, into: &out) }
    }
}
