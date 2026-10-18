import UIKit
import XCTest

/// The status bar and the home indicator wear the app's own surface (issue 175). A populated conversation is drawn in
/// one scheme, then the other at runtime, and each capture is held to it by its pixels: the strip under each bar is the
/// colour of the surface beside it and of the surface the page says it painted there, the status bar's text contrasts
/// with it (dark on light, light on dark), and the page lays itself out under the bars with its content clear of them.
final class SystemBarsTests: XCTestCase {
    func testLightThenDarkAtRuntime() { run(first: "light", then: "dark") }
    func testDarkThenLightAtRuntime() { run(first: "dark", then: "light") }

    /// What the page measured, read from its marker's label (see core/test/system-bars-fixture.js).
    private struct Proof {
        let envTop: Double
        let envBottom: Double
        let headContentTop: Double
        let composerGap: Double
        let painted: [Int]
        let paintedBottom: [Int]

        init?(_ label: String) {
            let parts = label.split(separator: ":").map(String.init)
            guard parts.count == 9, parts[2] == "ready",
                  let top = Double(parts[3]), let bottom = Double(parts[4]),
                  let head = Double(parts[5]), let gap = Double(parts[6]) else { return nil }
            envTop = top
            envBottom = bottom
            headContentTop = head
            composerGap = gap
            painted = parts[7].split(separator: ",").compactMap { Int($0) }
            paintedBottom = parts[8].split(separator: ",").compactMap { Int($0) }
        }
    }

    private func run(first: String, then: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--system-bars-fixture"] + (first == "dark" ? ["--fixture-dark"] : [])
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let marker = self.marker(app, scheme: first)
        XCTAssertTrue(marker.waitForExistence(timeout: 30), app.debugDescription)
        hold(app, scheme: first, name: "bars-" + first)
        switchScheme(app, from: first, to: then)
        hold(app, scheme: then, name: "bars-" + first + "-then-" + then)
        pinchRefused(app, scheme: then)
        keyboardHolds(app, scheme: then, kind: "conversation")
        keyboardHolds(app, scheme: then, kind: "settings")
    }

    /// The keyboard marker's label: keys:<kind>:<focused>:<scroll>:<viewport top>:<viewport height>:<scale>:<inset top>:
    /// <surface top>:<field top>:<field bottom>, from core/test/system-bars-fixture.js.
    private func keysMarker(_ app: XCUIApplication) -> XCUIElement {
        app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "keys:")).firstMatch
    }

    /// With the keyboard up on the conversation's composer or on a field in Settings, nothing slides: the page has not
    /// scrolled, the header is still at the top (or the settings sheet still clear of the status bar), and the field is
    /// in sight between the status bar and the keyboard (issue 180).
    private func keyboardHolds(_ app: XCUIApplication, scheme: String, kind: String) {
        SystemSurface.requireOurs(app)
        if kind == "settings" {
            guard openSettings(app) else { return }
            let field = app.webViews.descendants(matching: .any)["bars-field"].firstMatch
            XCTAssertTrue(field.waitForExistence(timeout: 20), "The marker's click reached the page (it reports keys:settings:), but the Settings field never appeared: " + app.debugDescription)
            guard focusField(app, field: field, kind: kind) else { return }
        } else {
            let composer = app.webViews.textViews.firstMatch
            XCTAssertTrue(composer.waitForExistence(timeout: 20), app.debugDescription)
            guard focusField(app, field: composer, kind: kind) else { return }
        }
        let deadline = Date().addingTimeInterval(20)
        var last = ["no proof"]
        repeat {
            var out: [String] = []
            let keyboard = app.keyboards.firstMatch
            let keyboardTop: Double? = keyboard.exists ? Double(keyboard.frame.minY) : nil
            if keyboardTop == nil { out.append("the software keyboard is not up") }
            let parts = keysMarker(app).label.split(separator: ":").map(String.init)
            let n = parts.count == 11 ? parts.dropFirst(3).compactMap { Double($0) } : []
            if parts.count != 11 || n.count != 8 || parts[1] != kind {
                out.append("the page's keyboard measurements could not be read: " + parts.joined(separator: ":"))
            } else {
                let (scroll, top, height, scale, inset, surface, fieldTop, fieldBottom) = (n[0], n[1], n[2], n[3], n[4], n[5], n[6], n[7])
                if parts[2] != "1" { out.append("the \(kind) field does not have focus") }
                if scroll != 0 { out.append("the page scrolled to \(scroll)") }
                if top > 0.5 { out.append("the view slid up by \(top)") }
                if scale != 1 { out.append("the view is zoomed to \(scale)") }
                if kind == "conversation" && abs(surface) > 0.5 { out.append("the header moved to \(surface)") }
                if kind == "settings" && surface + 0.5 < inset { out.append("the settings sheet starts at \(surface), under the \(inset) status bar") }
                if fieldTop + 0.5 < inset || fieldBottom > height + 0.5 { out.append("the field (\(fieldTop) to \(fieldBottom)) is not in sight between \(inset) and \(height)") }
                // On the screen, not only in the page's own idea of its height: the web view starts at the screen's top
                // edge at scale 1, so a page point is a screen point, and the field must end above the keyboard.
                if let keyboardTop, fieldBottom > keyboardTop + 0.5 { out.append("the field ends at \(fieldBottom), under the keyboard at \(keyboardTop)") }
            }
            last = out
            if out.isEmpty { break }
        } while Date() < deadline
        let attachment = XCTAttachment(image: XCUIScreen.main.screenshot().image)
        attachment.name = "keys-" + kind + "-" + scheme
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertTrue(last.isEmpty, "With the keyboard up on \(kind) (\(scheme)): " + last.joined(separator: "; ") + SystemSurface.failureSuffix(app))
    }

    /// Admit focus before starting the keyboard-layout deadline. A dropped native tap is not a keyboard-layout
    /// failure; the page's actual focus signal decides whether another tap is permitted (issue 411).
    private func focusField(_ app: XCUIApplication, field: XCUIElement, kind: String) -> Bool {
        let start = Date()
        let deadline = start.addingTimeInterval(30)
        let focused = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "keys:" + kind + ":1:")).firstMatch
        var attempts = 0
        while true {
            switch FieldFocusReadiness.action(now: Date().timeIntervalSince1970, deadline: deadline.timeIntervalSince1970,
                                             exists: field.exists, focused: focused.exists) {
            case .ready:
                print("keyboard focus admitted kind=\(kind) attempts=\(attempts) elapsed=\(Date().timeIntervalSince(start))")
                return true
            case .tap:
                attempts += 1
                print("keyboard focus attempt=\(attempts) kind=\(kind) elapsed=\(Date().timeIntervalSince(start)) hittable=\(field.isHittable) frame=\(field.frame)")
                field.tap()
                _ = focused.waitForExistence(timeout: 3)
            case .waitForElement:
                _ = field.waitForExistence(timeout: 2)
            case .timedOut:
                XCTFail("The \(kind) field never confirmed focus after \(attempts) taps; " + keysMarker(app).label + SystemSurface.failureSuffix(app))
                return false
            }
        }
    }

    /// Presses the keys marker until the page reports `keys:settings:`, which its click handler sets before anything else
    /// (core/test/system-bars-fixture.js), so the step waits on the state it needs rather than on one tap. A tap made
    /// just after the keyboard has come up on the composer can be lost: XCTest finds and taps the button, and the page
    /// never sees a click (issue 384). Past the deadline it fails saying the click never reached the page, with what each
    /// press saw, so a lost tap is told apart from a Settings sheet that would not open.
    private func openSettings(_ app: XCUIApplication) -> Bool {
        let reached = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "keys:settings:")).firstMatch
        let deadline = Date().addingTimeInterval(30)
        var presses: [String] = []
        repeat {
            if reached.exists { return true }
            let marker = keysMarker(app)
            let keyboard = app.keyboards.firstMatch.exists ? "keyboard up at \(app.keyboards.firstMatch.frame.minY)" : "keyboard down"
            guard marker.exists else {
                presses.append("no marker (\(keyboard))")
                _ = marker.waitForExistence(timeout: 2)
                continue
            }
            presses.append("\(marker.isHittable ? "hittable" : "not hittable") at \(marker.frame), \(keyboard), web view \(app.webViews.firstMatch.frame), label \(marker.label)")
            marker.tap()
            if reached.waitForExistence(timeout: 3) { return true }
        } while Date() < deadline
        XCTFail("The keys marker was pressed \(presses.count) times and its click never reached the page (it never reported keys:settings:). Each press: " + presses.joined(separator: " | ") + SystemSurface.failureSuffix(app))
        return false
    }

    /// A pinch on the conversation leaves the page at scale 1: only the media viewer zooms (issue 180).
    private func pinchRefused(_ app: XCUIApplication, scheme: String) {
        app.webViews.firstMatch.pinch(withScale: 2.5, velocity: 2)
        let parts = keysMarker(app).label.split(separator: ":").map(String.init)
        XCTAssertEqual(parts.count, 11, "the page's measurements could not be read")
        if parts.count == 11 { XCTAssertEqual(Double(parts[6]), 1, "a pinch outside media zoomed the page (\(scheme))") }
        if parts.count == 11 { XCTAssertEqual(Double(parts[3]), 0, "a pinch outside media scrolled the page (\(scheme))") }
    }


    /// Presses the scheme marker until the page reports the next scheme. XCTest can tap the marker and the page never see
    /// a click (issue 471, as with the keys marker in issue 384), which left the page in the first scheme for the rest of
    /// the test. A press always means the scheme the test did not launch in (core/test/system-bars-fixture.js), so a
    /// press after one that did arrive changes nothing. Past the deadline it fails with what each press saw.
    private func switchScheme(_ app: XCUIApplication, from first: String, to then: String) {
        let next = marker(app, scheme: then)
        let deadline = Date().addingTimeInterval(30)
        var presses: [String] = []
        repeat {
            if next.exists { return }
            let current = marker(app, scheme: first)
            guard current.exists else {
                presses.append("no \(first) marker")
                _ = next.waitForExistence(timeout: 2)
                continue
            }
            presses.append("\(current.isHittable ? "hittable" : "not hittable") at \(current.frame)")
            current.tap()
            if next.waitForExistence(timeout: 5) { return }
        } while Date() < deadline
        XCTFail("The \(first) marker was pressed \(presses.count) times and the page never reported \(then). Each press: "
            + presses.joined(separator: " | ") + SystemSurface.failureSuffix(app))
    }

    private func marker(_ app: XCUIApplication, scheme: String) -> XCUIElement {
        app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "bars:" + scheme + ":ready:")).firstMatch
    }

    /// Captures until the full contract holds twice consecutively. Unrelated pixels, such as a ticking clock,
    /// need not be identical. A bad or unreadable frame resets the evidence; the bounded failure keeps its capture.
    private func hold(_ app: XCUIApplication, scheme: String, name: String) {
        SystemSurface.requireOurs(app)
        let start = Date()
        let deadline = start.addingTimeInterval(20)
        // One capture can outlast the window on a slow runner (22.7s measured, issue 471): a hold whose evidence is valid so
        // far takes its confirming sample up to this bound, while one with no valid evidence still ends at the window.
        let hardDeadline = start.addingTimeInterval(60)
        var readiness = SystemBarsReadiness()
        var samples = 0
        var last = ["no capture"]
        var image: UIImage?
        var held = false
        repeat {
            let shot = XCUIScreen.main.screenshot().image
            image = shot
            guard let label = marker(app, scheme: scheme).exists ? marker(app, scheme: scheme).label : nil,
                  let proof = Proof(label), let pixels = Pixels(shot) else {
                last = ["the page's measurements or the capture could not be read"]
                _ = readiness.observe(scheme: scheme, problems: last)
                continue
            }
            let points = Double(pixels.height) / Double(app.windows.firstMatch.frame.height)
            last = problems(pixels, proof: proof, scale: points, scheme: scheme)
            samples += 1
            held = readiness.observe(scheme: scheme, problems: last)
            print("bars sample name=\(name) count=\(samples) elapsed=\(Date().timeIntervalSince(start)) valid=\(last.isEmpty) consecutive=\(readiness.consecutiveValid) problems=\(last)")
            if held { break }
        } while Date() < deadline || (readiness.consecutiveValid > 0 && Date() < hardDeadline)
        if let image {
            let attachment = XCTAttachment(image: image)
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTAssertTrue(held, "The \(scheme) system bars do not wear the surface (\(name)): " + last.joined(separator: "; ") + "; valid consecutive samples=\(readiness.consecutiveValid), required=2" + SystemSurface.failureSuffix(app))
    }

    /// Every way the capture breaks the contract, empty when it holds.
    private func problems(_ pixels: Pixels, proof: Proof, scale: Double, scheme: String) -> [String] {
        var out: [String] = []
        if proof.envTop <= 0 { out.append("the page is laid out inside the safe area (env(safe-area-inset-top) is 0), so it cannot paint behind the status bar") }
        if proof.envBottom <= 0 { out.append("env(safe-area-inset-bottom) is 0, so the page cannot paint behind the home indicator") }
        if proof.headContentTop + 0.5 < proof.envTop { out.append("the header's content starts at \(proof.headContentTop), under the \(proof.envTop) status bar") }
        if proof.composerGap + 0.5 < proof.envBottom { out.append("the composer's content ends \(proof.composerGap) from the bottom, under the \(proof.envBottom) home indicator") }

        // The strips: the safe area where the page reports one, and the smallest status bar and home indicator otherwise,
        // so a page that does not reach under the bars is judged on the same pixels.
        let topRows = Int((proof.envTop > 0 ? proof.envTop : 44) * scale)
        let bottomRows = Int((proof.envBottom > 0 ? proof.envBottom : 20) * scale)
        let band = max(2, Int(4 * scale))
        let top = pixels.dominant(0, topRows)
        let belowTop = pixels.dominant(topRows + band, topRows + 2 * band)
        if !near(top, belowTop, 3) { out.append("the status bar strip is \(hex(top)), the surface below it \(hex(belowTop))") }
        if proof.painted.count == 3, !near(top, proof.painted, 8) { out.append("the status bar strip is \(hex(top)), the page painted \(hex(proof.painted))") }
        let h = pixels.height
        let bottom = pixels.dominant(h - bottomRows, h)
        let aboveBottom = pixels.dominant(h - bottomRows - 2 * band, h - bottomRows - band)
        if !near(bottom, aboveBottom, 3) { out.append("the home indicator strip is \(hex(bottom)), the surface above it \(hex(aboveBottom))") }
        if proof.paintedBottom.count == 3, !near(bottom, proof.paintedBottom, 8) { out.append("the home indicator strip is \(hex(bottom)), the page painted \(hex(proof.paintedBottom))") }

        print("bars colours scheme=\(scheme) top=\(hex(top)) adjacent=\(hex(belowTop)) painted=\(proof.painted) bottom=\(hex(bottom)) adjacentBottom=\(hex(aboveBottom)) paintedBottom=\(proof.paintedBottom) safeTop=\(proof.envTop) safeBottom=\(proof.envBottom)")

        // The status bar's text: the pixels in the strip that stand well off its surface lie on the scheme's side.
        let base = luma(top)
        var count = 0
        var sum = 0
        for y in 0..<min(topRows, h) {
            for x in 0..<pixels.width {
                let l = luma(pixels.at(x, y))
                if abs(l - base) >= 64 {
                    count += 1
                    sum += l
                }
            }
        }
        if count < 20 {
            out.append("no status bar text stands out from the strip (\(count) pixels)")
        } else {
            let mean = sum / count
            if scheme == "light" && mean >= base { out.append("the status bar text (luma \(mean)) is not darker than the light strip (luma \(base))") }
            if scheme == "dark" && mean <= base { out.append("the status bar text (luma \(mean)) is not lighter than the dark strip (luma \(base))") }
        }
        return out
    }

    private func luma(_ c: [Int]) -> Int { (299 * c[0] + 587 * c[1] + 114 * c[2]) / 1000 }
    private func near(_ a: [Int], _ b: [Int], _ tolerance: Int) -> Bool { zip(a, b).allSatisfy { abs($0 - $1) <= tolerance } }
    private func hex(_ c: [Int]) -> String { String(format: "#%02x%02x%02x", c[0], c[1], c[2]) }
}

/// A capture's pixels in sRGB, so a colour reads the same as the page's CSS value whatever space the screen is in.
private struct Pixels {
    let width: Int
    let height: Int
    let bytes: [UInt8]

    init?(_ image: UIImage) {
        guard let cg = image.cgImage, let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        width = cg.width
        height = cg.height
        var buffer = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
        let drawn: Bool = buffer.withUnsafeMutableBytes { raw in
            guard let context = CGContext(data: raw.baseAddress, width: cg.width, height: cg.height, bitsPerComponent: 8,
                                          bytesPerRow: cg.width * 4, space: space,
                                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            context.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
            return true
        }
        guard drawn else { return nil }
        bytes = buffer
    }

    /// Row 0 is the top of the screen: CGContext's buffer starts at the top row of the image drawn into it.
    func at(_ x: Int, _ y: Int) -> [Int] {
        let i = (y * width + x) * 4
        return [Int(bytes[i]), Int(bytes[i + 1]), Int(bytes[i + 2])]
    }

    /// The most common colour in a band of rows, sampled every other pixel.
    func dominant(_ from: Int, _ to: Int) -> [Int] {
        var counts: [Int: Int] = [:]
        var y = max(0, from)
        while y < min(to, height) {
            var x = 0
            while x < width {
                let c = at(x, y)
                counts[(c[0] << 16) | (c[1] << 8) | c[2], default: 0] += 1
                x += 2
            }
            y += 2
        }
        guard let key = counts.max(by: { $0.value < $1.value })?.key else { return [0, 0, 0] }
        return [(key >> 16) & 0xFF, (key >> 8) & 0xFF, key & 0xFF]
    }
}
