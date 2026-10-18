import Foundation

public protocol SIPProbe: Sendable {
    func state() -> SIPState
}

/// Runs csrutil each time. The flag is measured, never remembered, because SIP
/// changes take effect for Cuate without reinstalling anything.
public struct SystemSIPProbe: SIPProbe {
    public init() {}

    public func state() -> SIPState {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/csrutil")
        process.arguments = ["status"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
        } catch {
            return .unknown
        }
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let text = String(data: data, encoding: .utf8)?.lowercased() ?? ""
        if text.contains("status: disabled") || text.contains("status: disabled.") {
            return .disabled
        }
        if text.contains("status: enabled") {
            return .enabled
        }
        return .unknown
    }
}

public struct StubSIPProbe: SIPProbe {
    public let value: SIPState
    public init(_ value: SIPState) { self.value = value }
    public func state() -> SIPState { value }
}
