import SwiftUI
import WebKit

/// The app's one screen: core's page, hosted in a WKWebView, under a cover until
/// the page has painted.
struct RootView: View {
    @StateObject private var model = ShellModel()

    var body: some View {
        ZStack {
            // The page runs under the status bar and the home indicator but never under the keyboard: the web view
            // ends at the keyboard's top edge, so the page's own views scroll a focused field into sight rather than
            // the whole page sliding up under the status bar (issues 175 and 180).
            ShellWebView(model: model)
                .ignoresSafeArea(.container)
            if model.phase != .ready {
                LoadingCover(product: model.product, phase: model.phase)
            }
        }
        .background(Color("Surface").ignoresSafeArea())
        // A messaging link (im:, issue 333) is held for the page, which asks for it whenever it is shown.
        .onOpenURL { url in model.bridge.pendingLink = url.absoluteString }
    }
}

/// The web view host: one configuration, one scheme handler and the bridge.
struct ShellWebView: UIViewRepresentable {
    @ObservedObject var model: ShellModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        // Media plays without a gesture (issue 386), the same as the Android shell's mediaPlaybackRequiresUserGesture =
        // false: a Live Photo's motion is drawn and started after the press has waited on its file, outside the gesture,
        // and WebKit's default refused it, which left an empty box.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)

        let controller = WKUserContentController()
        controller.add(model.bridge, name: HostBridge.messageName)
        controller.addUserScript(WKUserScript(
            source: HostBridge.injectedScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--rotation-fixture"),
           let url = Bundle.main.url(forResource: "rotation-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            let scheme = ProcessInfo.processInfo.arguments.contains("--fixture-dark") ? "dark" : "light"
            controller.addUserScript(WKUserScript(source: "window.fixtureScheme = '\(scheme)';\n" + source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        if ProcessInfo.processInfo.arguments.contains("--system-bars-fixture"),
           let url = Bundle.main.url(forResource: "system-bars-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            let scheme = ProcessInfo.processInfo.arguments.contains("--fixture-dark") ? "dark" : "light"
            controller.addUserScript(WKUserScript(source: "window.fixtureScheme = '\(scheme)';\n" + source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The About page fixture (issue 171), the same seam: Debug only, and its script is copied into test builds only.
        if ProcessInfo.processInfo.arguments.contains("--about-fixture"),
           let url = Bundle.main.url(forResource: "about-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            let scheme = ProcessInfo.processInfo.arguments.contains("--fixture-dark") ? "dark" : "light"
            controller.addUserScript(WKUserScript(source: "window.fixtureScheme = '\(scheme)';\n" + source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The Settings page fixture (issue 167), the same seam: Debug only, and its script is copied into test builds only.
        if ProcessInfo.processInfo.arguments.contains("--settings-fixture"),
           let url = Bundle.main.url(forResource: "settings-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            let scheme = ProcessInfo.processInfo.arguments.contains("--fixture-dark") ? "dark" : "light"
            controller.addUserScript(WKUserScript(source: "window.fixtureScheme = '\(scheme)';\n" + source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The Live Photo fixture (issue 386), the same seam: Debug only, and its script and its synthetic motion are copied
        // into test builds only.
        if ProcessInfo.processInfo.arguments.contains("--live-photo-fixture"),
           let url = Bundle.main.url(forResource: "live-photo-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            let scheme = ProcessInfo.processInfo.arguments.contains("--fixture-dark") ? "dark" : "light"
            controller.addUserScript(WKUserScript(source: "window.fixtureScheme = '\(scheme)';\n" + source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The video tile fixture (issue 415), the same seam: Debug only, and its script is copied into test builds only; its
        // video is the Live Photo fixture's synthetic clip.
        if ProcessInfo.processInfo.arguments.contains("--video-tile-fixture"),
           let url = Bundle.main.url(forResource: "video-tile-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            let scheme = ProcessInfo.processInfo.arguments.contains("--fixture-dark") ? "dark" : "light"
            controller.addUserScript(WKUserScript(source: "window.fixtureScheme = '\(scheme)';\n" + source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The video controls fixture (issue 416), the same seam: Debug only, and its script and its synthetic clips are
        // copied into test builds only.
        if ProcessInfo.processInfo.arguments.contains("--video-controls-fixture"),
           let url = Bundle.main.url(forResource: "video-controls-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            let shape = ProcessInfo.processInfo.arguments.contains("--fixture-video-landscape") ? "landscape" : "portrait"
            controller.addUserScript(WKUserScript(source: "window.fixtureVideo = '\(shape)';\n" + source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The contacts fixture (issue 393), the same seam: Debug only. The synthetic person is written first, so the card
        // the page asks for has someone in it.
        if ProcessInfo.processInfo.arguments.contains("--contacts-fixture"),
           let url = Bundle.main.url(forResource: "contacts-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            ContactsFixture.seedIfAsked()
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The conversation background fixture (issue 417), the same seam: Debug only, and its script is copied into test
        // builds only.
        if ProcessInfo.processInfo.arguments.contains("--background-fixture"),
           let url = Bundle.main.url(forResource: "background-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The text effects fixture (issue 433), the same seam: Debug only, and its script is copied into test builds only.
        if ProcessInfo.processInfo.arguments.contains("--text-effects-fixture"),
           let url = Bundle.main.url(forResource: "text-effects-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The message cache fixture (issue 441), the same seam: Debug only. It signs the real page in to a stand-in server
        // over an emulated slow link and measures a launch with the device's store and without it, cold and warm.
        if ProcessInfo.processInfo.arguments.contains("--message-cache-fixture"),
           let url = Bundle.main.url(forResource: "message-cache-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            let mode = ProcessInfo.processInfo.arguments.contains("--fixture-cache-off") ? "off" : "on"
            let run = ProcessInfo.processInfo.arguments.contains("--fixture-cache-warm") ? "warm" : "cold"
            controller.addUserScript(WKUserScript(source: "window.fixtureCacheMode = '\(mode)'; window.fixtureCacheRun = '\(run)';\n" + source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The edit history fixture (issue 437), the same seam: Debug only, and its script is copied into test builds only.
        if ProcessInfo.processInfo.arguments.contains("--edit-history-fixture"),
           let url = Bundle.main.url(forResource: "edit-history-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The text formatting fixture (issue 447), the same seam: Debug only, and its script is copied into test builds only.
        if ProcessInfo.processInfo.arguments.contains("--text-format-fixture"),
           let url = Bundle.main.url(forResource: "text-format-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The group rename fixture (issue 439), the same seam: Debug only, and its script is copied into test builds only.
        if ProcessInfo.processInfo.arguments.contains("--group-rename-fixture"),
           let url = Bundle.main.url(forResource: "group-rename-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The send effects fixture (issue 442), the same seam: Debug only, and its script is copied into test builds only.
        if ProcessInfo.processInfo.arguments.contains("--send-effects-fixture"),
           let url = Bundle.main.url(forResource: "send-effects-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The mention fixture (issue 453), the same seam: Debug only, and its script is copied into test builds only.
        if ProcessInfo.processInfo.arguments.contains("--mention-fixture"),
           let url = Bundle.main.url(forResource: "mention-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The group members fixture (issue 456), the same seam: Debug only, and its script is copied into test builds only.
        if ProcessInfo.processInfo.arguments.contains("--group-members-fixture"),
           let url = Bundle.main.url(forResource: "group-members-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The late notice fixture (issue 414), the same seam: Debug only. It signs the real page in to a stand-in server
        // and raises a notice for a message that server does not have yet.
        if ProcessInfo.processInfo.arguments.contains("--late-notice-fixture"),
           let url = Bundle.main.url(forResource: "late-notice-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The load order fixture (issue 425), the same seam: Debug only. It signs the real page in to a stand-in server over
        // an emulated slow link and measures what loads first.
        if ProcessInfo.processInfo.arguments.contains("--load-order-fixture"),
           let url = Bundle.main.url(forResource: "load-order-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        // The audio fixture (issue 432), the same seam: Debug only, and its script and its synthetic recording are
        // copied into test builds only.
        if ProcessInfo.processInfo.arguments.contains("--audio-fixture"),
           let url = Bundle.main.url(forResource: "audio-fixture", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            let scheme = ProcessInfo.processInfo.arguments.contains("--fixture-dark") ? "dark" : "light"
            controller.addUserScript(WKUserScript(source: "window.fixtureScheme = '\(scheme)';\n" + source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        #endif
        configuration.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: configuration)
        // The page paints behind the status bar and the home indicator (viewport-fit=cover), and until it has painted
        // the shell shows the tokens' own surface rather than a system white or black (issue 175).
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "Surface") ?? .systemBackground
        webView.scrollView.backgroundColor = UIColor(named: "Surface") ?? .systemBackground
        webView.navigationDelegate = context.coordinator
        context.coordinator.hold(webView.scrollView)
        model.attach(webView)
        webView.load(URLRequest(url: BundleSchemeHandler.startURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        // A user content controller keeps its message handlers strongly, so
        // without this the bridge outlives the view it was made for.
        webView.configuration.userContentController.removeScriptMessageHandler(forName: HostBridge.messageName)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let model: ShellModel
        private var holds: [NSKeyValueObservation] = []

        /// The page never scrolls or zooms as a whole (issue 180): its own views scroll inside it, and only the media
        /// viewer zooms, in the page. WebKit moves the page to reveal a focused field and the viewport allows no zoom, so
        /// both are put back here should either happen anyway, which keeps the header pinned under the status bar.
        func hold(_ scrollView: UIScrollView) {
            scrollView.isScrollEnabled = false
            scrollView.bounces = false
            scrollView.bouncesZoom = false
            scrollView.pinchGestureRecognizer?.isEnabled = false
            holds = [
                scrollView.observe(\.contentOffset, options: [.new]) { view, _ in
                    let rest = CGPoint(x: -view.adjustedContentInset.left, y: -view.adjustedContentInset.top)
                    if view.contentOffset != rest { view.contentOffset = rest }
                },
                scrollView.observe(\.zoomScale, options: [.new]) { view, _ in
                    if view.zoomScale != 1 { view.setZoomScale(1, animated: false) }
                },
            ]
        }

        init(model: ShellModel) {
            self.model = model
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model.ready()
            webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            model.failed(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            model.failed(error.localizedDescription)
        }
    }
}

/// What the shell knows about the page: whether it has painted, and the pieces
/// the page and the shell share.
final class ShellModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case ready
        case failed(String)
    }

    @Published var phase: Phase = .loading

    let product: String
    let bridge: HostBridge
    /// Whether the JavaScriptCore engine bundle produced its global at launch.
    /// The page carries its own copy of the rules, so the shell boots either way.
    let engineReady: Bool

    init() {
        let service = Naming.bundleIdentifier.isEmpty ? "com.azuretek.cuate" : Naming.bundleIdentifier
        product = Naming.product.isEmpty ? "Cuate" : Naming.product
        bridge = HostBridge(store: KeychainSecureStore(service: service), commands: HostBridge.commandNames())
        engineReady = Engine.makeContext() != nil
    }

    func attach(_ webView: WKWebView) {
        bridge.webView = webView
    }

    func ready() {
        phase = .ready
    }

    func failed(_ message: String) {
        phase = .failed(message)
    }
}

/// The cover over the page until it has painted, and the message when a load
/// failed.
struct LoadingCover: View {
    let product: String
    let phase: ShellModel.Phase

    var body: some View {
        VStack(spacing: 16) {
            if case .failed(let message) = phase {
                Image(systemName: "exclamationmark.triangle")
                    .font(.title)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            } else {
                ProgressView()
            }
            Text(product)
                .font(.headline)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("Surface").ignoresSafeArea())
    }
}
