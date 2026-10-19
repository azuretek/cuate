package com.azuretek.cuate

import android.content.Intent
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Issue 425, on the Android shell: the same load order fixture the iOS UI test and the desktop proof run
// (core/test/load-order-fixture.js) signs the real page in to a stand-in server over an emulated slow link, opens a
// conversation of synthetic photos at its newest message and flings up through it, and measures, in this shell's own
// web view, how long the first message and the first picture on screen take. The measurement is kept beside the run as
// load-order.json, and the test fails when a picture off screen was asked for while one on screen was still waiting, or
// a fetch for a row flung past was still going when the view stopped.
@RunWith(AndroidJUnit4::class)
class LoadOrderTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun webView(group: ViewGroup): WebView? {
        for (i in 0 until group.childCount) {
            val child = group.getChildAt(i)
            if (child is WebView) return child
            if (child is ViewGroup) webView(child)?.let { return it }
        }
        return null
    }

    private fun evaluate(scenario: ActivityScenario<MainActivity>, script: String): String {
        val done = CountDownLatch(1)
        var result = "null"
        scenario.onActivity { activity ->
            val view = webView(activity.findViewById(android.R.id.content))!!
            view.evaluateJavascript(script) { value -> result = value; done.countDown() }
        }
        assertTrue("JavaScript callback timed out", done.await(JS_ANSWER_SECONDS, TimeUnit.SECONDS))
        return result
    }

    @Test
    fun onScreenMediaLoadsBeforeOffScreenMedia() {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val booted = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
            while (evaluate(scenario, "document.querySelector('app-root')?.phase === 'onboarding'") != "true") {
                assertTrue("Empty test app did not boot", System.nanoTime() < booted)
                instrumentation.waitForIdleSync()
            }
            val fixture = instrumentation.context.assets.open("load-order-fixture.js").bufferedReader().use { it.readText() }
            evaluate(scenario, fixture)
            val proof = awaitProof(scenario)
            println("load order fixture: $proof")
            keep("load-order.json", proof.toString(2))

            assertTrue("no picture was on screen to measure: $proof", (proof.optJSONArray("onScreen")?.length() ?: 0) > 0)
            assertEquals("pictures off screen were asked for while one on screen was still waiting: $proof", 0, proof.getInt("offscreenBeforeOnscreen"))
            // Issue 426: an avatar is fetched in the same order, so none is asked for off screen while the screen waits.
            assertEquals("avatars off screen were asked for while something on screen was still waiting: $proof", 0, proof.getInt("avatarEarly"))
            // Issue 427: a start asks for its info, its conversations and its settings together.
            assertTrue("the start read its info, conversations and settings one after another: $proof", proof.optBoolean("startTogether", false))
            assertTrue("the pictures where the fling stopped never all drew: $proof", proof.getJSONObject("fling").optBoolean("allDrawn", false))
            assertEquals("fetches for rows flung past were still going when the view stopped: $proof", 0, proof.getJSONObject("fling").getInt("staleAtStop"))
        }
    }

    private fun awaitProof(scenario: ActivityScenario<MainActivity>): JSONObject {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(180)
        var state = "null"
        do {
            instrumentation.waitForIdleSync()
            state = evaluate(scenario, "window.loadOrderProof ? JSON.stringify(window.loadOrderProof) : null")
            if (state != "null") {
                val proof = JSONObject(JSONObject("{\"s\":$state}").getString("s"))
                if (proof.has("error")) throw AssertionError("the load order fixture failed: " + proof.getString("error") + SystemSurface.failureSuffix())
                return proof
            }
            Thread.sleep(250)
        } while (System.nanoTime() < deadline)
        throw AssertionError("the load order fixture never measured" + SystemSurface.failureSuffix())
    }

    private fun keep(name: String, text: String) {
        // AGP copies this directory before uninstalling the app and its data.
        val outputDir = java.io.File(requireNotNull(
            InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        ) { "The test runner must provide a retained output directory" })
        assertTrue("Cannot create the output directory", outputDir.isDirectory || outputDir.mkdirs())
        java.io.File(outputDir, name).writeText(text)
    }
}
