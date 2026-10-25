import Foundation
import IMsgRPC

// The host injects the engine; no subprocess, standard input, or socket transport.
public protocol NativeEngine: Sendable {
    func run(lines: AsyncThrowingStream<String, Error>, emit: @escaping @Sendable (String) -> Void) async throws
}
public struct LibraryEngine: NativeEngine {
    public let databasePath: String
    public init(databasePath: String) { self.databasePath = databasePath }
    public func run(lines: AsyncThrowingStream<String, Error>, emit: @escaping @Sendable (String) -> Void) async throws {
        let server = IMsgRPCServer(databasePath: databasePath, output: RPCWriter(writeLine: emit))
        try await server.run(lines: lines)
    }
}
public final class NativeHost: @unchecked Sendable {
    private let engine: any NativeEngine
    public init(engine: any NativeEngine) { self.engine = engine }
    public func run(lines: AsyncThrowingStream<String, Error>, emit: @escaping @Sendable (String) -> Void) async throws {
        try await engine.run(lines: lines, emit: emit)
    }
}
private final class Output: @unchecked Sendable {
    let lock = NSLock()
    var lines: [String] = []
    func append(_ line: String) { lock.lock(); defer { lock.unlock() }; lines.append(line) }
    func json() throws -> String { lock.lock(); defer { lock.unlock() }; return String(data: try JSONSerialization.data(withJSONObject: ["pid": ProcessInfo.processInfo.processIdentifier, "lines": lines]), encoding: .utf8)! }
}
// One finite batch only: the callback is terminal, exactly once, after engine drain.
// The caller must retain callback context until terminal completion, even if it cancels its JS promise.
public typealias HostReply = @convention(c) (Int32, UnsafePointer<CChar>?, Int32) -> Void
@_cdecl("host_rpc")
public func hostRPC(_ id: Int32, _ request: UnsafePointer<CChar>, _ database: UnsafePointer<CChar>, _ callback: @escaping HostReply) {
    let line = String(cString: request)
    let path = String(cString: database)
    Task {
        let output = Output()
        let stream = AsyncThrowingStream<String, Error> { continuation in continuation.yield(line); continuation.finish() }
        do {
            try await NativeHost(engine: LibraryEngine(databasePath: path)).run(lines: stream, emit: { output.append($0) })
            let json = try output.json()
            json.withCString { callback(id, $0, 0) }
        } catch {
            String(describing: error).withCString { callback(id, $0, 1) }
        }
    }
}
