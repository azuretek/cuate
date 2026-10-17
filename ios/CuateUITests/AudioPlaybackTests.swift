import XCTest

// Issue 432: a recording in a conversation was drawn as a file card, and pressing it left the conversation. The
// fixture (core/test/audio-fixture.js) draws two synthetic recordings in a conversation in this shell's own web view, one
// someone else sent and not played yet, and one we sent. This test presses play through the accessibility tree, as a
// person would, and asserts from the page's report that the recording plays where it is: its time and its elapsed clock
// move, its waveform fills, its mark goes, and pause holds it part way in. A screenshot of each state is kept.
final class AudioPlaybackTests: XCTestCase {
    func testARecordingPlaysInItsMessage() {
        let app = XCUIApplication()
        app.launchArguments = ["--audio-fixture"]
        XCUIDevice.shared.startInPortrait()
        app.launch()
        defer { app.terminate() }
        let page = app.webViews.firstMatch
        let marker = page.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'au:'")).firstMatch
        let drawn = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'au:ready' OR label BEGINSWITH 'au:fail'"), object: marker)
        _ = XCTWaiter().wait(for: [drawn], timeout: 120)
        guard marker.exists, marker.label.hasPrefix("au:ready") else {
            XCTFail("the audio fixture did not draw: " + (marker.exists ? marker.label : "no marker") + SystemSurface.failureSuffix(app))
            return
        }
        print("audio fixture ready: " + marker.label)
        SystemSurface.requireOurs(app)
        let before = AudioReport(marker.label)
        XCTAssertEqual(before?.first?["unplayed"] as? Bool, true, "the recording someone else sent is marked not played: " + marker.label)
        XCTAssertEqual(before?.first?["length"] as? String, "0:04", "it says how long it runs: " + marker.label)
        XCTAssertEqual(before?.second?["unplayed"] as? Bool, false, "ours is never marked: " + marker.label)
        for player in before?.players ?? [] { XCTAssertEqual(player["clear"] as? Bool, true, "the waveform keeps clear of the time: " + marker.label) }
        keep(app, "audio ready")

        let play = page.buttons["Play memo.m4a"]
        XCTAssertTrue(play.waitForExistence(timeout: 10), "the play control is in the accessibility tree" + SystemSurface.failureSuffix(app))
        XCTAssertTrue(play.isHittable, "the play control takes a press" + SystemSurface.failureSuffix(app))
        play.tap()

        let playing = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'au:playing' OR label BEGINSWITH 'au:fail'"), object: marker)
        _ = XCTWaiter().wait(for: [playing], timeout: 30)
        print("audio fixture after play: " + marker.label)
        guard marker.label.hasPrefix("au:playing"), let report = AudioReport(marker.label), let first = report.first else {
            XCTFail("the recording did not play in its message: " + marker.label + SystemSurface.failureSuffix(app))
            return
        }
        XCTAssertGreaterThanOrEqual(first["currentTime"] as? Double ?? 0, 1, "its time moved: " + marker.label)
        XCTAssertNotEqual(first["elapsed"] as? String, "0:00", "its elapsed clock moved: " + marker.label)
        XCTAssertGreaterThan(first["filled"] as? Int ?? 0, 0, "its waveform fills: " + marker.label)
        XCTAssertEqual(first["unplayed"] as? Bool, false, "its mark is gone once played: " + marker.label)
        XCTAssertTrue(page.buttons["Pause memo.m4a"].exists, "the control turned to pause" + SystemSurface.failureSuffix(app))
        keep(app, "audio playing")

        page.buttons["Pause memo.m4a"].tap()
        let paused = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'au:paused'"), object: marker)
        _ = XCTWaiter().wait(for: [paused], timeout: 10)
        print("audio fixture after pause: " + marker.label)
        XCTAssertTrue(marker.label.hasPrefix("au:paused"), "pause holds it part way in: " + marker.label + SystemSurface.failureSuffix(app))
        keep(app, "audio paused")
    }

    private func keep(_ app: XCUIApplication, _ name: String) {
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = name
        capture.lifetime = .keepAlways
        add(capture)
    }
}

/// The fixture's report: the players it drew, in order, the recording someone else sent first.
struct AudioReport {
    let players: [[String: Any]]
    var first: [String: Any]? { players.first }
    var second: [String: Any]? { players.count > 1 ? players[1] : nil }

    init?(_ label: String) {
        guard let space = label.firstIndex(of: " "),
              let data = String(label[label.index(after: space)...]).data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let players = json["players"] as? [[String: Any]] else { return nil }
        self.players = players
    }
}
