import Foundation

public enum StreamFailure: Error { case overflow }
// Admission and terminal completion are separate. EOF drains accepted work; cancel
// also asks the engine to stop. Output backpressure is terminal, never silent loss.
public final class NativeSession: @unchecked Sendable {
    private let lock = NSLock()
    private let input: AsyncThrowingStream<String, Error>.Continuation
    private let lines: AsyncThrowingStream<String, Error>
    private var task: Task<Void, Never>?
    private var accepting = true
    private var overflow = false
    private var started = false
    private var cancelled = false
    public init(capacity: Int = 32) {
        let pair = AsyncThrowingStream<String, Error>.makeStream(bufferingPolicy: .bufferingOldest(capacity))
        lines = pair.stream; input = pair.continuation
    }
    public func write(_ line: String) -> Int32 {
        lock.lock(); defer { lock.unlock() }
        guard accepting else { return 2 }
        guard line.utf8.count <= 65536 else { return 3 }
        switch input.yield(line) {
        case .enqueued: return 0
        case .dropped: return 1
        case .terminated: return 2
        @unknown default: return 2
        }
    }
    public func close(cancel: Bool) -> Bool {
        lock.lock(); defer { lock.unlock() }
        let was = accepting; accepting = false
        input.finish()
        if cancel { cancelled = true; task?.cancel() }
        return was
    }
    private func outputFailed() {
        lock.lock(); overflow = true; accepting = false; input.finish(throwing: StreamFailure.overflow); task?.cancel(); lock.unlock()
    }
    private func terminal(_ failed: Bool) -> Int32 {
        lock.lock(); defer { lock.unlock() }; accepting = false
        task = nil
        return overflow ? 3 : (cancelled || failed) ? 1 : 0
    }
    private func admitStart() throws {
        lock.lock(); defer { lock.unlock() }
        if cancelled { throw CancellationError() }
    }
    public func start(engine: any NativeEngine, emit: @escaping @Sendable (String) -> Bool, end: @escaping @Sendable (Int32) -> Void) {
        lock.lock(); defer { lock.unlock() }
        precondition(!started); started = true
        task = Task { [self] in
            var failed = false
            do { try admitStart(); try Task.checkCancellation(); try await engine.run(lines: lines, emit: { [self] line in
                if !emit(line) { outputFailed() }
            }) } catch { failed = true }
            let code = terminal(failed)
            end(code)
        }
        if cancelled { task?.cancel() }
    }
}

// This engine is a disposable, explicitly selected fixture, not a platform fallback.
private struct SyntheticEngine: NativeEngine {
    func run(lines: AsyncThrowingStream<String, Error>, emit: @escaping @Sendable (String) -> Void) async throws {
        var subscribed = false
        var messages: [[String:Any]] = []
        for try await line in lines {
            try Task.checkCancellation()
            guard let data = line.data(using: .utf8), let request = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            let id = request["id"] ?? NSNull()
            let method = request["method"] as? String ?? ""
            let params = request["params"] as? [String: Any] ?? [:]
            var response: [String: Any] = ["jsonrpc": "2.0", "id": id]
            switch method {
            case "status": response["result"] = ["version":"synthetic-native", "database":["ready":true], "methods":["watch.subscribe"]]
            case "watch.subscribe": subscribed = true; response["result"] = ["subscription":1]
            case "watch.unsubscribe": subscribed = false; response["result"] = ["ok":true]
            case "messages.after":
                let since = params["since_rowid"] as? Int ?? 0, limit = params["limit"] as? Int ?? 200
                let eligible = messages.filter { ($0["id"] as? Int ?? 0) > since }.sorted { ($0["id"] as? Int ?? 0) < ($1["id"] as? Int ?? 0) }
                let page = Array(eligible.prefix(max(0, limit)))
                response["result"] = ["messages":page, "next_rowid":page.last?["id"] ?? since, "has_more":eligible.count > page.count]
            case "messages.history": response["result"] = ["messages":messages]
            case "chats.list": response["result"] = ["chats":[]]
            case "send":
                response["error"] = ["code":-32001,"message":"synthetic uncertain outcome; no platform write", "data":["disposition":"may_have_completed"]]
            case "synthetic.emit":
                messages.append(params)
                if subscribed { let n: [String: Any] = ["jsonrpc":"2.0","method":"message","params":["message":params]]; emit(String(data:try JSONSerialization.data(withJSONObject:n),encoding:.utf8)!) }
                response["result"] = ["ok":true]
            default: response["error"] = ["code":-32601,"message":"fixture refuses unsupported method"]
            }
            emit(String(data:try JSONSerialization.data(withJSONObject:response),encoding:.utf8)!)
        }
    }
}
public typealias StreamReply = @convention(c) (Int32, UnsafePointer<CChar>?, Int32) -> Int32
private final class Sessions: @unchecked Sendable {
    let lock = NSLock(); var values: [Int32: NativeSession] = [:]
    func get(_ id: Int32) -> NativeSession? { lock.lock(); defer { lock.unlock() }; return values[id] }
    func add(_ id: Int32, _ value: NativeSession) -> Bool { lock.lock(); defer { lock.unlock() }; guard values[id] == nil, values.count < 8 else { return false }; values[id] = value; return true }
    func remove(_ id: Int32) { lock.lock(); values.removeValue(forKey:id); lock.unlock() }
}
private let sessions = Sessions()
@_cdecl("host_stream_open")
public func streamOpen(_ id: Int32, _ database: UnsafePointer<CChar>, _ fixture: Int32, _ callback: @escaping StreamReply) -> Int32 {
    let session = NativeSession()
    guard sessions.add(id,session) else { return 0 }
    let engine: any NativeEngine = fixture == 1 ? SyntheticEngine() : LibraryEngine(databasePath:String(cString:database))
    session.start(engine:engine,emit:{ line in line.withCString { callback(id,$0,0) != 0 } },end:{ code in
        // JS retains its generation until terminal delivery; no producer survives this point.
        sessions.remove(id); _ = callback(id,nil,code + 1)
    })
    return 1
}
@_cdecl("host_stream_write")
public func streamWrite(_ id: Int32, _ line: UnsafePointer<CChar>) -> Int32 { sessions.get(id)?.write(String(cString:line)) ?? 2 }
@_cdecl("host_stream_close")
public func streamClose(_ id: Int32, _ cancel: Int32) -> Int32 { sessions.get(id)?.close(cancel:cancel != 0) == true ? 1 : 0 }
