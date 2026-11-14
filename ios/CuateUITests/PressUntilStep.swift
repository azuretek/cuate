import XCTest

/// What a step presses: an element, or a point the page reported for a control the tree does not expose. present is read
/// on every decision; seen and press only when the rule says to press, so a step costs no extra queries while it waits.
struct PressTarget {
    let present: Bool
    let seen: () -> String
    let press: () -> Void

    static func element(_ element: XCUIElement) -> PressTarget {
        PressTarget(present: element.exists, seen: { "\(element.isHittable ? "hittable" : "not hittable") at \(element.frame)" }, press: { element.tap() })
    }

    static func point(_ point: XCUICoordinate, _ seen: @escaping @autoclosure () -> String) -> PressTarget {
        PressTarget(present: true, seen: seen, press: { point.tap() })
    }

    static var absent: PressTarget { PressTarget(present: false, seen: { "absent" }, press: {}) }
}

/// Presses target until reached() holds, by the rule in TestSupport/PressUntil.swift (issue 517). reached() reads the
/// page's own state and is asked before every decision, so a page that answered is never reported as silent. Returns
/// whether it did, and what each press saw and how long XCTest took over it, so a failure says whether presses arrived.
func pressUntil(_ name: String, rule: PressUntil = PressUntil(), target: () -> XCUIElement, reached: () -> Bool) -> (ok: Bool, presses: [String]) {
    pressUntil(name, rule: rule, at: { .element(target()) }, reached: reached)
}

/// The same rule for a step whose target is not always an element (issue 519): at() says, on every decision, what a
/// press would reach now, or .absent while there is nothing to press.
func pressUntil(_ name: String, rule: PressUntil = PressUntil(), at: () -> PressTarget, reached: () -> Bool) -> (ok: Bool, presses: [String]) {
    let start = Date()
    var lastReturned: Date?
    var presses: [String] = []
    while true {
        let state = reached()
        let target = at()
        let now = Date()
        switch rule.next(reached: state, targetPresent: target.present, presses: presses.count, elapsed: now.timeIntervalSince(start), sinceLastPress: lastReturned.map { now.timeIntervalSince($0) }) {
        case .done:
            print("step \(name) reached presses=\(presses.count) elapsed=\(Date().timeIntervalSince(start))")
            return (true, presses)
        case .failed:
            print("step \(name) failed presses=\(presses.count) elapsed=\(Date().timeIntervalSince(start))")
            return (false, presses)
        case .press:
            let seen = target.seen()
            let before = Date()
            target.press()
            lastReturned = Date()
            let took = lastReturned!.timeIntervalSince(before)
            presses.append(seen + String(format: ", XCTest took %.1fs over the press", took))
            print("step \(name) press=\(presses.count) took=\(took) elapsed=\(Date().timeIntervalSince(start))")
        case .wait:
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
    }
}
