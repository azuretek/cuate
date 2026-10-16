import Foundation

// Issue 411: unrelated screen pixels (including a clock tick) are not an appearance-readiness signal.
// Every accepted sample must satisfy the existing full bar contract, twice consecutively in the requested scheme.
struct SystemBarsReadiness {
    private var lastScheme: String?
    private(set) var consecutiveValid = 0

    mutating func observe(scheme: String, problems: [String]) -> Bool {
        if lastScheme != scheme || !problems.isEmpty { consecutiveValid = 0 }
        lastScheme = scheme
        if problems.isEmpty { consecutiveValid += 1 }
        return consecutiveValid >= 2
    }
}

// A tap is not focus admission. Retry only while the page confirms no focus, never after focus arrived.
enum FieldFocusReadiness {
    enum Action { case ready, tap, waitForElement, timedOut }
    static func action(now: TimeInterval, deadline: TimeInterval, exists: Bool, focused: Bool) -> Action {
        if now >= deadline { return .timedOut }
        if focused { return .ready }
        return exists ? .tap : .waitForElement
    }
}
