import XCTest

// Issue 386: pressing LIVE on a Live Photo on iPhone drew an empty grey box and the motion never played. The fixture
// (core/test/live-photo-fixture.js) opens the real media viewer on a synthetic Live Photo in this shell's own web view;
// this test presses the LIVE control as a finger does, since the defect is in what WebKit allows after a person's press,
// and reads the page's verdict: the motion played, in the still's own box, and the still came back when it ended.
final class LivePhotoTests: XCTestCase {
    func testLiveControlPlaysTheMotion() {
        let app = XCUIApplication()
        app.launchArguments = ["--live-photo-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let marker = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'live:'")).firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 60), app.debugDescription)
        settle(marker, on: "label == 'live:ready' OR label BEGINSWITH 'live:fail'", timeout: 60)
        XCTAssertEqual(marker.label, "live:ready", "the viewer never offered its Live Photo: " + marker.label + SystemSurface.failureSuffix(app))
        guard marker.label == "live:ready", pressLive(app, marker: marker) else { return }
        settle(marker, on: "label BEGINSWITH 'live:pass' OR label BEGINSWITH 'live:fail'", timeout: 40)
        // The page's verdict in the log, passed or failed, so a run says what the motion did.
        print("live photo verdict: " + marker.label)
        XCTAssertTrue(marker.label.hasPrefix("live:pass"), "pressing LIVE did not play the motion: " + marker.label + SystemSurface.failureSuffix(app))
    }

    /// Waits until the page's marker reads one of the states named, or the bound passes; the caller reads the label.
    private func settle(_ marker: XCUIElement, on format: String, timeout: TimeInterval) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: format), object: marker)
        _ = XCTWaiter().wait(for: [expectation], timeout: timeout)
    }

    /// Presses LIVE until the page reports the click arrived (`live:pressed` or a later state), because a tap XCTest
    /// makes can be lost before the page sees it (issue 384), and a lost tap is not the defect this test is about. It
    /// presses again only while the page has seen no click, so a second press never stops a motion the first started.
    /// The control is found by its label; where the web view does not expose it, it is pressed at the point the page
    /// reports for it (`where:live x y width height`, in the page's own coordinates, scaled onto the web view).
    private func pressLive(_ app: XCUIApplication, marker: XCUIElement) -> Bool {
        let page = app.webViews.firstMatch
        let control = page.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Play the Live Photo")).firstMatch
        let spot = page.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'where:live '")).firstMatch
        let deadline = Date().addingTimeInterval(30)
        var presses: [String] = []
        repeat {
            if control.waitForExistence(timeout: 2) {
                presses.append("\(control.isHittable ? "hittable" : "not hittable") at \(control.frame)")
                control.tap()
            } else if spot.exists, let point = pagePoint(spot.label, in: page) {
                presses.append("not in the accessibility tree, pressed at \(spot.label) in web view \(page.frame)")
                page.coordinate(withNormalizedOffset: .zero).withOffset(point).tap()
            } else {
                presses.append("no LIVE control")
                continue
            }
            settle(marker, on: "label != 'live:ready'", timeout: 3)
            if marker.label != "live:ready" { return true }
        } while Date() < deadline
        XCTFail("LIVE was pressed \(presses.count) times and the click never reached the page. Each press: " + presses.joined(separator: " | ") + SystemSurface.failureSuffix(app) + "\n" + app.debugDescription)
        return false
    }

    /// The page's point for the control, from its report, scaled from the page's viewport onto the web view's frame.
    private func pagePoint(_ label: String, in page: XCUIElement) -> CGVector? {
        let parts = label.split(separator: " ").compactMap { Double($0) }
        guard parts.count == 4, parts[2] > 0, parts[3] > 0 else { return nil }
        let frame = page.frame
        return CGVector(dx: parts[0] * Double(frame.width) / parts[2], dy: parts[1] * Double(frame.height) / parts[3])
    }
}
