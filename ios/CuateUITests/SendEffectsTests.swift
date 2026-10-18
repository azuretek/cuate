import XCTest

// Issue 442: a message sent with a bubble or screen effect arrived as an ordinary message. The fixture
// (core/test/send-effects-fixture.js) draws the real conversation in this shell's own web view, hands it a synthetic
// message sent with each of Messages' thirteen effects as it would arrive, and reports a verdict: every bubble effect
// playing on its bubble, every screen effect over the conversation, Invisible Ink veiled until pressed, a line under each
// naming it with a Replay control, and a message already in the history named but never played.
final class SendEffectsTests: XCTestCase {
    func testEveryEffectPlaysWhereItBelongsAndIsNamed() {
        let app = XCUIApplication()
        app.launchArguments = ["--send-effects-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let verdict = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'sendfx:'")).firstMatch
        let early = XCUIScreen.main.screenshot()
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'sendfx:pass' OR label BEGINSWITH 'sendfx:fail'"), object: verdict)
        _ = XCTWaiter().wait(for: [settled], timeout: 120)
        let playing = XCTAttachment(screenshot: early)
        playing.name = "send-effects-launch"
        playing.lifetime = .keepAlways
        add(playing)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "send-effects-settled"
        shot.lifetime = .keepAlways
        add(shot)
        guard verdict.exists else {
            XCTFail("The send effects fixture reported nothing" + SystemSurface.failureSuffix(app))
            return
        }
        print("send effects verdict: " + verdict.label)
        XCTAssertTrue(verdict.label.hasPrefix("sendfx:pass"), "The effects did not play: " + verdict.label + SystemSurface.failureSuffix(app))
        XCTAssertTrue(app.webViews.staticTexts["Sent with Confetti"].firstMatch.exists, "The line under a message must name its effect")
    }
}
