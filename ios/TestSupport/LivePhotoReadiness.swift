import Foundation

// One deadline covers marker publication and viewer readiness. A late marker must not leave an earlier failed
// assertion behind when the viewer becomes ready inside the same total startup budget (issue 402).
struct LivePhotoReadiness {
    enum Status { case waiting, ready, failed, timedOut }
    let deadline: TimeInterval
    private(set) var firstObservedAt: TimeInterval?
    private(set) var status: Status = .waiting

    mutating func sample(at now: TimeInterval, exists: Bool, label: String) -> Status {
        if status != .waiting { return status }
        if exists && firstObservedAt == nil { firstObservedAt = now }
        if now >= deadline { status = .timedOut }
        else if exists && label == "live:ready" { status = .ready }
        else if exists && label.hasPrefix("live:fail") { status = .failed }
        return status
    }
}
