import XCTest
import Foundation
import SQLite3
@testable import EmbeddedNativeHost
final class BackgroundTests: XCTestCase {
    func fixture(_ sql: String, _ run: (String) throws -> Void) throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("synthetic.db").path
        var db: OpaquePointer?; XCTAssertEqual(sqlite3_open(file, &db), SQLITE_OK)
        XCTAssertEqual(sqlite3_exec(db, sql, nil, nil, nil), SQLITE_OK); sqlite3_close(db)
        try run(file)
    }
    func testActionsAndLatestOrderReadOnly() throws {
        try fixture("CREATE TABLE message(guid TEXT,item_type INTEGER,group_action_type INTEGER,date INTEGER);CREATE TABLE chat_message_join(message_id,chat_id);INSERT INTO message VALUES('set',3,4,10),('clear',3,6,10),('unknown',3,5,20);INSERT INTO chat_message_join VALUES(1,1),(2,1)") { file in
            let before = try Data(contentsOf: URL(fileURLWithPath: file))
            let rows = try MetadataReader.read(database:file,kind:"backgrounds",guids:["unknown","set","clear"])
            XCTAssertEqual(rows.compactMap { $0[1] as? String },["set","clear"])
            let latest = try MetadataReader.read(database:file,kind:"backgroundLatest",guids:[])
            XCTAssertEqual(latest.compactMap { $0[1] as? String },["clear","set"])
            XCTAssertEqual(try Data(contentsOf:URL(fileURLWithPath:file)),before)
        }
    }
    func testLatestRejectsCallerFilters() {
        XCTAssertThrowsError(try MetadataReader.read(database:"unused",kind:"backgroundLatest",guids:["filter"])) { XCTAssertEqual($0 as? MetadataFailure,.invalid) }
    }
    func testLegacyIsEmptyAndMalformedFails() throws {
        try fixture("CREATE TABLE message(guid TEXT)") { file in
            XCTAssertTrue(try MetadataReader.read(database:file,kind:"backgroundLatest",guids:[]).isEmpty)
            XCTAssertTrue(try MetadataReader.read(database:file,kind:"backgrounds",guids:["set"]).isEmpty)
        }
        try fixture("CREATE TABLE message(guid TEXT,item_type INTEGER,group_action_type INTEGER)") { file in
            XCTAssertThrowsError(try MetadataReader.read(database:file,kind:"backgroundLatest",guids:[])) { XCTAssertEqual($0 as? MetadataFailure,.schema) }
        }
    }
    func testLatestVMDeadlineTerminates() throws {
        try fixture("CREATE VIEW message AS WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<200000) SELECT x AS rowid,CAST(x AS TEXT) AS guid,3 AS item_type,4 AS group_action_type,x AS date FROM n;CREATE TABLE chat_message_join(message_id,chat_id);INSERT INTO chat_message_join VALUES(1,1)") { file in
            XCTAssertThrowsError(try MetadataReader.read(database:file,kind:"backgroundLatest",guids:[])) { XCTAssertEqual($0 as? MetadataFailure,.limit) }
        }
    }
}
