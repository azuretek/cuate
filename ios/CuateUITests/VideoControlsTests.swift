import XCTest

// Issue 416: in the media viewer a video is drawn with the player's own controls, and the viewer's close control, its
// step controls and its bar floated over them: the close control sat on the iOS player's mute button and the bar on its
// scrubber. The fixture (core/test/video-controls-fixture.js) opens the real viewer on a synthetic clip, paused so the
// player's controls show, in this shell's own web view. This test finds every player control (play or pause, the
// scrubber, mute, full screen) and every one of ours (close, previous, next, the bar) in the accessibility tree, keeps a
// screenshot, and asserts each control is hittable and that none of ours overlaps a player control or another of ours.
//
// Issue 446: a video whose accessibility node was built while it was still empty kept that node once its clip had
// loaded, with none of the player's controls. The fixture holds the clip back, so every run takes the real order: this
// test reads the tree over the viewer while its video is empty, then presses the fixture's release control until the
// clip is on its way, and only then looks for the player's controls. Every wait here is for a state.
final class VideoControlsTests: XCTestCase {
    func testPortraitVideoKeepsEveryControlClear() {
        check("portrait")
    }

    func testLandscapeVideoKeepsEveryControlClear() {
        check("landscape")
    }

    private struct Control {
        let name: String
        let element: XCUIElement
    }

    private func check(_ shape: String) {
        let app = XCUIApplication()
        app.launchArguments = ["--video-controls-fixture", "--fixture-video-" + shape]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let page = app.webViews.firstMatch
        let empty = page.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'vc:empty' OR label BEGINSWITH 'vc:fail'")).firstMatch
        guard empty.waitForExistence(timeout: 120) else {
            XCTFail("the video controls fixture never drew the empty video" + SystemSurface.failureSuffix(app))
            return
        }
        print("video controls empty scene (" + shape + "): " + empty.label)
        guard empty.label.hasPrefix("vc:empty") else {
            XCTFail("the video controls fixture failed: " + empty.label + SystemSurface.failureSuffix(app))
            return
        }
        // The tree is read over the viewer while its video has nothing to play: the viewer's own close control is in it.
        guard page.buttons["Close"].waitForExistence(timeout: 30) else {
            XCTFail("the viewer was not in the accessibility tree before its clip" + SystemSurface.failureSuffix(app))
            return
        }
        print("video controls (" + shape + ") accessibility tree over the empty video:\n" + app.debugDescription)
        releaseClip(app, page)
        let marker = page.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'vc:ready' OR label BEGINSWITH 'vc:fail'")).firstMatch
        guard marker.waitForExistence(timeout: 120) else {
            XCTFail("the video controls fixture never reported" + SystemSurface.failureSuffix(app))
            return
        }
        print("video controls scene (" + shape + "): " + marker.label)
        guard marker.label.hasPrefix("vc:ready") else {
            XCTFail("the video controls fixture failed: " + marker.label + SystemSurface.failureSuffix(app))
            return
        }

        let player = playerControls(page)
        // A paused video keeps the player's controls on screen; a tap on the picture away from its middle brings them
        // back if the player hid them anyway.
        if !player[0].element.waitForExistence(timeout: 10) {
            let clip = page.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "clip-2.mp4")).firstMatch
            if clip.exists { clip.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap() }
        }
        let ours = [
            Control(name: "close", element: page.buttons["Close"]),
            Control(name: "previous", element: page.buttons["Previous item"]),
            Control(name: "next", element: page.buttons["Next item"]),
        ]
        let bar = page.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Media controls")).firstMatch
        for control in player + ours { _ = control.element.waitForExistence(timeout: 10) }

        SystemSurface.requireOurs(app)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "video-controls-" + shape
        shot.lifetime = .keepAlways
        add(shot)

        var problems: [String] = []
        var frames: [String: CGRect] = [:]
        for control in player + ours {
            guard control.element.exists else {
                problems.append(control.name + " is not in the accessibility tree")
                continue
            }
            let frame = control.element.frame
            frames[control.name] = frame
            print("video controls (" + shape + ") " + control.name + " at " + String(describing: frame) + (control.element.isHittable ? " hittable" : " NOT hittable"))
            if frame.isEmpty { problems.append(control.name + " has no size") }
            if !control.element.isHittable { problems.append(control.name + " is not hittable at " + String(describing: frame)) }
        }
        if bar.exists {
            frames["bar"] = bar.frame
            print("video controls (" + shape + ") bar at " + String(describing: bar.frame))
        } else {
            problems.append("the bar is not in the accessibility tree")
        }
        // The player's whole area is its control area too: a press anywhere on the video shows or hides the player's
        // controls, and the player draws them anywhere inside its box. The page reports the box, in its own coordinates.
        if let area = videoArea(marker.label, in: page) {
            frames["video"] = area
            print("video controls (" + shape + ") video at " + String(describing: area))
        } else {
            problems.append("the page did not report the video's box: " + marker.label)
        }
        // Ours against every player control and the video itself, the bar included; ours against each other. The bar
        // holds controls of its own, so it is not set against what it holds.
        let playerNames = player.map(\.name) + ["video"]
        let ourNames = ours.map(\.name) + ["bar"]
        for mine in ourNames {
            for theirs in playerNames {
                if let a = frames[mine], let b = frames[theirs], a.intersects(b) {
                    problems.append(mine + " " + String(describing: a) + " overlaps the player's " + theirs + " " + String(describing: b))
                }
            }
        }
        let separate = ours.map(\.name)
        for (i, first) in separate.enumerated() {
            for second in separate[(i + 1)...] {
                if let a = frames[first], let b = frames[second], a.intersects(b) {
                    problems.append(first + " overlaps " + second)
                }
            }
        }
        if !problems.isEmpty {
            print(app.debugDescription)
        }
        XCTAssertTrue(problems.isEmpty, "the " + shape + " video's controls are not all clear: " + problems.joined(separator: "; ") + SystemSurface.failureSuffix(app))
    }

    /// Presses the fixture's release control until the page says the clip is on its way. XCTest can tap a control and the
    /// page never see a click (issues 384 and 471), so the step waits on the state it needs rather than on one tap; the
    /// control leaves the page once it has been pressed, so a later press can never reach anything else.
    private func releaseClip(_ app: XCUIApplication, _ page: XCUIElement) {
        let released = page.staticTexts.matching(NSPredicate(format: "label == 'vc:loading' OR label BEGINSWITH 'vc:ready' OR label BEGINSWITH 'vc:fail'")).firstMatch
        let control = page.buttons["vc:release"]
        let deadline = Date().addingTimeInterval(30)
        var presses: [String] = []
        repeat {
            if released.exists { return }
            guard control.exists else {
                presses.append("no release control")
                _ = released.waitForExistence(timeout: 2)
                continue
            }
            presses.append((control.isHittable ? "hittable" : "not hittable") + " at " + String(describing: control.frame))
            control.tap()
            if released.waitForExistence(timeout: 5) { return }
        } while Date() < deadline
        XCTFail("The release control was pressed \(presses.count) times and the clip was never let go. Each press: " + presses.joined(separator: " | ") + SystemSurface.failureSuffix(app))
    }

    /// The video's box on screen, from the page's report (`"video":{"x":..,"y":..,"w":..,"h":..}` beside the viewport, in
    /// the page's own coordinates), scaled onto the web view's frame.
    private func videoArea(_ label: String, in page: XCUIElement) -> CGRect? {
        guard let data = String(label.dropFirst("vc:ready ".count)).data(using: .utf8),
              let report = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let video = report["video"] as? [String: Double], let viewport = report["viewport"] as? [String: Double],
              let x = video["x"], let y = video["y"], let w = video["w"], let h = video["h"],
              let vw = viewport["w"], let vh = viewport["h"], vw > 0, vh > 0 else { return nil }
        let frame = page.frame
        let sx = Double(frame.width) / vw
        let sy = Double(frame.height) / vh
        return CGRect(x: Double(frame.minX) + x * sx, y: Double(frame.minY) + y * sy, width: w * sx, height: h * sy)
    }

    /// The player's own controls, by the names WebKit gives them: play or pause, the scrubber, mute and full screen.
    private func playerControls(_ page: XCUIElement) -> [Control] {
        [
            Control(name: "play or pause", element: page.buttons.matching(NSPredicate(format: "label ==[c] 'Play' OR label ==[c] 'Pause'")).firstMatch),
            Control(name: "scrubber", element: page.sliders.firstMatch),
            Control(name: "mute", element: page.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] 'Mute' OR label BEGINSWITH[c] 'Unmute'")).firstMatch),
            Control(name: "full screen", element: page.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'full screen'")).firstMatch),
        ]
    }
}
