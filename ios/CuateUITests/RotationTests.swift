import UIKit
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
            let attachment = XCTAttachment(screenshot: settled(app, landscape: label == "landscape"))
            attachment.name = label
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    // The page reports its new size before the rotation animation has finished drawing, so a screenshot taken the
    // moment the proof appears can catch the old frame turned on its side. The capture waits until the window and the
    // web view both have the new orientation, the web view fills the window, and two screenshots in a row draw the same
    // picture (a blinking caret is too small to count), so what is kept is the settled layout and a clipped one fails.
    private func settled(_ app: XCUIApplication, landscape: Bool) -> XCUIScreenshot {
        let deadline = Date().addingTimeInterval(20)
        var previous: [UInt8]?
        var last = "no sample"
        repeat {
            let window = app.windows.firstMatch.frame
            let web = app.webViews.firstMatch.frame
            let shot = app.screenshot()
            let size = shot.image.size
            let current = thumbnail(shot.image)
            let turned = (window.width > window.height) == landscape && (size.width > size.height) == landscape
            let fills = web.width * web.height >= window.width * window.height * 0.8
            let change = previous.map { difference($0, current) } ?? Double.infinity
            last = "window \(window) web \(web) image \(size) change \(change)"
            if turned && fills && change < 1.0 { return shot }
            previous = current
        } while Date() < deadline
        XCTFail("Rotation never settled: " + last)
        return app.screenshot()
    }

    private func thumbnail(_ image: UIImage) -> [UInt8] {
        let side = 48
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        guard let cg = image.cgImage,
              let context = CGContext(data: &pixels, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return pixels }
        context.interpolationQuality = .medium
        context.draw(cg, in: CGRect(x: 0, y: 0, width: side, height: side))
        return pixels
    }

    // Mean absolute channel difference, 0 to 255.
    private func difference(_ a: [UInt8], _ b: [UInt8]) -> Double {
        var total = 0
        for i in 0..<min(a.count, b.count) { total += abs(Int(a[i]) - Int(b[i])) }
        return Double(total) / Double(max(1, a.count))
    }
}
