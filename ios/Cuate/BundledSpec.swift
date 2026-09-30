import Foundation

/// Reading a file out of the app's own bundle.
///
/// One pattern for every file the shell shares with core: core's directories are
/// copied in beside the app (see project.yml) and read here at runtime, so the
/// app carries the one owner rather than a copy of it. The desktop reads the
/// same files through core/, which is why neither interface re-declares a value
/// and neither can drift from the other.
///
/// Paths are relative to the bundle root, because core's directories are added
/// as folder references: spec/naming.json, spec/host-bridge.json,
/// build/engine.js and app/index.html all keep the layout they have in the
/// repository.
enum BundledSpec {
    static func data(at relativePath: String) throws -> Data {
        let url = Bundle.main.bundleURL.appendingPathComponent(relativePath)
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw SpecError.missing(relativePath)
        }
        return try Data(contentsOf: url)
    }

    static func load<T: Decodable>(_ relativePath: String, as type: T.Type = T.self) throws -> T {
        let data = try data(at: relativePath)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw SpecError.unreadable(relativePath, underlying: error)
        }
    }

    static func topLevelKeys(_ relativePath: String) throws -> Set<String> {
        let data = try data(at: relativePath)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw SpecError.notAnObject(relativePath)
        }
        return Set(object.keys)
    }

    enum SpecError: Error, CustomStringConvertible {
        case missing(String)
        case unreadable(String, underlying: Error)
        case notAnObject(String)

        var description: String {
            switch self {
            case .missing(let name):
                return "no bundled file at \(name): project.yml has to copy it in"
            case .unreadable(let name, let underlying):
                return "the bundled \(name) could not be decoded: \(underlying)"
            case .notAnObject(let name):
                return "the bundled \(name) is not a JSON object"
            }
        }
    }
}
