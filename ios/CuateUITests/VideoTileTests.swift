import XCTest
import UIKit

// Issue 415: a video in a conversation was drawn as a blank tile on iPhone, because the tile's video element read only
// its metadata and WKWebView paints no frame for that. The fixture (core/test/video-tile-fixture.js) draws two
// synthetic video tiles in this shell's own web view, one whose server sends a poster and one whose server has none;
// this test reads each tile's own pixels, since a blank tile is exactly what the page cannot see about itself.
final class VideoTileTests: XCTestCase {
    private let tiles = ["Play poster-clip.mp4", "Play plain-clip.mp4"]

    func testVideoTilesShowAPicture() {
        let app = XCUIApplication()
        app.launchArguments = ["--video-tile-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let marker = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'video:'")).firstMatch
        let drawn = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'video:ready' OR label BEGINSWITH 'video:fail'"), object: marker)
        _ = XCTWaiter().wait(for: [drawn], timeout: 120)
        guard marker.exists, marker.label.hasPrefix("video:ready") else {
            XCTFail("the video tile fixture did not draw: " + (marker.exists ? marker.label : "no marker") + SystemSurface.failureSuffix(app))
            return
        }
        print("video tile fixture: " + marker.label)
        SystemSurface.requireOurs(app)

        // A frame can take a moment to decode after the tile is drawn, so each tile is read until it shows a picture or
        // the bound passes; the verdict is the last reading of each.
        let page = app.webViews.firstMatch
        var readings: [String: TileReading] = [:]
        let pictured = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            for name in self.tiles {
                let tile = page.descendants(matching: .any).matching(NSPredicate(format: "label == %@", name)).firstMatch
                guard tile.exists, !tile.frame.isEmpty else { readings[name] = nil; continue }
                readings[name] = TileReading(tile.screenshot().image, frame: tile.frame)
            }
            return self.tiles.allSatisfy { readings[$0]?.pictured == true }
        }, object: nil)
        _ = XCTWaiter().wait(for: [pictured], timeout: 30)

        for name in tiles {
            let tile = page.descendants(matching: .any).matching(NSPredicate(format: "label == %@", name)).firstMatch
            if tile.exists, !tile.frame.isEmpty {
                let capture = XCTAttachment(image: tile.screenshot().image)
                capture.name = "video-tile " + name
                capture.lifetime = .keepAlways
                add(capture)
            }
            let reading = readings[name]
            print("video tile " + name + ": " + (reading?.summary ?? "not on screen"))
            XCTAssertTrue(reading?.pictured == true, "the tile " + name + " is blank: " + (reading?.summary ?? "not on screen") + SystemSurface.failureSuffix(app))
        }
    }
}

/// What a tile's pixels show, read from the top half of its picture inset from every edge, which keeps the rounded
/// edge, the border and the play mark at its foot out of the reading. A blank tile is one flat colour there; a picture
/// (the poster's bands, the test pattern's frame) spreads its brightness widely. The tile's frame on screen is part of
/// the reading, so two tiles that show the same picture are still seen to be two tiles.
struct TileReading {
    let frame: CGRect
    let width: Int
    let height: Int
    let spread: Double
    let distinct: Int

    var pictured: Bool { width >= 40 && height >= 40 && spread >= 12 && distinct >= 8 }
    var summary: String { "at \(Int(frame.minX)),\(Int(frame.minY)) \(Int(frame.width))x\(Int(frame.height)) pt, \(width)x\(height) px, brightness spread \(String(format: "%.1f", spread)), \(distinct) distinct colours" }

    init(_ image: UIImage, frame: CGRect) {
        self.frame = frame
        guard let cg = image.cgImage else { width = 0; height = 0; spread = 0; distinct = 0; return }
        let w = cg.width, h = cg.height
        width = w
        height = h
        var data = [UInt8](repeating: 0, count: w * h * 4)
        let drew = data.withUnsafeMutableBytes { buffer -> Bool in
            guard let ctx = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drew, w > 10, h > 10 else { spread = 0; distinct = 0; return }
        var sum = 0.0, squares = 0.0, count = 0.0
        var colours = Set<UInt32>()
        for y in stride(from: h / 10, to: h / 2, by: 2) {
            for x in stride(from: w / 10, to: w - w / 10, by: 2) {
                let i = (y * w + x) * 4
                let r = Double(data[i]), g = Double(data[i + 1]), b = Double(data[i + 2])
                let lum = 0.299 * r + 0.587 * g + 0.114 * b
                sum += lum
                squares += lum * lum
                count += 1
                // Colours are counted coarsely, so the noise of one flat colour never reads as a picture.
                colours.insert(UInt32(data[i] >> 4) << 8 | UInt32(data[i + 1] >> 4) << 4 | UInt32(data[i + 2] >> 4))
            }
        }
        let mean = count > 0 ? sum / count : 0
        spread = count > 0 ? (max(0, squares / count - mean * mean)).squareRoot() : 0
        distinct = colours.count
    }
}
