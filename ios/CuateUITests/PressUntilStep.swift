import XCTest

/// Presses target until reached() holds, by the rule in TestSupport/PressUntil.swift (issue 517). reached() reads the
/// page's own state and is asked before every decision, so a page that answered is never reported as silent. Returns
/// whether it did, and what each press saw and how long XCTest took over it, so a failure says whether presses arrived.
func pressUntil(_ name: String, rule: PressUntil = PressUntil(), target: () -> XCUIElement, reached: () -> Bool) -> (ok: Bool, presses: [String]) {
    let start = Date()
    var lastReturned: Date?
    var presses: [String] = []
    while true {
        let state = reached()
        let element = target()
        let present = element.exists
        let now = Date()
        switch rule.next(reached: state, targetPresent: present, presses: presses.count, elapsed: now.timeIntervalSince(start), sinceLastPress: lastReturned.map { now.timeIntervalSince($0) }) {
        case .done:
            print("step \(name) reached presses=\(presses.count) elapsed=\(Date().timeIntervalSince(start))")
            return (true, presses)
        case .failed:
            print("step \(name) failed presses=\(presses.count) elapsed=\(Date().timeIntervalSince(start))")
            return (false, presses)
        case .press:
            let seen = "\(element.isHittable ? "hittable" : "not hittable") at \(element.frame)"
            let before = Date()
            element.tap()
            lastReturned = Date()
            let took = lastReturned!.timeIntervalSince(before)
            presses.append(seen + String(format: ", XCTest took %.1fs over the press", took))
            print("step \(name) press=\(presses.count) took=\(took) elapsed=\(Date().timeIntervalSince(start))")
        case .wait:
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
    }
}
