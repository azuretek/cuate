// A collapsed Notification Center group exposes only its newest notice. Expanding is discovery,
// never evidence that the distinct target was delivered or that its press reached the app.
struct NoticeGroupReadiness {
    enum Action { case expandGroup, waitForTarget, observeTarget }
    private var expanded = false

    mutating func action(targetExists: Bool, groupLabel: String?, expansionButtonHittable: Bool) -> Action {
        if targetExists { return .observeTarget }
        guard !expanded, expansionButtonHittable, let groupLabel,
              groupLabel.contains("Grouped"), groupLabel.contains("Late fixture message") else {
            return .waitForTarget
        }
        expanded = true
        return .expandGroup
    }
}
