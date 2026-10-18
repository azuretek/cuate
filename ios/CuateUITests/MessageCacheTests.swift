import XCTest

// Issue 441: the device's message store, measured in the shell's own web view. The fixture
// (core/test/message-cache-fixture.js) signs the real page in to a stand-in server over an emulated slow link and says
// what a launch cost: the bytes the server sent and the time from sign-in to the first message drawn in the conversation
// it opens. Four launches of the app, each a real relaunch over the same web view storage: without the store (a web view
// with no IndexedDB, the page as it was before the store) and with it, each cold (an empty store) and warm (the store
// the cold launch left). The measurements are printed for the pull request and kept as an attachment.
final class MessageCacheTests: XCTestCase {
    func testWarmLaunchDrawsFromTheStoreAndAsksOnlyForWhatChanged() throws {
        var results: [String: [String: Any]] = [:]
        for (mode, run) in [("off", "cold"), ("off", "warm"), ("on", "cold"), ("on", "warm")] {
            let app = XCUIApplication()
            app.launchArguments = ["--message-cache-fixture", "--fixture-cache-" + mode, "--fixture-cache-" + run]
            XCUIDevice.shared.startInPortrait()
            app.launch()
            let label = { (prefix: String) in app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch }
            let settled = NSPredicate { _, _ in label("cache:result").exists || label("cache:fail").exists }
            _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: nil)], timeout: 120)
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = "message-cache-" + mode + "-" + run
            shot.lifetime = .keepAlways
            add(shot)
            let failure = label("cache:fail")
            if failure.exists { XCTFail(mode + " " + run + ": " + failure.label); app.terminate(); return }
            let text = label("cache:result").label
            guard text.hasPrefix("cache:result "),
                  let data = String(text.dropFirst("cache:result ".count)).data(using: .utf8),
                  let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                XCTFail(mode + " " + run + " gave no measurement: " + app.debugDescription)
                app.terminate()
                return
            }
            print("MESSAGE CACHE " + String(text.dropFirst("cache:result ".count)))
            let kept = XCTAttachment(string: text)
            kept.name = "message-cache-" + mode + "-" + run + ".json"
            kept.lifetime = .keepAlways
            add(kept)
            results[mode + "-" + run] = result
            app.terminate()
        }
        let number = { (key: String, field: String) -> Double in (results[key]?[field] as? NSNumber)?.doubleValue ?? -1 }
        XCTAssertEqual(results["on-cold"]?["store"] as? Bool, true, "the iOS web view keeps the store")
        XCTAssertEqual(results["on-warm"]?["store"] as? Bool, true)
        XCTAssertEqual(results["off-warm"]?["store"] as? Bool, false, "with IndexedDB refused the page opens no store")
        XCTAssertEqual(number("on-warm", "pageReads"), 0, "a warm open reads no page of a conversation the store holds")
        XCTAssertEqual(number("on-warm", "pictureReads"), 0, "nor any picture a tile drew before")
        XCTAssertGreaterThan(number("off-warm", "photoReads"), 0, "without the store a conversation's photo and backdrop are read on every launch")
        XCTAssertEqual(number("on-warm", "photoReads"), 0, "and with it on none")
        XCTAssertGreaterThanOrEqual(number("on-warm", "themedMs"), 0, "a warm open draws its scheme")
        XCTAssertLessThan(number("on-warm", "themedMs"), number("off-warm", "themedMs") / 2, "and its scheme is drawn in a fraction of the time")
        XCTAssertEqual(results["on-warm"]?["shownEdit"] as? Bool, true, "and still draws an edit made while it was closed")
        XCTAssertLessThan(number("on-warm", "bytes"), number("off-warm", "bytes") / 4, "a warm open costs a fraction of the bytes it did")
        XCTAssertLessThan(number("on-warm", "firstVisibleMs"), number("off-warm", "firstVisibleMs") / 2, "and draws its first message in a fraction of the time")
    }
}
