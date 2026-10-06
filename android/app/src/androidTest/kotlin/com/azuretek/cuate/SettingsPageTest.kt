package com.azuretek.cuate

import android.content.Intent
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Issue 167: Settings on Android is a page that fills the screen, with one tab per section and every setting the
// desktop offers reached from one; issue 168: its way back to the chats list is the chats icon with its label. The
// fixture (core/test/settings-fixture.js) drives the real components and walks every tab; this test injects it, waits for
// its proof and keeps a light and a dark capture of the page.
@RunWith(AndroidJUnit4::class)
class SettingsPageTest {
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
        assertTrue("JavaScript callback timed out", done.await(5, TimeUnit.SECONDS))
        return result
    }

    private fun awaitProof(scenario: ActivityScenario<MainActivity>): JSONObject {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
        var result = "null"
        do {
            instrumentation.waitForIdleSync()
            result = evaluate(scenario, "window.settingsProof || null")
            if (result != "null") {
                val proof = JSONObject(result)
                if (proof.has("error")) throw AssertionError("Settings fixture failed: " + proof.getString("error"))
                if (proof.getBoolean("ok")) return proof
            }
        } while (System.nanoTime() < deadline)
        throw AssertionError("The Settings page never passed its walk: $result")
    }

    // The page as painted, not a frame the WebView drew before it: the first light fixed palette's accent
    // (core/spec/app-icons.json), the middle of that choice's tile, is on screen, which it only is once Settings has
    // drawn its app icon choices. The tile is a gradient, so the band in that colour is narrow: every pixel is read.
    private fun iconShown(capture: android.graphics.Bitmap): Boolean {
        val families = JSONObject(BundledSpec.text(instrumentation.targetContext.assets, "spec/app-icons.json")).getJSONArray("families")
        val variants = (0 until families.length()).flatMap { f ->
            val v = families.getJSONObject(f).getJSONObject("variants")
            listOf("light", "dark").map { v.getJSONObject(it) }
        }
        val accent = variants.first { it.optString("scheme") == "light" && it.has("colors") }
            .getJSONObject("colors").getString("accent")
        val tile = android.graphics.Color.parseColor(accent)
        val pixels = IntArray(capture.width * capture.height)
        capture.getPixels(pixels, 0, capture.width, 0, 0, capture.width, capture.height)
        val hits = pixels.count { p ->
            Math.abs(android.graphics.Color.red(p) - android.graphics.Color.red(tile)) <= 8
                && Math.abs(android.graphics.Color.green(p) - android.graphics.Color.green(tile)) <= 8
                && Math.abs(android.graphics.Color.blue(p) - android.graphics.Color.blue(tile)) <= 8
        }
        return hits >= 50
    }

    // Two captures in a row that draw the same picture with the icon on it, so a frame still arriving, or one
    // the WebView drew before the page, is never kept.
    private fun settledCapture(): android.graphics.Bitmap {
        SystemSurface.requireOurs()
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        var previous: android.graphics.Bitmap? = null
        do {
            instrumentation.waitForIdleSync()
            val capture = instrumentation.uiAutomation.takeScreenshot()
            if (capture != null && !iconShown(capture)) {
                capture.recycle()
            } else if (capture != null) {
                val last = previous
                if (last != null && last.sameAs(capture)) { last.recycle(); return capture }
                last?.recycle()
                previous = capture
            }
        } while (System.nanoTime() < deadline)
        throw AssertionError("The screen never showed Settings with its app icon choices" + SystemSurface.failureSuffix())
    }

    @Test
    fun lightSettings() = settings("light")

    @Test
    fun darkSettings() = settings("dark")

    private fun settings(scheme: String) {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
            while (evaluate(scenario, "document.querySelector('app-root')?.phase === 'onboarding'") != "true") {
                assertTrue("Empty test app did not boot", System.nanoTime() < deadline)
                instrumentation.waitForIdleSync()
            }
            // Fixture bytes exist in the test APK only. No production intent or bridge bypass.
            val fixture = instrumentation.context.assets.open("settings-fixture.js").bufferedReader().use { it.readText() }
            evaluate(scenario, "window.fixtureScheme = '$scheme';")
            evaluate(scenario, fixture)
            val proof = awaitProof(scenario)
            assertTrue("The way back to the chats list is the chats icon: " + proof, proof.getString("back") == "Back to chats" && proof.getString("icon") == "messages-square")
            assertTrue("Every tab was walked: " + proof, proof.getString("walked").startsWith("appearance:") && proof.getString("walked").contains("behavior:") && proof.getString("walked").contains("device:"))
            val capture = settledCapture()
            // AGP copies this directory before uninstalling the app and its data.
            val outputDir = java.io.File(requireNotNull(
                InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
            ) { "The test runner must provide a retained output directory" })
            assertTrue("Cannot create capture directory", outputDir.isDirectory || outputDir.mkdirs())
            val output = java.io.File(outputDir, "settings-$scheme.png")
            output.outputStream().use {
                assertTrue("Screenshot encoding failed", capture.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
            }
            assertTrue("Screenshot is empty", output.length() > 0)
        }
    }
}
