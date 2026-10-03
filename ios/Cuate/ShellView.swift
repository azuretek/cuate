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
