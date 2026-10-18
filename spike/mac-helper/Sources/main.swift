// Spike for issue #479. Never merges.
import Contacts
import CoreServices
import Darwin
import Foundation
import SQLite3

let info = Bundle.main.infoDictionary ?? [:]
let version = info["CFBundleShortVersionString"] as? String ?? "unbundled"
let build = info["CFBundleVersion"] as? String ?? "0"
let bundleId = Bundle.main.bundleIdentifier ?? "none"

func chatDbCount() -> [String: Any] {
    let path = NSHomeDirectory() + "/Library/Messages/chat.db"
    var db: OpaquePointer?
    let rc = sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil)
    defer { sqlite3_close(db) }
    if rc != SQLITE_OK {
        return ["ok": false, "stage": "open", "sqlite": Int(rc), "errno": Int(sqlite3_system_errno(db)),
                "message": String(cString: sqlite3_errmsg(db))]
    }
    var stmt: OpaquePointer?
    let prc = sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM message", -1, &stmt, nil)
    defer { sqlite3_finalize(stmt) }
    if prc != SQLITE_OK {
        return ["ok": false, "stage": "prepare", "sqlite": Int(prc), "errno": Int(sqlite3_system_errno(db)),
                "message": String(cString: sqlite3_errmsg(db))]
    }
    let src = sqlite3_step(stmt)
    if src != SQLITE_ROW {
        return ["ok": false, "stage": "step", "sqlite": Int(src), "errno": Int(sqlite3_system_errno(db)),
                "message": String(cString: sqlite3_errmsg(db))]
    }
    return ["ok": true, "rows": Int(sqlite3_column_int64(stmt, 0))]
}

// Grants tccd mediates, read without prompting. With System Integrity Protection off, file
// protection is not enforced, so these are the checks that still name a responsible process.
// AEDeterminePermissionToAutomateTarget: 0 granted, -1743 denied, -1744 would ask, -600 not running.
func automation(ask: Bool) -> Int {
    var desc = AEDesc()
    let bid = "com.apple.MobileSMS"
    let made = bid.withCString { AECreateDesc(typeApplicationBundleID, $0, Int(strlen($0)), &desc) }
    guard made == noErr else { return Int(made) }
    defer { AEDisposeDesc(&desc) }
    return Int(AEDeterminePermissionToAutomateTarget(&desc, typeWildCard, typeWildCard, ask))
}

// CNAuthorizationStatus: 0 not determined, 1 restricted, 2 denied, 3 authorized, 4 limited.
func tccPreflight() -> [String: Any] {
    ["contacts": CNContactStore.authorizationStatus(for: .contacts).rawValue, "automationMessages": automation(ask: false)]
}

// Asks for both grants, so macOS shows its prompts. Only called while someone is at the Mac to answer.
func tccRequest() -> [String: Any] {
    let done = DispatchSemaphore(value: 0)
    var granted = false
    var failure = ""
    CNContactStore().requestAccess(for: .contacts) { ok, err in
        granted = ok
        failure = err.map { String(describing: $0) } ?? ""
        done.signal()
    }
    _ = done.wait(timeout: .now() + 120)
    return ["contactsGranted": granted, "contactsError": failure, "automationMessages": automation(ask: true)]
}

func hello() -> [String: Any] {
    ["pid": Int(getpid()), "ppid": Int(getppid()), "version": version, "build": build, "bundleId": bundleId,
     "executable": Bundle.main.executablePath ?? CommandLine.arguments[0]]
}

func respond(_ line: Data) -> Data {
    var reply: [String: Any] = ["jsonrpc": "2.0"]
    guard let req = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else {
        reply["id"] = NSNull()
        reply["error"] = ["code": -32700, "message": "parse error"]
        return (try? JSONSerialization.data(withJSONObject: reply)) ?? Data()
    }
    reply["id"] = req["id"] ?? NSNull()
    switch req["method"] as? String {
    case "hello": reply["result"] = hello()
    case "chatdb.count": reply["result"] = chatDbCount()
    case "tcc.preflight": reply["result"] = tccPreflight()
    case "tcc.request": reply["result"] = tccRequest()
    default: reply["error"] = ["code": -32601, "message": "method not found"]
    }
    return (try? JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys])) ?? Data()
}

func handle(_ fd: Int32) {
    let fh = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    var buf = Data()
    while true {
        let chunk = fh.availableData
        if chunk.isEmpty { return }
        buf.append(chunk)
        while let nl = buf.firstIndex(of: 0x0A) {
            let line = buf.subdata(in: buf.startIndex..<nl)
            buf.removeSubrange(buf.startIndex...nl)
            var out = respond(line)
            out.append(0x0A)
            do { try fh.write(contentsOf: out) } catch { return }
        }
    }
}

func serve(_ path: String) -> Never {
    signal(SIGPIPE, SIG_IGN)
    unlink(path)
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { fail("socket: \(errno)") }
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8CString)
    guard bytes.count <= MemoryLayout.size(ofValue: addr.sun_path) else { fail("socket path too long") }
    withUnsafeMutableBytes(of: &addr.sun_path) { dst in
        bytes.withUnsafeBytes { dst.copyMemory(from: $0) }
    }
    let len = socklen_t(MemoryLayout<sockaddr_un>.size)
    addr.sun_len = UInt8(len)
    let old = umask(0o077)
    let rc = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) } }
    umask(old)
    guard rc == 0 else { fail("bind: \(errno)") }
    guard listen(fd, 8) == 0 else { fail("listen: \(errno)") }
    FileHandle.standardError.write("cuate-helper \(version) (\(build)) pid \(getpid()) on \(path)\n".data(using: .utf8)!)
    while true {
        let c = accept(fd, nil, nil)
        if c < 0 { continue }
        var uid: uid_t = 0
        var gid: gid_t = 0
        if getpeereid(c, &uid, &gid) != 0 || uid != getuid() { close(c); continue }
        Thread.detachNewThread { handle(c) }
    }
}

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write("cuate-helper: \(msg)\n".data(using: .utf8)!)
    exit(1)
}

let args = CommandLine.arguments
if let i = args.firstIndex(of: "--socket"), i + 1 < args.count {
    serve(args[i + 1])
} else if args.contains("--count") {
    let out = try! JSONSerialization.data(withJSONObject: ["hello": hello(), "count": chatDbCount()], options: [.sortedKeys])
    FileHandle.standardOutput.write(out + Data([0x0A]))
} else {
    fail("usage: cuate-helper --socket <path> | --count")
}
