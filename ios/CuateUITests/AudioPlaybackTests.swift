import XCTest

// Issue 432: a recording in a conversation was drawn as a file card, and pressing it left the conversation. The
// fixture (core/test/audio-fixture.js) draws two synthetic recordings in a conversation in this shell's own web view, one
// someone else sent and not played yet, and one we sent. This test presses play through the accessibility tree, as a
// person would, and asserts from the page's report that the recording plays where it is: its time and its elapsed clock
// move, its waveform fills, its mark goes, and pause holds it part way in. Then it plays a voice message (issue 435), a
// synthetic Core Audio file with Opus inside, and asserts it plays too, from the copy that matches what this web view
// says it plays. A screenshot of each state is kept.
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
        XCTAssertEqual(before?.first?["length"] as? String, "1:00", "it says how long it runs: " + marker.label)
        XCTAssertEqual(before?.second?["unplayed"] as? Bool, false, "ours is never marked: " + marker.label)
        XCTAssertEqual(before?.voice?["unplayed"] as? Bool, true, "the voice message is marked not played: " + marker.label)
        XCTAssertEqual(before?.voice?["length"] as? String, "0:45", "the voice message says how long it runs: " + marker.label)
        let canPlay = before?.voice?["canPlay"] as? String ?? ""
        XCTAssertEqual(before?.voice?["asked"] as? String, canPlay == "probably" ? "original" : "m4a", "the voice message asked for the copy this web view plays: " + marker.label)
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

        let voicePlay = page.buttons["Play Audio Message.caf"]
        XCTAssertTrue(voicePlay.waitForExistence(timeout: 10), "the voice message's play control is in the accessibility tree" + SystemSurface.failureSuffix(app))
        voicePlay.tap()
        let voicing = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH 'au:voice' OR label BEGINSWITH 'au:fail'"), object: marker)
        _ = XCTWaiter().wait(for: [voicing], timeout: 30)
        print("audio fixture after voice play: " + marker.label)
        guard marker.label.hasPrefix("au:voice"), let spoken = AudioReport(marker.label)?.voice else {
            XCTFail("the voice message did not play in its message: " + marker.label + SystemSurface.failureSuffix(app))
            return
        }
        XCTAssertGreaterThanOrEqual(spoken["currentTime"] as? Double ?? 0, 1, "the voice message's time moved: " + marker.label)
        XCTAssertNotEqual(spoken["elapsed"] as? String, "0:00", "its elapsed clock moved: " + marker.label)
        XCTAssertGreaterThan(spoken["filled"] as? Int ?? 0, 0, "its waveform fills: " + marker.label)
        XCTAssertEqual(spoken["unplayed"] as? Bool, false, "its mark is gone once played: " + marker.label)
        keep(app, "audio voice")
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
    var voice: [String: Any]? { players.count > 2 ? players[2] : nil }

    init?(_ label: String) {
        guard let space = label.firstIndex(of: " "),
              let data = String(label[label.index(after: space)...]).data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let players = json["players"] as? [[String: Any]] else { return nil }
        self.players = players
    }
}
