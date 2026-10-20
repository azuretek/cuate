import XCTest
import Foundation
import SQLite3
@testable import EmbeddedNativeHost
final class MetadataTests: XCTestCase {
    func fixture(_ sql: String, _ run: (String) throws -> Void) throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("synthetic.db").path
        var db: OpaquePointer?; XCTAssertEqual(sqlite3_open(file, &db), SQLITE_OK)
        XCTAssertEqual(sqlite3_exec(db, sql, nil, nil, nil), SQLITE_OK); sqlite3_close(db)
        try run(file)
    }
    func testMissingIsNotEmptyAndDoesNotCreate() {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        XCTAssertThrowsError(try MetadataReader.read(database: path, kind: "voices", guids: ["synthetic"])) { XCTAssertEqual($0 as? MetadataFailure, .unavailable) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: path))
    }
    func testLegacyColumnsReturnEmpty() throws {
        try fixture("CREATE TABLE message(guid TEXT)") { file in
            for kind in ["voices", "renames", "sendEffects"] { XCTAssertTrue(try MetadataReader.read(database: file, kind: kind, guids: ["synthetic"]).isEmpty) }
        }
    }
    func testInvalidAndBounded() {
        for (kind, ids) in [("write", [String]()), ("voices", Array(repeating: "x", count: 129)), ("voices", ["x\0bad"]), ("voices", [String(repeating: "x", count: 513)])] {
            XCTAssertThrowsError(try MetadataReader.read(database: "unused", kind: kind, guids: ids)) { XCTAssertEqual($0 as? MetadataFailure, .invalid) }
        }
    }
    func testQueryDoesNotMutateAndUsesBindings() throws {
        try fixture("CREATE TABLE message(guid TEXT, item_type INTEGER, group_title TEXT);INSERT INTO message VALUES('synthetic',2,'Group');") { file in
            let before = try Data(contentsOf: URL(fileURLWithPath: file))
            XCTAssertEqual(try MetadataReader.read(database: file, kind: "renames", guids: ["synthetic"]).count, 1)
            XCTAssertTrue(try MetadataReader.read(database: file, kind: "renames", guids: ["x' OR 1=1 --"]).isEmpty)
            XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: file)), before)
        }
    }
    func testStatementBudgetIsTerminal() throws {
        try fixture("CREATE VIEW message AS WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<100000) SELECT CAST(x AS TEXT) AS guid, 2 AS item_type, 'Synthetic' AS group_title FROM n") { file in
            XCTAssertThrowsError(try MetadataReader.read(database: file, kind: "renames", guids: ["absent"])) { XCTAssertEqual($0 as? MetadataFailure, .limit) }
        }
    }
    func testMalformedSchemaIsNotLegacyEmpty() throws {
        try fixture("CREATE TABLE unrelated(value TEXT)") { file in
            XCTAssertThrowsError(try MetadataReader.read(database: file, kind: "voices", guids: ["synthetic"])) { XCTAssertEqual($0 as? MetadataFailure, .schema) }
        }
    }
}
