import Foundation
import SQLite3

public struct ChatDatabaseResult: Codable, Sendable {
    public let ok: Bool
    public let rows: Int?
    public let message: String?
    public let permission: Permission?

    public init(ok: Bool, rows: Int? = nil, message: String? = nil, permission: Permission? = nil) {
        self.ok = ok
        self.rows = rows
        self.message = message
        self.permission = permission
    }
}

public struct ChatDatabase: Sendable {
    public let path: String

    public init(path: String = NSHomeDirectory() + "/Library/Messages/chat.db") {
        self.path = path
    }

    public func count() -> ChatDatabaseResult {
        var database: OpaquePointer?
        let opened = sqlite3_open_v2(path, &database, SQLITE_OPEN_READONLY, nil)
        guard opened == SQLITE_OK else {
            let reason = String(cString: sqlite3_errmsg(database))
            sqlite3_close(database)
            return ChatDatabaseResult(ok: false, message: "SQLite: " + reason, permission: .fullDiskAccess)
        }
        defer { sqlite3_close(database) }

        var statement: OpaquePointer?
        let prepared = sqlite3_prepare_v2(database, "SELECT COUNT(*) FROM message", -1, &statement, nil)
        guard prepared == SQLITE_OK else {
            let reason = String(cString: sqlite3_errmsg(database))
            return ChatDatabaseResult(ok: false, message: "SQLite: " + reason, permission: .fullDiskAccess)
        }
        defer { sqlite3_finalize(statement) }

        let stepped = sqlite3_step(statement)
        guard stepped == SQLITE_ROW else {
            let reason = String(cString: sqlite3_errmsg(database))
            return ChatDatabaseResult(ok: false, message: "SQLite: " + reason, permission: .fullDiskAccess)
        }
        return ChatDatabaseResult(ok: true, rows: Int(sqlite3_column_int64(statement, 0)))
    }
}
