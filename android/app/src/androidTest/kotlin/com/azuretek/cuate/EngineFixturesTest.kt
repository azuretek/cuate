package com.azuretek.cuate

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The fixtures every engine answers, run through the embedded engine here.
 *
 * The same cases run against the source modules in Node
 * (core/test/fixtures.test.js) and through JavaScriptCore on iOS, so the engines
 * are held to one answer sheet rather than to three.
 */
@RunWith(AndroidJUnit4::class)
class EngineFixturesTest {

    @Test
    fun theEmbeddedEngineAnswersEveryFixtureCase() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val text = BundledSpec.text(context.assets, "fixtures/engine-cases.json")
        val engine = Engine.open(context)
        assertNotNull("build/engine.js must be copied in and define the engine global", engine)

        engine!!.use { embedded ->
            val harness = """
                (function (text) {
                  var fixtures = JSON.parse(text);
                  return JSON.stringify(fixtures.cases.map(function (c) {
                    try { return { id: c.id, value: JSON.stringify(engine[c.call].apply(null, c.args)) }; }
                    catch (err) { return { id: c.id, error: String(err) }; }
                  }));
                })(${JSONObject.quote(text)})
            """.trimIndent()
            val results = JSONArray(embedded.evaluate(harness))
            val expected = JSONObject(text).getJSONArray("cases")
            assertEquals(expected.length(), results.length())
            for (i in 0 until expected.length()) {
                val want = expected.getJSONObject(i)
                val got = results.getJSONObject(i)
                val id = want.getString("id")
                assertFalse(id + " threw: " + got.optString("error"), got.has("error"))
                assertEquals(id, want.getString("expect"), got.getString("value"))
            }
        }
    }
}
