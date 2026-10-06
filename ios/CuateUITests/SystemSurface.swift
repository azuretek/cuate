import XCTest

// Issue 285: a UI test on the phone judges the screen by its pixels, so the screen it is
// handed must be the app's. A simulator can raise a system surface over the app (a
// permission alert, the home screen, the app switcher), and the XCTest screenshot request
// then times out before the test reads a pixel, failing a page that never failed. A
// capture cannot say whether the frame it holds is ours, so SpringBoard, which owns those
// surfaces, is asked which one is in front: when it is not ours, a capture failure names
// it, and a pixel test stops blaming the page for an environment fault the lane exists to
// remove.
enum SystemSurface {
    // SpringBoard owns the system surfaces: its alerts, the home screen and the app switcher.
    private static var springboard: XCUIApplication { XCUIApplication(bundleIdentifier: "com.apple.springboard") }

    /// A description of the system surface covering the app, or nil when the surface in
    /// front is ours. The status bar and the software keyboard share the screen with us and
    /// are not a cover; the home screen, a system alert and another app are.
    static func obscuring(_ app: XCUIApplication) -> String? {
        if app.state != .runningForeground {
            return "our app is not the frontmost surface (its state is \(app.state.rawValue))"
        }
        let alert = springboard.alerts.firstMatch
        if alert.exists {
            let label = alert.label
            return "a system alert is covering the app: " + (label.isEmpty ? alert.debugDescription : label)
        }
        return nil
    }

    /// Fails now, naming the system surface, rather than after a screenshot timeout.
    static func requireOurs(_ app: XCUIApplication, file: StaticString = #file, line: UInt = #line) {
        if let surface = obscuring(app) {
            XCTFail("a system surface is covering the app, so the screen is not ours to judge: " + surface, file: file, line: line)
        }
    }

    /// Appended to a capture failure so it reads as the environment fault when it is one.
    static func failureSuffix(_ app: XCUIApplication) -> String {
        obscuring(app).map { "; a system surface is covering the app: " + $0 } ?? ""
    }
}
