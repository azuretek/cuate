import Foundation
import SQLite3
import CoreFoundation

// Spike-only fixed queries. Authority is the existing admitted session, never caller SQL or paths.
public enum ChangeReader {
    public static func read(database: String, request: [String: Any]) throws -> [String: Any] {
        guard let action = request["action"] as? String, ["latest", "unsent", "read", "among"].contains(action),
              Set(request.keys).isSubset(of: ["action", "cursor", "limit", "guids"]) else { throw MetadataFailure.invalid }
        let expected: Set<String> = action == "latest" ? ["action"] : action == "among" ? ["action", "guids"] : ["action", "cursor", "limit"]
        guard Set(request.keys) == expected, (action != "among" || request["guids"] is [String]),
              (action == "latest" || action == "among" || (request["cursor"] is [Double] && request["limit"] is Int)) else { throw MetadataFailure.invalid }
        func boolean(_ value: Any) -> Bool {
            guard let n = value as? NSNumber else { return false }
            return CFGetTypeID(n) == CFBooleanGetTypeID()
        }
        guard !(request["cursor"] as? [Any] ?? []).contains(where: boolean), request["limit"].map(boolean) != true else { throw MetadataFailure.invalid }
        let cursor = request["cursor"] as? [Double] ?? [0, 0]
        let limit = request["limit"] as? Int ?? 200
        let ids = request["guids"] as? [String] ?? []
        guard cursor.count == 2, cursor.allSatisfy({ $0.isFinite && $0 >= 0 && $0.rounded(.towardZero) == $0 && $0 <= 9007199254740991 }),
              (1...200).contains(limit), ids.count <= 128,
              ids.allSatisfy({ !$0.utf8.contains(0) && $0.utf8.count <= 512 }) else { throw MetadataFailure.invalid }
        var db: OpaquePointer?
        guard sqlite3_open_v2(database, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil) == SQLITE_OK else {
            sqlite3_close(db); throw MetadataFailure.unavailable
        }
        defer { sqlite3_close(db) }
        guard sqlite3_db_readonly(db, "main") == 1 else { throw MetadataFailure.unavailable }
        sqlite3_busy_timeout(db, 0); sqlite3_limit(db, SQLITE_LIMIT_LENGTH, 65536)
        var turns: Int32 = 1000
        return try withUnsafeMutablePointer(to: &turns) { budget in
            sqlite3_progress_handler(db, 1000, { context in
                guard let context else { return 1 }
                let p = context.assumingMemoryBound(to: Int32.self); p.pointee -= 1
                return p.pointee <= 0 ? 1 : 0
            }, budget)
            defer { sqlite3_progress_handler(db, 0, nil, nil) }
            func query(_ sql: String, _ args: [Any] = []) throws -> [[Any]] {
                var stmt: OpaquePointer?
                guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else { throw MetadataFailure.schema }
                defer { sqlite3_finalize(stmt) }
                for (i, arg) in args.enumerated() {
                    let result: Int32
                    if let s = arg as? String { result = s.withCString { sqlite3_bind_text(stmt, Int32(i + 1), $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) } }
                    else if let n = arg as? Int { result = sqlite3_bind_int64(stmt, Int32(i + 1), Int64(n)) }
                    else if let n = arg as? Double { result = sqlite3_bind_double(stmt, Int32(i + 1), n) }
                    else { throw MetadataFailure.invalid }
                    guard result == SQLITE_OK else { throw MetadataFailure.query }
                }
                var rows: [[Any]] = [], code = sqlite3_step(stmt)
                while code == SQLITE_ROW {
                    guard rows.count < 200 else { throw MetadataFailure.limit }
                    var row: [Any] = []
                    for n in 0..<sqlite3_column_count(stmt) {
                        switch sqlite3_column_type(stmt, n) {
                        case SQLITE_NULL: row.append(NSNull())
                        case SQLITE_INTEGER, SQLITE_FLOAT: row.append(sqlite3_column_double(stmt, n))
                        case SQLITE_TEXT:
                            let p = sqlite3_column_text(stmt, n)!
                            row.append(String(decoding: UnsafeBufferPointer(start: p, count: Int(sqlite3_column_bytes(stmt, n))), as: UTF8.self))
                        default: throw MetadataFailure.query
                        }
                    }
                    rows.append(row); code = sqlite3_step(stmt)
                }
                guard code == SQLITE_DONE else { throw code == SQLITE_INTERRUPT ? MetadataFailure.limit : MetadataFailure.query }
                return rows
            }
            let columns = Set(try query("SELECT name FROM pragma_table_info('message')").compactMap { $0[0] as? String })
            guard !columns.isEmpty else { throw MetadataFailure.schema }
            func predicate(_ column: String) -> String { column == "date_read" ? (columns.contains("is_from_me") ? " AND m.is_from_me = 1" : " AND 0") : "" }
            func latest(_ column: String) throws -> [Any] {
                guard columns.contains(column) else { return [0, 0] }
                return try query("SELECT m." + column + " / 1000000 AS at, m.ROWID AS rowid FROM message m WHERE m." + column + " > 0" + predicate(column) + " ORDER BY at DESC, rowid DESC LIMIT 1").first ?? [0, 0]
            }
            if action == "latest" {
                let row = try query("SELECT MAX(ROWID) FROM message").first?[0] ?? NSNull()
                return ["rowid": row, "unsent": try latest("date_retracted"), "read": try latest("date_read")]
            }
            let column = action == "read" ? "date_read" : "date_retracted"
            if action == "among" {
                guard columns.contains(column), !ids.isEmpty else { return ["guids": []] }
                let rows = try query("SELECT m.guid FROM message m WHERE m.date_retracted > 0 AND m.guid IN (" + ids.map { _ in "?" }.joined(separator: ",") + ")", ids)
                return ["guids": rows.map { $0[0] }]
            }
            guard columns.contains(column) else { return ["rows": [], "cursor": cursor, "more": false] }
            let at = "m." + column + " / 1000000"
            let rows = try query("SELECT m.ROWID AS rowid, m.guid, j.chat_id, " + at + " AS at FROM message m JOIN chat_message_join j ON j.message_id = m.ROWID WHERE m." + column + " > 0" + predicate(column) + " AND (" + at + " > ? OR (" + at + " = ? AND m.ROWID > ?)) ORDER BY at ASC, rowid ASC LIMIT ?", [cursor[0], cursor[0], cursor[1], limit])
            return ["rows": rows, "cursor": rows.last.map { [$0[3], $0[0]] } ?? cursor.map { $0 as Any }, "more": rows.count >= limit]
        }
    }
}
