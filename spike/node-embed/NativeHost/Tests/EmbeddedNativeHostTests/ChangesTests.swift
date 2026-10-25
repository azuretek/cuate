import XCTest
import Foundation
import SQLite3
@testable import EmbeddedNativeHost
final class ChangesTests: XCTestCase {
    func fixture(_ sql: String, _ run: (String) throws -> Void) throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("synthetic.db").path
        var db: OpaquePointer?; XCTAssertEqual(sqlite3_open(file, &db), SQLITE_OK)
        XCTAssertEqual(sqlite3_exec(db, sql, nil, nil, nil), SQLITE_OK); sqlite3_close(db)
        try run(file)
    }
    func testReadOnlyAndTieBoundary() throws {
        try fixture("CREATE TABLE message(guid,date_retracted INTEGER,date_read INTEGER,is_from_me INTEGER);CREATE TABLE chat_message_join(message_id,chat_id);INSERT INTO message VALUES('a',1000001,2000001,1),('b',1000999,2000999,0);INSERT INTO chat_message_join VALUES(1,1),(2,1)") { file in
            let before = try Data(contentsOf: URL(fileURLWithPath: file))
            let page = try ChangeReader.read(database: file, request: ["action":"unsent", "cursor":[0.0,0.0], "limit":1])
            XCTAssertEqual(page["more"] as? Bool, true); XCTAssertEqual(page["cursor"] as? [Double], [1,1])
            let next = try ChangeReader.read(database: file, request: ["action":"unsent", "cursor":[1.0,1.0], "limit":1])
            XCTAssertEqual(next["cursor"] as? [Double], [1,2])
            let read = try ChangeReader.read(database: file, request: ["action":"read", "cursor":[0.0,0.0], "limit":200])
            XCTAssertEqual((read["rows"] as? [[Any]])?.count, 1)
            XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: file)), before)
        }
    }
    func testInvalidRequestBeforeOpening() {
        for request: [String:Any] in [["action":"write"],["action":"latest","sql":"SELECT 1"],["action":"read","cursor":[0,0],"limit":0],["action":"among","guids":["bad\0id"]],["action":"read","cursor":[-1,0],"limit":1]] {
            XCTAssertThrowsError(try ChangeReader.read(database:"unused",request:request)) { XCTAssertEqual($0 as? MetadataFailure,.invalid) }
        }
    }
    func testMissingStoreDoesNotCreate() {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        XCTAssertThrowsError(try ChangeReader.read(database:file,request:["action":"latest"])) { XCTAssertEqual($0 as? MetadataFailure,.unavailable) }
        XCTAssertFalse(FileManager.default.fileExists(atPath:file))
    }
    func testMalformedIsNotEmpty() throws {
        try fixture("CREATE TABLE unrelated(value)") { file in
            XCTAssertThrowsError(try ChangeReader.read(database:file,request:["action":"latest"])) { XCTAssertEqual($0 as? MetadataFailure,.schema) }
        }
        try fixture("CREATE TABLE message(guid,date_retracted INTEGER);INSERT INTO message VALUES('x',1)") { file in
            XCTAssertThrowsError(try ChangeReader.read(database:file,request:["action":"unsent","cursor":[0.0,0.0],"limit":1])) { XCTAssertEqual($0 as? MetadataFailure,.schema) }
        }
    }
    func testVMDeadlineTerminates() throws {
        try fixture("CREATE VIEW message AS WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<200000) SELECT x AS rowid, CAST(x AS TEXT) AS guid, x AS date_retracted FROM n") { file in
            XCTAssertThrowsError(try ChangeReader.read(database:file,request:["action":"latest"])) { XCTAssertEqual($0 as? MetadataFailure,.limit) }
        }
    }
}
