import Foundation
import SQLite3

// Disposable native reader, selected only by an existing library session.
// Fixed statements only; no caller SQL, write flag, cached connection or busy wait.
public enum MetadataFailure: String, Error { case invalid, unavailable, schema, query, limit }
public enum MetadataReader {
    public static func read(database: String, kind: String, guids: [String]) throws -> [[Any]] {
        guard ["voices", "renames", "sendEffects", "members", "backgrounds", "backgroundLatest"].contains(kind), guids.count <= 128,
              guids.allSatisfy({ !$0.utf8.contains(0) && $0.utf8.count <= 512 }) else { throw MetadataFailure.invalid }
        let ids = Array(Set(guids.filter { !$0.isEmpty })).sorted()
        let latest = kind == "backgroundLatest"
        guard !latest || guids.isEmpty else { throw MetadataFailure.invalid }
        if ids.isEmpty && !latest { return [] }
        var db: OpaquePointer?
        guard sqlite3_open_v2(database, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil) == SQLITE_OK else {
            sqlite3_close(db); throw MetadataFailure.unavailable
        }
        defer { sqlite3_close(db) }
        guard sqlite3_db_readonly(db, "main") == 1 else { throw MetadataFailure.unavailable }
        sqlite3_busy_timeout(db, 0)
        sqlite3_limit(db, SQLITE_LIMIT_LENGTH, 65536)
        // One million VM steps bounds an unindexed/corrupt store on the Node worker.
        var turns: Int32 = 1000
        return try withUnsafeMutablePointer(to: &turns) { budget in
            sqlite3_progress_handler(db, 1000, { context in
                guard let context else { return 1 }
                let p = context.assumingMemoryBound(to: Int32.self); p.pointee -= 1
                return p.pointee <= 0 ? 1 : 0
            }, budget)
            defer { sqlite3_progress_handler(db, 0, nil, nil) }
            func statement(_ sql: String) throws -> OpaquePointer {
                var result: OpaquePointer?
                guard sqlite3_prepare_v2(db, sql, -1, &result, nil) == SQLITE_OK, let result else { throw MetadataFailure.schema }
                return result
            }
            func text(_ s: OpaquePointer, _ n: Int32) -> String {
                guard let p = sqlite3_column_text(s, n) else { return "" }
                return String(decoding: UnsafeBufferPointer(start: p, count: Int(sqlite3_column_bytes(s, n))), as: UTF8.self)
            }
            let schema = try statement("SELECT name FROM pragma_table_info('message')")
            var columns = Set<String>(); var code = sqlite3_step(schema)
            while code == SQLITE_ROW { columns.insert(text(schema, 0)); code = sqlite3_step(schema) }
            sqlite3_finalize(schema)
            guard code == SQLITE_DONE, columns.contains("guid") else { throw MetadataFailure.schema }
            let select: String
            switch kind {
            case "voices":
                guard columns.contains("is_audio_message") else { return [] }
                let played = columns.contains("is_played") ? "is_played" : "0"
                let at = columns.contains("date_played") ? "date_played / 1000000" : "0"
                select = "guid, \(played), \(at) FROM message WHERE is_audio_message = 1"
            case "renames":
                guard columns.contains("item_type"), columns.contains("group_title") else { return [] }
                select = "guid, group_title FROM message WHERE item_type = 2"
            case "backgrounds", "backgroundLatest":
                guard columns.contains("item_type"), columns.contains("group_action_type") else { return [] }
                select = latest ? "j.chat_id, m.guid, m.group_action_type FROM message m JOIN chat_message_join j ON j.message_id = m.ROWID WHERE m.item_type = 3 AND m.group_action_type IN (4,6) ORDER BY m.date DESC, m.ROWID DESC" : "guid, group_action_type FROM message WHERE item_type = 3 AND group_action_type IN (4,6)"
            case "members":
                guard columns.contains("item_type"), columns.contains("group_action_type") else { return [] }
                let handles = try statement("SELECT name FROM pragma_table_info('handle')")
                var hasHandle = false; code = sqlite3_step(handles)
                while code == SQLITE_ROW { if text(handles, 0) == "id" { hasHandle = true }; code = sqlite3_step(handles) }
                sqlite3_finalize(handles)
                guard code == SQLITE_DONE else { throw MetadataFailure.schema }
                let other = columns.contains("other_handle") && hasHandle
                let handle = other ? "h.id" : "NULL"
                let join = other ? " LEFT JOIN handle h ON h.ROWID = m.other_handle" : ""
                select = "m.guid, m.item_type, m.group_action_type, \(handle) FROM message m\(join) WHERE ((m.item_type = 1 AND m.group_action_type = 0) OR (m.item_type = 1 AND m.group_action_type = 1) OR (m.item_type = 3 AND m.group_action_type = 0))"
            default:
                guard columns.contains("expressive_send_style_id") else { return [] }
                select = "guid, expressive_send_style_id FROM message WHERE COALESCE(expressive_send_style_id, '') != ''"
            }
            let query = try statement("SELECT " + select + (latest ? "" : " AND guid IN (" + ids.map { _ in "?" }.joined(separator: ",") + ")"))
            defer { sqlite3_finalize(query) }
            for (i, id) in ids.enumerated() {
                let result = id.withCString { sqlite3_bind_text(query, Int32(i + 1), $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
                guard result == SQLITE_OK else { throw MetadataFailure.query }
            }
            var rows: [[Any]] = []; code = sqlite3_step(query)
            while code == SQLITE_ROW {
                guard rows.count < (latest ? 200 : 128) else { throw MetadataFailure.limit }
                let guid = text(query, 0)
                if latest {
                    func scalar(_ column: Int32) throws -> Any {
                        switch sqlite3_column_type(query, column) {
                        case SQLITE_NULL: return NSNull()
                        case SQLITE_INTEGER: return sqlite3_column_int64(query, column)
                        case SQLITE_FLOAT: return sqlite3_column_double(query, column)
                        case SQLITE_TEXT: return text(query, column)
                        default: throw MetadataFailure.query
                        }
                    }
                    rows.append([try scalar(0), try scalar(1), sqlite3_column_int64(query, 2) == 4 ? "set" : "clear"])
                } else if kind == "backgrounds" {
                    rows.append([guid, sqlite3_column_int64(query, 1) == 4 ? "set" : "clear"])
                } else if kind == "voices" {
                    let played = sqlite3_column_int64(query, 1) == 1
                    let ms = sqlite3_column_double(query, 2)
                    var value: [String: Any] = ["played": played]
                    if played && ms > 0 {
                        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                        value["playedAt"] = formatter.string(from: Date(timeIntervalSince1970: 978307200 + ms / 1000))
                    }
                    rows.append([guid, value])
                } else if kind == "members" {
                    let item = sqlite3_column_int64(query, 1), action = sqlite3_column_int64(query, 2)
                    let name = item == 3 && action == 0 ? "leave" : item == 1 && action == 0 ? "add" : "remove"
                    // JS String.trim whitespace set, including BOM but excluding NEL.
                    let spaces = CharacterSet(charactersIn: "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D} \u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
                    let handle = sqlite3_column_type(query, 3) == SQLITE_TEXT ? text(query, 3).trimmingCharacters(in: spaces) : ""
                    rows.append([guid, ["action": name, "handle": name != "leave" && !handle.isEmpty ? handle as Any : NSNull()]])
                } else { rows.append([guid, text(query, 1)]) }
                code = sqlite3_step(query)
            }
            guard code == SQLITE_DONE else { throw code == SQLITE_INTERRUPT ? MetadataFailure.limit : MetadataFailure.query }
            return rows
        }
    }
}
@_cdecl("host_metadata")
public func hostMetadata(_ database: UnsafePointer<CChar>, _ kind: UnsafePointer<CChar>, _ request: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    let value: [String: Any]
    do {
        guard let data = String(cString: request).data(using: .utf8) else { throw MetadataFailure.invalid }
        let input = try JSONSerialization.jsonObject(with: data)
        if String(cString: kind) == "changes" {
            guard let object = input as? [String: Any] else { throw MetadataFailure.invalid }
            let output: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier, "value": try ChangeReader.read(database: String(cString: database), request: object)]
            guard let bytes = try? JSONSerialization.data(withJSONObject: output), bytes.count <= 65536, let result = String(data: bytes, encoding: .utf8) else { return strdup("{\"error\":\"limit\"}") }
            return strdup(result)
        }
        guard let ids = input as? [String] else { throw MetadataFailure.invalid }
        value = ["pid": ProcessInfo.processInfo.processIdentifier, "rows": try MetadataReader.read(database: String(cString: database), kind: String(cString: kind), guids: ids)]
    } catch { value = ["error": (error as? MetadataFailure)?.rawValue ?? "invalid"] }
    guard let data = try? JSONSerialization.data(withJSONObject: value), data.count <= 65536, let result = String(data: data, encoding: .utf8) else { return strdup("{\"error\":\"limit\"}") }
    return strdup(result)
}
@_cdecl("host_metadata_free")
public func hostMetadataFree(_ value: UnsafeMutablePointer<CChar>?) { free(value) }
