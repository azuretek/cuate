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
