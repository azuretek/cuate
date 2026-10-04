import XCTest

extension XCUIDevice {
    // Issue 220: every UI test starts in portrait, and the device is usually there already. Setting an orientation
    // the device already has still waits for SpringBoard to confirm the turn, and on a simulator that is still busy
    // starting the test runner that confirmation can arrive after XCTest stops waiting, which failed the first test
    // with "Timed out waiting for confirmation of orientation change". Only a real turn is asked for.
    func startInPortrait() {
        if orientation != .portrait {
            orientation = .portrait
        }
    }
}
