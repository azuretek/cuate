import Foundation
import IMsgRPC

/// Phase 0b embedding seam. Socket routing and production cutover stay in Phase 1.
/// The caller supplies both the database and output; no child process is launched.
public final class MessageRPC: Sendable {
    private let server: IMsgRPCServer

    public init(databasePath: String, output: any RPCOutput) {
        server = IMsgRPCServer(databasePath: databasePath, output: output)
    }

    public func run(lines: AsyncThrowingStream<String, Error>) async throws {
        try await server.run(lines: lines)
    }
}
