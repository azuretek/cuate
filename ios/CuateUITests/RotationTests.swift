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
            let appeared = proof.waitForExistence(timeout: 20)
            // A wait that times out must name the state it saw, never proceed on an element that was not there: the
            // fixture's own diagnosis, and the window against the page, so a red run says which check failed and
            // whether the shell and the page disagree on the orientation (issue 199).
            XCTAssertTrue(appeared, "the \(scheme) \(label) verdict never read pass: " + diagnosis(app) + " :: " + app.debugDescription)
            guard appeared else { return }
            let image = settled(app, proof: proof, landscape: label == "landscape")
            // The verdict must still read pass once the screen has settled, so a capture never keeps a fail label.
            XCTAssertTrue(proof.exists, "the \(scheme) \(label) verdict stopped reading pass during the capture: " + diagnosis(app) + " :: " + app.debugDescription)
            let attachment = XCTAttachment(image: image)
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
    // the verdict's own pixels show its pass fill, and two screenshots in a row draw the same picture (a blinking caret
    // is too small to count), so a frame caught mid-rotation, or one drawn before the verdict turned pass, is never kept
    // and a clipped layout fails. It is a screenshot of the whole screen: the app's own
    // screenshot crops a landscape screen by the app's portrait frame, which Xcode saved sideways and cut in half and
    // which read as a clipped layout while the web view filled the window.
    private func settled(_ app: XCUIApplication, proof: XCUIElement, landscape: Bool) -> UIImage {
        let deadline = Date().addingTimeInterval(20)
        var previous: [UInt8]?
        var last = "no sample"
        repeat {
            // Read the verdict's own frame only while its element is present, and only crop a capture with that frame:
            // the label a screenshot is judged against must be the one that existed at the moment it was taken, never
            // an element the test did not check (issue 201).
            guard proof.exists else {
                last = "the verdict label was not present: " + diagnosis(app)
                continue
            }
            let label = proof.frame
            let window = app.windows.firstMatch.frame
            let web = app.webViews.firstMatch.frame
            let image = upright(XCUIScreen.main.screenshot().image, landscape: landscape)
            let size = image.size
            let current = thumbnail(image)
            let turned = (window.width > window.height) == landscape && (size.width > size.height) == landscape
            let fills = web.width * web.height >= window.width * window.height * 0.8
            let change = previous.map { difference($0, current) } ?? Double.infinity
            let pixels = image.cgImage.map { "\($0.width)x\($0.height)" } ?? "none"
            let verdict = verdictShown(image, label: label)
            last = "window \(window) web \(web) image \(size) pixels \(pixels) change \(change) verdict \(verdict) label \(label)"
            // The element must still be there once the passing frame was found, so the image kept is of the pass it saw.
            if turned && fills && verdict == "pass" && change < 1.0 && proof.exists { return image }
            previous = current
        } while Date() < deadline
        XCTFail("Rotation never settled: " + last)
        return XCUIScreen.main.screenshot().image
    }

    // What a red run should always say: the fixture's own last sample (its state, failing checks, the sample it last
    // failed on and the frame counter) and whether the shell window and the page's web view agree on the orientation
    // (issue 199). The diagnosis element is the fixture's own, so it is read from the page, not inferred.
    private func diagnosis(_ app: XCUIApplication) -> String {
        let window = app.windows.firstMatch.frame
        let web = app.webViews.firstMatch.frame
        let page = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "rotation-diagnosis")).firstMatch
        let disagree = (window.width > window.height) != (web.width > web.height)
        return "window \(window) web \(web) windowAndWebDisagree \(disagree) :: \(page.exists ? page.label : "no diagnosis")"
    }

    // The fixture fills its verdict green for pass and red for fail, and draws it over everything, so every pixel inside
    // the label's frame is either that fill or its white text. The capture says which verdict it caught by which fill
    // covers a quarter of that frame, whether the frame is the whole label or only its text.
    private func verdictShown(_ image: UIImage, label: CGRect) -> String {
        guard let cg = image.cgImage, image.size.width > 0 else { return "no pixels" }
        let scale = CGFloat(cg.width) / image.size.width
        let box = CGRect(x: label.minX * scale, y: label.minY * scale, width: label.width * scale, height: label.height * scale)
            .insetBy(dx: scale, dy: scale).integral
            .intersection(CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
        guard box.width >= 1, box.height >= 1, let crop = cg.cropping(to: box) else { return "off-screen at \(box)" }
        let width = crop.width, height = crop.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return "no context" }
        context.draw(crop, in: CGRect(x: 0, y: 0, width: width, height: height))
        var green = 0
        var red = 0
        for i in stride(from: 0, to: pixels.count, by: 4) {
            let r = Int(pixels[i]), g = Int(pixels[i + 1]), b = Int(pixels[i + 2])
            if g > r + 60 && g > b + 30 { green += 1 }
            if r > g + 60 && r > b + 60 { red += 1 }
        }
        let quarter = width * height / 4
        if green >= quarter && red == 0 { return "pass" }
        if red >= quarter { return "fail" }
        return "unknown: \(green) green and \(red) red of \(width * height) in \(box)"
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
