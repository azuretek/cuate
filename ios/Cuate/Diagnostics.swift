import Foundation
import MetricKit
import OSLog

/// MetricKit diagnostics, reporting crashes and hangs on the next launch.
///
/// MetricKit hands a payload to its subscribers on the launch after the one that
/// produced it, so the shell writes each payload to disk here and reads the
/// directory back at launch. The files stay on the device; nothing is sent
/// anywhere, which is the same posture the rest of the app takes with anything
/// it keeps.
final class Diagnostics: NSObject, MXMetricManagerSubscriber {
    static let shared = Diagnostics()

    private let log = Logger(subsystem: "com.azuretek.cuate", category: "diagnostics")
    private let directory: URL

    private override init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        directory = base.appendingPathComponent("Diagnostics", isDirectory: true)
        super.init()
    }

    func start() {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        MXMetricManager.shared.add(self)
        log.info("diagnostics started with \(self.stored.count) stored payload(s)")
    }

    /// The payloads written by earlier launches, which is what a crash or a hang
    /// from the last run arrives as.
    var stored: [URL] {
        (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    }

    func didReceive(_ payloads: [MXMetricPayload]) {
        for payload in payloads {
            write(payload.jsonRepresentation(), kind: "metric")
        }
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            write(payload.jsonRepresentation(), kind: "diagnostic")
        }
    }

    private func write(_ data: Data, kind: String) {
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let url = directory.appendingPathComponent(kind + "-" + stamp + ".json")
        try? data.write(to: url)
        log.info("stored a \(kind, privacy: .public) payload")
    }
}
