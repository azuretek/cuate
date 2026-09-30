import Foundation
import JavaScriptCore

/// The generated engine bundle, evaluated in JavaScriptCore.
///
/// A shell whose JavaScript engine has no module loader (JavaScriptCore on iOS)
/// cannot import core's files, so the rules a shell needs before any page loads
/// ship as one generated bundle (scripts/gen-engine-bundle.mjs) rather than as a
/// Swift port of them. The bundle defines the global engine; it is evaluated
/// once at launch, and a nil context means the app still boots with the page's
/// own copy of the rules rather than refusing to start.
enum Engine {
    static var bundlePath: String { "build/engine.js" }

    static func makeContext() -> JSContext? {
        let url = Bundle.main.bundleURL.appendingPathComponent(bundlePath)
        guard let source = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        guard let context = JSContext() else { return nil }
        context.evaluateScript(source)
        return context.objectForKeyedSubscript("engine") != nil ? context : nil
    }
}
