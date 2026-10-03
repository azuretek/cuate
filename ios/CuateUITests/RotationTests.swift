import UIKit
import XCTest

final class RotationTests: XCTestCase {
    func testLightConversation() { conversation(scheme: "light") }
    func testDarkConversation() { conversation(scheme: "dark") }

    private func conversation(scheme: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--rotation-fixture"] + (scheme == "dark" ? ["--fixture-dark"] : [])
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
            let attachment = XCTAttachment(image: settled(app, landscape: label == "landscape"))
            attachment.name = scheme + "-" + label
            attachment.lifetime = .keepAlways
            add(attachment)
            if label == "landscape" {
                // The screen exactly as the simulator returned it, so the turn applied above can be checked.
                let raw = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                raw.name = "landscape-as-returned"
                raw.lifetime = .keepAlways
                add(raw)
            }
        }
    }

    // The capture waits until the window and the web view both have the new orientation, the web view fills the window,
    // and two screenshots in a row draw the same picture (a blinking caret is too small to count), so a frame caught
    // mid-rotation is never kept and a clipped layout fails. It is a screenshot of the whole screen: the app's own
    // screenshot crops a landscape screen by the app's portrait frame, which Xcode saved sideways and cut in half and
    // which read as a clipped layout while the web view filled the window.
    private func settled(_ app: XCUIApplication, landscape: Bool) -> UIImage {
        let deadline = Date().addingTimeInterval(20)
        var previous: [UInt8]?
        var last = "no sample"
        repeat {
            let window = app.windows.firstMatch.frame
            let web = app.webViews.firstMatch.frame
            let image = upright(XCUIScreen.main.screenshot().image, landscape: landscape)
            let size = image.size
            let current = thumbnail(image)
            let turned = (window.width > window.height) == landscape && (size.width > size.height) == landscape
            let fills = web.width * web.height >= window.width * window.height * 0.8
            let change = previous.map { difference($0, current) } ?? Double.infinity
            let pixels = image.cgImage.map { "\($0.width)x\($0.height)" } ?? "none"
            last = "window \(window) web \(web) image \(size) pixels \(pixels) change \(change)"
            if turned && fills && change < 1.0 { return image }
            previous = current
        } while Date() < deadline
        XCTFail("Rotation never settled: " + last)
        return XCUIScreen.main.screenshot().image
    }

    // The simulator hands back a landscape screen in the device's portrait frame. The device is turned landscapeLeft,
    // so the top of the page lies along that frame's right edge, and a quarter turn anticlockwise stands it up.
    private func upright(_ image: UIImage, landscape: Bool) -> UIImage {
        guard landscape, let cg = image.cgImage, cg.width < cg.height,
              let context = CGContext(data: nil, width: cg.height, height: cg.width, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return image }
        context.translateBy(x: CGFloat(cg.height), y: 0)
        context.rotate(by: .pi / 2)
        context.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
        guard let turned = context.makeImage() else { return image }
        return UIImage(cgImage: turned, scale: image.scale, orientation: .up)
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
