import Foundation

/// The one rule every UI-test step follows that presses something and waits for the page to answer (issue 517). Steps
/// that each kept their own wall-clock window failed four times the same way (issues 384, 411, 471, 517): XCTest's own
/// work around a press, synthesizing the event, waiting for the app to idle and taking a slow accessibility snapshot,
/// spent the whole window, so a page that had already answered was reported as never answering. So:
/// - the page's state is read before every decision and always wins, past every bound;
/// - the window is page time: it starts when a press RETURNS, so XCTest's own time around a press never counts;
/// - a press is repeated only while the state is still absent, at most maxPresses times, under a hard cap.
struct PressUntil {
    enum Action: Equatable { case done, press, wait, failed }

    let window: TimeInterval
    let maxPresses: Int
    let hardCap: TimeInterval

    init(window: TimeInterval = 15, maxPresses: Int = 3, hardCap: TimeInterval = 120) {
        self.window = window
        self.maxPresses = maxPresses
        self.hardCap = hardCap
    }

    /// elapsed is the time since the step began; sinceLastPress the time since the last press returned, nil before the
    /// first press; presses how many have been made.
    func next(reached: Bool, targetPresent: Bool, presses: Int, elapsed: TimeInterval, sinceLastPress: TimeInterval?) -> Action {
        if reached { return .done }
        if elapsed >= hardCap { return .failed }
        guard let since = sinceLastPress else {
            if targetPresent { return .press }
            return elapsed >= window ? .failed : .wait
        }
        if since < window { return .wait }
        if presses >= maxPresses { return .failed }
        return targetPresent ? .press : .wait
    }
}
