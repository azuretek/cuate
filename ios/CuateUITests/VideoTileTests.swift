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
        // Each tile is cut out of one capture of the whole screen, by the box the page says the tile is in now, offset by
        // the web view's place on screen. An element's own screenshot of web content is not trusted here: two tiles in
        // different places once came back as the same image.
        let page = app.webViews.firstMatch
        var readings: [String: TileReading] = [:]
        var crops: [String: UIImage] = [:]
        var screen: UIImage?
        let pictured = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let shot = XCUIScreen.main.screenshot().image
            screen = shot
            let boxes = TileBoxes.read(marker.label)
            for name in self.tiles {
                guard let box = boxes[name], box.width > 0, box.height > 0 else { readings[name] = nil; continue }
                let frame = box.offsetBy(dx: page.frame.minX, dy: page.frame.minY)
                guard let crop = TileBoxes.crop(shot, frame) else { readings[name] = nil; continue }
                crops[name] = crop
                readings[name] = TileReading(crop, frame: frame)
            }
            return self.tiles.allSatisfy { readings[$0]?.pictured == true }
        }, object: nil)
        _ = XCTWaiter().wait(for: [pictured], timeout: 30)

        if let screen {
            let capture = XCTAttachment(image: screen)
            capture.name = "video-tile screen"
            capture.lifetime = .keepAlways
            add(capture)
        }
        for name in tiles {
            if let crop = crops[name] {
                let capture = XCTAttachment(image: crop)
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

/// Where the page says each tile is, in points of the web view, read from the fixture's live report.
enum TileBoxes {
    static func read(_ label: String) -> [String: CGRect] {
        guard label.hasPrefix("video:ready "),
              let data = String(label.dropFirst("video:ready ".count)).data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tiles = json["tiles"] as? [[String: Any]] else { return [:] }
        var out: [String: CGRect] = [:]
        for tile in tiles {
            guard let name = tile["label"] as? String, let box = tile["box"] as? [Double], box.count == 4 else { continue }
            out[name] = CGRect(x: box[0], y: box[1], width: box[2], height: box[3])
        }
        return out
    }

    /// The part of a screen capture inside a frame given in points.
    static func crop(_ image: UIImage, _ frame: CGRect) -> UIImage? {
        guard let cg = image.cgImage else { return nil }
        let scale = CGFloat(cg.width) / image.size.width
        let rect = CGRect(x: frame.minX * scale, y: frame.minY * scale, width: frame.width * scale, height: frame.height * scale).integral
        guard let part = cg.cropping(to: rect) else { return nil }
        return UIImage(cgImage: part, scale: scale, orientation: .up)
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
