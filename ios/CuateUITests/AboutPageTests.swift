import XCTest

// Issue 171: the About page on iPhone is the same page the desktop draws, opened from Settings' last row, and its
// Check for updates reads the release feed through this shell's own bridge (updates.releases, issue 192), whose answer
// arrives as the app notice. The fixture
// (core/test/about-fixture.js) drives the real components; this test waits for its proof and keeps a light and a dark
// capture of the page. The notice floats over the top of the card (issue 253), so the fixture dismisses it once its
// words are read, and the captures show the page.
final class AboutPageTests: XCTestCase {
    func testLightAbout() { about(scheme: "light") }
    func testDarkAbout() { about(scheme: "dark") }

    private func about(scheme: String) {
        let app = XCUIApplication()
        // --update-fixture: the shell reads a synthetic release feed naming a newer build (issue 192), so the capture is
        // the update-available state, the notice and About's button both offering TestFlight.
        app.launchArguments = ["--about-fixture", "--update-fixture"] + (scheme == "dark" ? ["--fixture-dark"] : [])
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let proof = app.webViews.staticTexts["about:pass"].firstMatch
        XCTAssertTrue(proof.waitForExistence(timeout: 30), app.debugDescription)
        // The shell reports its channel and build (issue 192), so About shows neither as Unknown.
        let reported = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'about:build '")).firstMatch
        XCTAssertTrue(reported.waitForExistence(timeout: 5), app.debugDescription)
        let values = Dictionary(uniqueKeysWithValues: reported.label.dropFirst("about:build ".count).split(separator: " ").compactMap { pair -> (String, String)? in
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            return parts.count == 2 ? (parts[0], parts[1]) : nil
        })
        for key in ["channel", "build"] {
            let value = values[key] ?? ""
            XCTAssertFalse(value.isEmpty || value == "Unknown", "About shows this build's \(key): " + reported.label)
        }
        keep(settled(app), name: "about-" + scheme)
        // The build report, scrolled into view inside the sheet, so a capture shows the channel and the build. Each drag
        // is slow and held at its end, so the sheet's body moves by the drag alone and never flings past the rows; the
        // loop ends when the Build row is on screen, and the count only bounds it.
        let page = app.webViews.firstMatch
        let buildRow = page.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Copy Build:'")).firstMatch
        XCTAssertTrue(buildRow.waitForExistence(timeout: 5), app.debugDescription)
        let visibleBottom = page.frame.minY + page.frame.height * 0.85
        var drags = 0
        while buildRow.frame.maxY > visibleBottom && drags < 8 {
            page.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
                .press(forDuration: 0.1, thenDragTo: page.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6)), withVelocity: .slow, thenHoldForDuration: 0.3)
            drags += 1
        }
        XCTAssertLessThanOrEqual(buildRow.frame.maxY, visibleBottom, "the Build row never scrolled into view: \(buildRow.frame)" + SystemSurface.failureSuffix(app))
        keep(settled(app), name: "about-build-" + scheme)
    }

    private func keep(_ image: UIImage, name: String) {
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // Two screenshots in a row that draw the same picture, so a frame still arriving is never kept.
    private func settled(_ app: XCUIApplication) -> UIImage {
        SystemSurface.requireOurs(app)
        let deadline = Date().addingTimeInterval(20)
        var previous: Data?
        repeat {
            let shot = XCUIScreen.main.screenshot()
            let current = shot.pngRepresentation
            if let last = previous, last == current { return shot.image }
            previous = current
        } while Date() < deadline
        return XCUIScreen.main.screenshot().image
    }
}
