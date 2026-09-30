import XCTest
import JavaScriptCore
@testable import Cuate

/// The fixtures every engine answers, run through JavaScriptCore here.
///
/// The same cases run against the source modules in Node
/// (core/test/fixtures.test.js) and through the embedded engine on Android, so
/// the engines are held to one answer sheet rather than to three. The file is
/// shared, not copied: project.yml carries core/fixtures into the bundle.
final class EngineFixturesTests: XCTestCase {
    func testTheEngineAnswersEveryFixtureCase() throws {
        let data = try BundledSpec.data(at: "fixtures/engine-cases.json")
        let text = String(decoding: data, as: UTF8.self)

        guard let context = Engine.makeContext() else {
            return XCTFail("build/engine.js must be copied in and define the engine global")
        }
        let parsed = context.objectForKeyedSubscript("JSON")?.invokeMethod("parse", withArguments: [text])
        context.setObject(parsed, forKeyedSubscript: "__fixtures" as NSString)

        let script = """
        JSON.stringify(__fixtures.cases.map(function (c) {
          try { return { id: c.id, value: JSON.stringify(engine[c.call].apply(null, c.args)) }; }
          catch (err) { return { id: c.id, error: String(err) }; }
        }))
        """
        guard let resultsJSON = context.evaluateScript(script)?.toString(),
              let resultsData = resultsJSON.data(using: .utf8),
              let results = try JSONSerialization.jsonObject(with: resultsData) as? [[String: Any]] else {
            return XCTFail("the engine did not answer the fixtures")
        }

        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let expected = root?["cases"] as? [[String: Any]] ?? []
        XCTAssertFalse(expected.isEmpty, "the fixture file holds no cases")
        XCTAssertEqual(results.count, expected.count)

        for (got, want) in zip(results, expected) {
            let id = want["id"] as? String ?? "?"
            if let error = got["error"] as? String {
                XCTFail("\(id) threw: \(error)")
                continue
            }
            XCTAssertEqual(got["value"] as? String, want["expect"] as? String, id)
        }
    }
}
