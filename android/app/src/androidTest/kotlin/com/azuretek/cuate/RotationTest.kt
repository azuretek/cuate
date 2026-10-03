package com.azuretek.cuate

import android.content.Intent
import android.content.pm.ActivityInfo
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

@RunWith(AndroidJUnit4::class)
class RotationTest {
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

    private fun awaitProof(scenario: ActivityScenario<MainActivity>, landscape: Boolean): JSONObject {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        var result = "null"
        do {
            instrumentation.waitForIdleSync()
            result = evaluate(scenario, "window.rotationProof || null")
            if (result != "null") {
                val proof = JSONObject(result)
                if (proof.has("error")) throw AssertionError("Rotation fixture failed: " + proof.getString("error"))
                if (proof.getBoolean("ok") && (proof.getInt("width") > proof.getInt("height")) == landscape) return proof
            }
        } while (System.nanoTime() < deadline)
        throw AssertionError("Rotation retention failed: $result")
    }

    // Where the verdict's fill lands in a capture: the web view's place on the screen plus the marker's CSS box, scaled
    // by the web view's pixels per CSS pixel. The point is inside the marker's left padding, clear of its text.
    private fun markerPoint(scenario: ActivityScenario<MainActivity>, proof: JSONObject): Pair<Int, Int> {
        val origin = IntArray(2)
        var widthPx = 0
        scenario.onActivity { activity ->
            val view = webView(activity.findViewById(android.R.id.content))!!
            view.getLocationOnScreen(origin)
            widthPx = view.width
        }
        val scale = widthPx.toDouble() / proof.getInt("width")
        val box = proof.getJSONObject("marker")
        val x = origin[0] + ((box.getDouble("left") + 3) * scale).toInt()
        val y = origin[1] + ((box.getDouble("top") + box.getDouble("height") / 2) * scale).toInt()
        return x to y
    }

    // The fixture fills its verdict green for pass and red for fail, so the capture itself says which it caught.
    private fun verdictShown(capture: android.graphics.Bitmap, point: Pair<Int, Int>): String {
        val (x, y) = point
        if (x !in 0 until capture.width || y !in 0 until capture.height) return "off-screen at $x,$y"
        val pixel = capture.getPixel(x, y)
        val r = android.graphics.Color.red(pixel)
        val g = android.graphics.Color.green(pixel)
        val b = android.graphics.Color.blue(pixel)
        return when {
            g > r + 60 && g > b + 30 -> "pass"
            r > g + 60 && r > b + 60 -> "fail"
            else -> "unknown rgb($r,$g,$b) at $x,$y"
        }
    }

    // The capture is kept only if the verdict read pass when it was asked for, still reads pass, did not fail on any
    // frame in between, and the captured pixels show the pass fill. A run can then never keep a fail label.
    private fun assertVerdictHeld(scenario: ActivityScenario<MainActivity>, before: JSONObject, capture: android.graphics.Bitmap, scheme: String) {
        val after = JSONObject(evaluate(scenario, "window.rotationProof || null"))
        val shown = verdictShown(capture, markerPoint(scenario, after))
        val held = after.optString("label") == "portrait:pass" && after.getBoolean("ok")
            && after.getInt("lastFail") < before.getInt("seq")
        if (!held || shown != "pass") {
            keep(capture, "chat-$scheme-refused.png")
            throw AssertionError(
                "The $scheme capture did not keep a passing verdict: page says " + after.optString("label") +
                    " (failing " + after.optJSONArray("failing") + ", last fail at sample " + after.optInt("lastFail") +
                    ", passed at sample " + before.optInt("seq") + "), capture shows " + shown +
                    ", history " + after.optJSONArray("history"),
            )
        }
    }

    // The DOM can report the proof before the compositor presents that frame, and a
    // starting window or a system dialog can cover it. Keep capturing until the pixels
    // themselves show a populated conversation in the requested scheme, and two captures
    // in a row are identical, so a frame still drawing the previous proof label is never kept.
    private fun schemeShown(capture: android.graphics.Bitmap, scheme: String): Boolean {
        val top = capture.height / 10
        val bottom = capture.height * 85 / 100
        var total = 0L
        var count = 0
        var darkest = 255
        var brightest = 0
        for (y in top until bottom step 8) {
            for (x in 0 until capture.width step 8) {
                val pixel = capture.getPixel(x, y)
                val luma = (299 * android.graphics.Color.red(pixel) + 587 * android.graphics.Color.green(pixel)
                    + 114 * android.graphics.Color.blue(pixel)) / 1000
                total += luma
                count++
                if (luma < darkest) darkest = luma
                if (luma > brightest) brightest = luma
            }
        }
        if (count == 0 || brightest - darkest < 96) return false
        val mean = total / count
        return if (scheme == "dark") mean < 80 else mean > 160
    }

    private fun captureScheme(scenario: ActivityScenario<MainActivity>, scheme: String): android.graphics.Bitmap {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        var previous: android.graphics.Bitmap? = null
        var taken = 0
        var shown = 0
        do {
            instrumentation.waitForIdleSync()
            val capture = instrumentation.uiAutomation.takeScreenshot()
            if (capture != null) taken++
            if (capture != null && schemeShown(capture, scheme)) {
                shown++
                val last = previous
                if (last != null && last.sameAs(capture)) { last.recycle(); return capture }
                last?.recycle()
                previous = capture
            } else {
                capture?.let { keep(it, "chat-$scheme-unsettled.png") }
                capture?.recycle()
            }
        } while (System.nanoTime() < deadline)
        previous?.let { keep(it, "chat-$scheme-unsettled.png") }
        previous?.recycle()
        throw AssertionError(
            "The screen never showed the populated $scheme conversation: $taken captures, $shown in the scheme, " +
                "none twice alike; page " + evaluate(scenario, "JSON.stringify(window.rotationProof || null)"),
        )
    }

    private fun outputDir(): java.io.File {
        val dir = java.io.File(requireNotNull(
            InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        ) { "The test runner must provide a retained output directory" })
        assertTrue("Cannot create capture directory", dir.isDirectory || dir.mkdirs())
        return dir
    }

    // A capture the test refused is kept beside the passing ones, so a failure shows what the screen drew.
    private fun keep(capture: android.graphics.Bitmap, name: String) {
        java.io.File(outputDir(), name).outputStream().use { capture.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test
    fun lightConversation() = conversation("light")

    @Test
    fun darkConversation() = conversation("dark")

    private fun conversation(scheme: String) {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
            while (evaluate(scenario, "document.querySelector('app-root')?.phase === 'onboarding'") != "true") {
                assertTrue("Empty test app did not boot", System.nanoTime() < deadline)
                instrumentation.waitForIdleSync()
            }
            // Fixture bytes exist in the test APK only. No production intent or bridge bypass.
            val fixture = instrumentation.context.assets.open("rotation-fixture.js").bufferedReader().use { it.readText() }
            scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
            evaluate(scenario, "window.fixtureScheme = '$scheme';")
            evaluate(scenario, fixture)
            val passed = awaitProof(scenario, false)
            val capture = captureScheme(scenario, scheme)
            assertVerdictHeld(scenario, passed, capture, scheme)
            // AGP copies this directory before uninstalling the app and its data.
            val output = java.io.File(outputDir(), "chat-$scheme.png")
            output.outputStream().use {
                assertTrue("Screenshot encoding failed", capture.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
            }
            assertTrue("Screenshot is empty", output.length() > 0)
            scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
            awaitProof(scenario, true)
            scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
            awaitProof(scenario, false)
        }
    }
}
