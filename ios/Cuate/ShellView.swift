import SwiftUI
import WebKit

/// The app's one screen: core's page, hosted in a WKWebView, under a cover until
/// the page has painted.
struct RootView: View {
    @StateObject private var model = ShellModel()

    var body: some View {
        ZStack {
            ShellWebView(model: model)
                .ignoresSafeArea()
            if model.phase != .ready {
                LoadingCover(product: model.product, phase: model.phase)
            }
        }
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
        configuration.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground
        webView.navigationDelegate = context.coordinator
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

        init(model: ShellModel) {
            self.model = model
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model.ready()
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
        .background(Color(.systemBackground))
    }
}
