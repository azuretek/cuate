import CuateHelperCore
import Darwin
import Foundation

final class SocketServer {
    private let path: String
    private let responder: RPCResponder

    init(path: String, responder: RPCResponder = RPCResponder()) {
        self.path = path
        self.responder = responder
    }

    func start() {
        Thread.detachNewThread { [weak self] in
            self?.serve()
        }
    }

    private func serve() {
        signal(SIGPIPE, SIG_IGN)
        unlink(path)
        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { fail("socket: " + String(errno)) }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8CString)
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            fail("socket path too long")
        }
        withUnsafeMutableBytes(of: &address.sun_path) { destination in
            bytes.withUnsafeBytes { source in
                destination.copyMemory(from: source)
            }
        }
        let length = socklen_t(MemoryLayout<sockaddr_un>.size)
        address.sun_len = UInt8(length)
        let old = umask(0o077)
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(descriptor, $0, length) }
        }
        umask(old)
        guard bound == 0 else { fail("bind: " + String(errno)) }
        guard listen(descriptor, 8) == 0 else { fail("listen: " + String(errno)) }
        FileHandle.standardError.write(("cuate-helper listening on " + path + "\n").data(using: .utf8)!)

        while true {
            let client = accept(descriptor, nil, nil)
            if client < 0 { continue }
            var uid: uid_t = 0
            var gid: gid_t = 0
            if getpeereid(client, &uid, &gid) != 0 || uid != getuid() {
                close(client)
                continue
            }
            Thread.detachNewThread { [weak self] in
                self?.handle(client)
            }
        }
    }

    private func handle(_ descriptor: Int32) {
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        var buffer = Data()
        while true {
            let chunk = handle.availableData
            if chunk.isEmpty { return }
            buffer.append(chunk)
            while let newline = buffer.firstIndex(of: 0x0A) {
                let line = buffer.subdata(in: buffer.startIndex..<newline)
                buffer.removeSubrange(buffer.startIndex...newline)
                var output = responder.respond(to: line)
                output.append(0x0A)
                do {
                    try handle.write(contentsOf: output)
                } catch {
                    return
                }
            }
        }
    }

    private func fail(_ message: String) -> Never {
        FileHandle.standardError.write(("cuate-helper: " + message + "\n").data(using: .utf8)!)
        exit(1)
    }
}
