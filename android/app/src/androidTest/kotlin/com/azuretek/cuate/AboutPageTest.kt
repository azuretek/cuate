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

// Issue 171: the About page on Android is the same page the desktop draws, opened from Settings' last row, and its
// Check for updates asks this shell's own bridge (updates.check), whose answer arrives as the app notice. The fixture
// (core/test/about-fixture.js) drives the real components; this test injects it, waits for its proof and keeps a
// light and a dark capture of the page with the notice up.
@RunWith(AndroidJUnit4::class)
class AboutPageTest {
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
            result = evaluate(scenario, "window.aboutProof || null")
            if (result != "null") {
                val proof = JSONObject(result)
                if (proof.has("error")) throw AssertionError("About fixture failed: " + proof.getString("error"))
                if (proof.getBoolean("ok")) return proof
            }
        } while (System.nanoTime() < deadline)
        throw AssertionError("The About page never showed its notice: $result")
    }

    // The page as painted, not a frame the WebView drew before it: the top of the app icon's tile, the default theme's
    // accent lightened (core/app/rules/icon.js iconPalette, held to it by core/test/icon.test.js), is on screen, which
    // it only is once the About page has drawn its icon.
    private fun iconShown(capture: android.graphics.Bitmap): Boolean {
        val tile = android.graphics.Color.rgb(0xd6, 0x5a, 0x4e)
        var hits = 0
        for (y in 0 until capture.height step 4) {
            for (x in 0 until capture.width step 4) {
                val p = capture.getPixel(x, y)
                if (Math.abs(android.graphics.Color.red(p) - android.graphics.Color.red(tile)) <= 8
                    && Math.abs(android.graphics.Color.green(p) - android.graphics.Color.green(tile)) <= 8
                    && Math.abs(android.graphics.Color.blue(p) - android.graphics.Color.blue(tile)) <= 8) hits++
            }
        }
        return hits >= 50
    }

    // Two captures in a row that draw the same picture with the icon on it, so a frame still arriving, or one
    // the WebView drew before the page, is never kept.
    private fun settledCapture(): android.graphics.Bitmap {
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
        throw AssertionError("The screen never showed the About page with its icon")
    }

    @Test
    fun lightAbout() = about("light")

    @Test
    fun darkAbout() = about("dark")

    private fun about(scheme: String) {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
            while (evaluate(scenario, "document.querySelector('app-root')?.phase === 'onboarding'") != "true") {
                assertTrue("Empty test app did not boot", System.nanoTime() < deadline)
                instrumentation.waitForIdleSync()
            }
            // Fixture bytes exist in the test APK only. No production intent or bridge bypass.
            val fixture = instrumentation.context.assets.open("about-fixture.js").bufferedReader().use { it.readText() }
            evaluate(scenario, "window.fixtureScheme = '$scheme';")
            evaluate(scenario, fixture)
            val proof = awaitProof(scenario)
            assertTrue("About draws its icon, Check for updates and the build: " + proof, proof.getString("parts") == "identity|updates|build")
            assertTrue("The notice says why this build does not update itself: " + proof, proof.getString("notice").contains("APK"))
            val capture = settledCapture()
            // AGP copies this directory before uninstalling the app and its data.
            val outputDir = java.io.File(requireNotNull(
                InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
            ) { "The test runner must provide a retained output directory" })
            assertTrue("Cannot create capture directory", outputDir.isDirectory || outputDir.mkdirs())
            val output = java.io.File(outputDir, "about-$scheme.png")
            output.outputStream().use {
                assertTrue("Screenshot encoding failed", capture.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
            }
            assertTrue("Screenshot is empty", output.length() > 0)
        }
    }
}
