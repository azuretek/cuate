import Foundation

// A collapsed Notification Center group exposes only its newest notice. Expanding is discovery,
// never evidence that the distinct target was delivered or that its press reached the app.
struct NoticeGroupReadiness {
    enum Action { case expandGroup, waitForTarget, observeTarget }
    private enum Phase { case compactList, appGroup(CGRect?), waitingForTarget }
    private var phase = Phase.compactList

    mutating func action(targetExists: Bool, groupLabel: String?, expansionButtonHittable: Bool, expansionButtonFrame: CGRect? = nil) -> Action {
        if targetExists { return .observeTarget }
        guard expansionButtonHittable, let groupLabel,
              groupLabel.contains("Grouped"), groupLabel.contains("Late fixture message") else {
            return .waitForTarget
        }
        switch phase {
        case .compactList:
            phase = .appGroup(expansionButtonFrame)
            return .expandGroup
        case .appGroup(let compactFrame):
            // The first press can expand Notification Center's compact list, not the app's grouped notices.
            // Only its observed move to a different settled frame authorizes the app-group press.
            guard let compactFrame, let expansionButtonFrame, compactFrame != expansionButtonFrame else {
                return .waitForTarget
            }
            phase = .waitingForTarget
            return .expandGroup
        case .waitingForTarget:
            return .waitForTarget
        }
    }
}

// Notification Center can move the group while revealing older notices. A hittable snapshot is not enough:
// each expansion phase needs its own settled button before another press can be authorized.
struct NoticeExpansionReadiness {
    private var last = CGRect.null
    private var still = 0

    mutating func observe(_ frame: CGRect?, screen: CGRect) -> Bool {
        guard let frame, !frame.isEmpty, frame.minY >= screen.minY,
              screen.contains(CGPoint(x: frame.midX, y: frame.midY)) else {
            last = .null
            still = 0
            return false
        }
        still = frame == last ? still + 1 : 0
        last = frame
        return still >= 2
    }
}
