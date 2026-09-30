import Foundation
import WebKit

/// Serving core's files to the web view over a scheme of the app's own.
///
/// The page is core/app/index.html and its modules import across app/, kit/ and
/// the rules beside them, so the whole of core is copied into the bundle and
/// served here with its layout intact. A file URL cannot serve ES modules (its
/// origin is opaque and every import fails), which is why the page is not loaded
/// from disk directly.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "cuate"
    static let host = "bundle"
    static let pagePath = "app/index.html"

    static var startURL: URL {
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.path = "/" + pagePath
        return components.url ?? URL(fileURLWithPath: "/")
    }

    private static let types: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "woff2": "font/woff2",
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        let path = url.path.removingPercentEncoding ?? url.path
        if case .success(let data) = serve(path: path) {
            let mime = Self.types[(path as NSString).pathExtension.lowercased()] ?? "application/octet-stream"
            respond(urlSchemeTask, url: url, status: 200, mime: mime, data: data)
        } else {
            respond(urlSchemeTask, url: url, status: 404, mime: "text/plain; charset=utf-8", data: Data("not found".utf8))
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, mime: String, data: Data) {
        let headers = [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Cache-Control": "no-store",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else { return }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func serve(path rawPath: String) -> Result<Data, ServeError> {
        let path = rawPath.hasPrefix("/") ? String(rawPath.dropFirst()) : rawPath
        guard !path.isEmpty, !path.contains("..") else { return .failure(.refused) }
        let url = Bundle.main.bundleURL.appendingPathComponent(path)
        guard let data = try? Data(contentsOf: url) else { return .failure(.missing) }
        return .success(data)
    }

    enum ServeError: Error, CustomStringConvertible {
        case refused
        case missing

        var description: String {
            switch self {
            case .refused: return "a path outside the bundle was refused"
            case .missing: return "the file is not in the bundle"
            }
        }
    }
}
