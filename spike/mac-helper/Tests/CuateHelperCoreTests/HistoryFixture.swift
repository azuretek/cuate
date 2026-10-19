import Foundation
import SQLite3

/// Synthetic SQLite only. Never opens, copies or changes the device Messages store.
struct HistoryFixture {
    let directory: URL
    var path: String { directory.appendingPathComponent("chat.db").path }

    init(rows: Int) throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        do {
            var database: OpaquePointer?
            let opened = sqlite3_open(path, &database)
            defer { sqlite3_close(database) }
            guard opened == SQLITE_OK else { throw NSError(domain: "fixture.open", code: Int(opened)) }
            let sql = "CREATE TABLE message (ROWID INTEGER PRIMARY KEY);" +
                (0..<rows).map { "INSERT INTO message VALUES (\($0 + 1));" }.joined()
            let result = sqlite3_exec(database, sql, nil, nil, nil)
            guard result == SQLITE_OK else { throw NSError(domain: "fixture.schema", code: Int(result)) }
        } catch {
            remove()
            throw error
        }
    }

    func remove() { try? FileManager.default.removeItem(at: directory) }
}
