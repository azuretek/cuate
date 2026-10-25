import XCTest
import UIKit

// Issue 417: a participant changing the conversation's background showed as an empty notice. The fixture
// (core/test/background-fixture.js) draws the real conversation in this shell's own web view, for a synthetic group
// whose chat carries its background and whose history holds the change. This test reads the page's verdict (the line
// names who changed it, nothing is an empty notice, the backdrop is out of the timeline) and then the screen itself:
// the colour the simulator shows at a point of bare conversation must be the backdrop's, not the surface's.
final class BackgroundTests: XCTestCase {
    private let colour = (r: 230, g: 30, b: 160)

    func testBackgroundIsTheBackdropAndTheChangeIsALine() {
        let app = XCUIApplication()
        app.launchArguments = ["--background-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let deadline = ProcessInfo.processInfo.systemUptime + 90
        let verdict = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'background:'")).firstMatch
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'background:pass' OR label BEGINSWITH 'background:fail'"), object: verdict)
        _ = XCTWaiter().wait(for: [settled], timeout: max(0, deadline - ProcessInfo.processInfo.systemUptime))
        var shot = XCUIScreen.main.screenshot()
        defer {
            let capture = XCTAttachment(screenshot: shot)
            capture.name = "conversation-background"
            capture.lifetime = .keepAlways
            add(capture)
        }
        guard verdict.exists else {
            XCTFail("The background fixture reported nothing" + SystemSurface.failureSuffix(app))
            return
        }
        print("background verdict: " + verdict.label)
        XCTAssertTrue(verdict.label.hasPrefix("background:pass"), "The conversation did not draw its background: " + verdict.label + SystemSurface.failureSuffix(app))
        let line = app.webViews.staticTexts["Sam Example changed the background"]
        XCTAssertTrue(line.exists, "The change must read as a line naming who changed it")

        let spot = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'where:backdrop '")).firstMatch
        guard spot.exists, let point = screenPoint(spot.label, in: app.webViews.firstMatch.frame) else {
            XCTFail("The fixture named no point of bare backdrop")
            return
        }
        // The page can name its loaded image before the simulator has composited it. Read the screen's
        // actual pixel, not a sleep or a second DOM marker, and spend only the original startup budget.
        var readiness = BackdropReadiness(deadline: deadline, colour: colour)
        var lastPixel: BackdropReadiness.Pixel?
        repeat {
            shot = XCUIScreen.main.screenshot()
            lastPixel = pixel(shot.image, at: point)
            _ = readiness.sample(at: ProcessInfo.processInfo.systemUptime, pixel: lastPixel)
        } while readiness.status == .waiting
        XCTAssertEqual(readiness.status, .ready, "The backdrop did not paint within the original startup deadline")
        guard let seen = lastPixel else {
            XCTFail("The screen could not be read at \(point)")
            return
        }
        print("backdrop pixel at \(point): \(seen.r),\(seen.g),\(seen.b)")
        let close = BackdropReadiness.matches(seen, colour: colour)
        XCTAssertTrue(close, "The screen shows \(seen.r),\(seen.g),\(seen.b) behind the messages, not the backdrop's \(colour.r),\(colour.g),\(colour.b)")
    }

    /// The page's point, from its report (x y width height in page coordinates), scaled onto the web view on screen.
    private func screenPoint(_ label: String, in frame: CGRect) -> CGPoint? {
        let parts = label.split(separator: " ").compactMap { Double($0) }
        guard parts.count == 4, parts[2] > 0, parts[3] > 0 else { return nil }
        return CGPoint(x: frame.minX + CGFloat(parts[0] / parts[2]) * frame.width, y: frame.minY + CGFloat(parts[1] / parts[3]) * frame.height)
    }

    /// One pixel of the screenshot, at a point in screen points, as 8-bit red, green and blue.
    private func pixel(_ image: UIImage, at point: CGPoint) -> (r: Int, g: Int, b: Int)? {
        guard let cg = image.cgImage, image.size.width > 0 else { return nil }
        let scale = CGFloat(cg.width) / image.size.width
        let x = Int(point.x * scale)
        let y = Int(point.y * scale)
        guard x >= 0, y >= 0, x < cg.width, y < cg.height else { return nil }
        var data = [UInt8](repeating: 0, count: 4)
        let drawn: Bool = data.withUnsafeMutableBytes { raw in
            guard let context = CGContext(data: raw.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(cg, in: CGRect(x: -x, y: y - cg.height + 1, width: cg.width, height: cg.height))
            return true
        }
        return drawn ? (Int(data[0]), Int(data[1]), Int(data[2])) : nil
    }
}
