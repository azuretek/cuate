import XCTest

final class RotationTests: XCTestCase {
    func testConversationSurvivesPortraitLandscapePortrait() {
        let app = XCUIApplication()
        app.launchArguments = ["--rotation-fixture"]
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }
        for (orientation, label) in [(UIDeviceOrientation.portrait, "portrait"), (.landscapeLeft, "landscape"), (.portrait, "portrait")] {
            XCUIDevice.shared.orientation = orientation
            let proof = app.webViews.staticTexts[label + ":pass"].firstMatch
            XCTAssertTrue(proof.waitForExistence(timeout: 20), app.debugDescription)
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = label
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }
}
