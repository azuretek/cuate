import Foundation

public struct HelperInfo: Codable, Sendable {
    public let pid: Int
    public let ppid: Int
    public let version: String
    public let build: String
    public let bundleId: String
    public let executable: String
    public let commit: String

    public init(pid: Int = Int(getpid()), ppid: Int = Int(getppid()), version: String, build: String,
                bundleId: String, executable: String, commit: String) {
        self.pid = pid
        self.ppid = ppid
        self.version = version
        self.build = build
        self.bundleId = bundleId
        self.executable = executable
        self.commit = commit
    }

    public static func current() -> HelperInfo {
        let info = Bundle.main.infoDictionary ?? [:]
        return HelperInfo(
            version: info["CFBundleShortVersionString"] as? String ?? "unbundled",
            build: info["CFBundleVersion"] as? String ?? "0",
            bundleId: Bundle.main.bundleIdentifier ?? "none",
            executable: Bundle.main.executablePath ?? CommandLine.arguments.first ?? "unknown",
            commit: info["CuateCommit"] as? String ?? "unknown"
        )
    }
}
