import XCTest

// Issue 171: the About page on iPhone is the same page the desktop draws, opened from Settings' last row, and its
// Check for updates reads the release feed through this shell's own bridge (updates.releases, issue 192), whose answer
// arrives as the app notice. The fixture
// (core/test/about-fixture.js) drives the real components; this test waits for its proof and keeps a light and a dark
// capture of the page with the notice up.
final class AboutPageTests: XCTestCase {
    func testLightAbout() { about(scheme: "light") }
    func testDarkAbout() { about(scheme: "dark") }

    private func about(scheme: String) {
        let app = XCUIApplication()
        // --update-fixture: the shell reads a synthetic release feed naming a newer build (issue 192), so the capture is
        // the update-available state, the notice and About's button both offering TestFlight.
        app.launchArguments = ["--about-fixture", "--update-fixture"] + (scheme == "dark" ? ["--fixture-dark"] : [])
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        defer { app.terminate() }
        let proof = app.webViews.staticTexts["about:pass"].firstMatch
        XCTAssertTrue(proof.waitForExistence(timeout: 30), app.debugDescription)
        let attachment = XCTAttachment(image: settled())
        attachment.name = "about-" + scheme
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // Two screenshots in a row that draw the same picture, so a frame still arriving is never kept.
    private func settled() -> UIImage {
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
