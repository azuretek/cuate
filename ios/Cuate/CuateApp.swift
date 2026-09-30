import SwiftUI

/// The app itself: one window, one screen, and the launch-time work that has no
/// home in a view.
@main
struct CuateApp: App {
    init() {
        // MetricKit delivers a previous launch's crashes and hangs to its
        // subscribers on this one, so the subscriber is registered first. The
        // engine bundle is read from the JavaScriptCore context here rather than
        // awaited by a view: the rules it carries are what a shell needs before
        // any page loads.
        Diagnostics.shared.start()
        _ = Engine.makeContext()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
