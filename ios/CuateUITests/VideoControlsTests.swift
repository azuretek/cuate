import XCTest

// Issue 416: in the media viewer a video is drawn with the player's own controls, and the viewer's close control, its
// step controls and its bar floated over them: the close control sat on the iOS player's mute button and the bar on its
// scrubber. The fixture (core/test/video-controls-fixture.js) opens the real viewer on a synthetic clip, paused so the
// player's controls show, in this shell's own web view. This test finds every player control (play or pause, the
// scrubber, mute, full screen) and every one of ours (close, previous, next, the bar) in the accessibility tree, keeps a
// screenshot, and asserts each control is hittable and that none of ours overlaps a player control or another of ours.
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
        // Ours against every player control, the bar included; ours against each other. The bar holds controls of its
        // own, so it is not set against what it holds.
        let playerNames = player.map(\.name)
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
