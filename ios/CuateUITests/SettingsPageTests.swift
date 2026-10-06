import XCTest

// Issue 167: Settings on iPhone is a page that fills the screen, with one tab per section and every setting the desktop
// offers reached from one; issue 168: its way back to the chats list is the chats icon with its label. The fixture
// (core/test/settings-fixture.js) drives the real components and walks every tab; this test waits for its proof and keeps
// a light and a dark capture of the page.
final class SettingsPageTests: XCTestCase {
    func testLightSettings() { settings(scheme: "light") }
    func testDarkSettings() { settings(scheme: "dark") }

    private func settings(scheme: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--settings-fixture"] + (scheme == "dark" ? ["--fixture-dark"] : [])
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let proof = app.webViews.staticTexts["settings:pass"].firstMatch
        XCTAssertTrue(proof.waitForExistence(timeout: 30), app.debugDescription)
        let attachment = XCTAttachment(image: settled(app))
        attachment.name = "settings-" + scheme
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
