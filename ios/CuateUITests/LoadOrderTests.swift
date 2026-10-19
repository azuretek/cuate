import XCTest

// Issue 425: a conversation fetched its pictures in page order, so in one opened at its newest message the pictures
// above the view were asked for before the ones on screen. The fixture (core/test/load-order-fixture.js) signs the real
// page in to a stand-in server over an emulated slow link, opens a conversation of synthetic photos and measures, in
// this shell's own web view, how long the first message and the first picture on screen take, and whether any picture
// off screen was asked for while one on screen was still waiting. The measurement is printed and kept with the run, so
// a before and an after can be read side by side.
final class LoadOrderTests: XCTestCase {
    func testOnScreenMediaLoadsBeforeOffScreenMedia() {
        let app = XCUIApplication()
        app.launchArguments = ["--load-order-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let marker = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'order:'")).firstMatch
        let measured = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'order:ready' OR label BEGINSWITH 'order:fail'"), object: marker)
        _ = XCTWaiter().wait(for: [measured], timeout: 180)
        guard marker.exists, marker.label.hasPrefix("order:ready ") else {
            XCTFail("the load order fixture did not measure: " + (marker.exists ? marker.label : "no marker") + SystemSurface.failureSuffix(app))
            return
        }
        let raw = String(marker.label.dropFirst("order:ready ".count))
        print("load order fixture: " + raw)
        let report = XCTAttachment(string: raw)
        report.name = "load-order measurement"
        report.lifetime = .keepAlways
        add(report)
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "load-order screen"
        capture.lifetime = .keepAlways
        add(capture)

        guard let json = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any] else {
            XCTFail("the load order measurement is not JSON: " + raw)
            return
        }
        let early = json["offscreenBeforeOnscreen"] as? Int ?? -1
        let ids = (json["offscreenBeforeOnscreenIds"] as? [String] ?? []).joined(separator: ", ")
        XCTAssertEqual(early, 0, "pictures off screen were asked for while one on screen was still waiting: " + ids)
        // Issue 426: an avatar is fetched in the same order, so none is asked for off screen while the screen waits.
        let avatarEarly = json["avatarEarly"] as? Int ?? -1
        let avatarIds = (json["avatarEarlyIds"] as? [String] ?? []).joined(separator: ", ")
        XCTAssertEqual(avatarEarly, 0, "avatars off screen were asked for while something on screen was still waiting: " + avatarIds)
        // Issue 427: a start asks for its info, its conversations and its settings together.
        XCTAssertEqual(json["startTogether"] as? Bool, true, "the start read its info, conversations and settings one after another: " + raw)
        let onScreen = json["onScreen"] as? [String] ?? []
        XCTAssertFalse(onScreen.isEmpty, "no picture was on screen to measure")
        // A fling up through the history: no fetch is still going for a row flung past once the view has stopped.
        let fling = json["fling"] as? [String: Any] ?? [:]
        XCTAssertEqual(fling["allDrawn"] as? Bool, true, "the pictures where the fling stopped never all drew: " + raw)
        let stale = fling["staleAtStop"] as? Int ?? -1
        let staleIds = (fling["staleAtStopIds"] as? [String] ?? []).joined(separator: ", ")
        XCTAssertEqual(stale, 0, "fetches for rows flung past were still going when the view stopped: " + staleIds)
    }
}
