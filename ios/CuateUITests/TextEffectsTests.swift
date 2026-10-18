import XCTest

// Issue 433: a text effect a sender chose in Messages drew as plain words. The fixture (core/test/text-effects-fixture.js)
// draws the real conversation in this shell's own web view for synthetic messages carrying each of Messages' eight
// effects, samples them while they play, and reports a verdict: every effect over its own stretch, playing, the Big
// stretch growing past its settled size, and every one settled back to the words as sent.
final class TextEffectsTests: XCTestCase {
    func testEveryTextEffectPlaysOverItsStretch() {
        let app = XCUIApplication()
        app.launchArguments = ["--text-effects-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let verdict = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'textfx:'")).firstMatch
        let early = XCUIScreen.main.screenshot()
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'textfx:pass' OR label BEGINSWITH 'textfx:fail'"), object: verdict)
        _ = XCTWaiter().wait(for: [settled], timeout: 90)
        let playing = XCTAttachment(screenshot: early)
        playing.name = "text-effects-launch"
        playing.lifetime = .keepAlways
        add(playing)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "text-effects-settled"
        shot.lifetime = .keepAlways
        add(shot)
        guard verdict.exists else {
            XCTFail("The text effects fixture reported nothing" + SystemSurface.failureSuffix(app))
            return
        }
        print("text effects verdict: " + verdict.label)
        XCTAssertTrue(verdict.label.hasPrefix("textfx:pass"), "The text effects did not play: " + verdict.label + SystemSurface.failureSuffix(app))
        XCTAssertTrue(app.webViews.staticTexts["Plain words, no effect."].exists, "The plain message must read as sent")
    }
}
