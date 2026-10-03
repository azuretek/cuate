package com.azuretek.cuate

import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Build
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
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
import kotlin.math.abs

/**
 * The status bar and the navigation bar wear the app's own surface (issue 175). A populated conversation is drawn in
 * one scheme, then the other at runtime, and each capture is held to it by its pixels: the strip under each bar is the
 * colour of the surface beside it and of the surface the page says it painted there, the bar icons contrast with it
 * (dark on light, light on dark), and the page's header and composer keep their content clear of the bars.
 */
@RunWith(AndroidJUnit4::class)
class SystemBarsTest {
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

    /** The status bar's and the navigation bar's heights in device pixels, from the window's own insets. */
    @Suppress("DEPRECATION")
    private fun bars(scenario: ActivityScenario<MainActivity>): Pair<Int, Int> {
        var top = 0
        var bottom = 0
        scenario.onActivity { activity ->
            val insets = activity.window.decorView.rootWindowInsets
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val b = insets.getInsets(WindowInsets.Type.systemBars())
                top = b.top
                bottom = b.bottom
            } else {
                top = insets.stableInsetTop
                bottom = insets.stableInsetBottom
            }
        }
        return Pair(top, bottom)
    }

    private fun awaitProof(scenario: ActivityScenario<MainActivity>, scheme: String): JSONObject {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        var result = "null"
        do {
            instrumentation.waitForIdleSync()
            result = evaluate(scenario, "JSON.stringify(window.systemBarsProof || null)")
            if (result != "null" && result != "\"null\"") {
                val proof = JSONObject(JSONObject("{\"v\":$result}").getString("v"))
                if (proof.has("error")) throw AssertionError("System bars fixture failed: " + proof.getString("error"))
                if (proof.optString("scheme") == scheme) return proof
            }
        } while (System.nanoTime() < deadline)
        throw AssertionError("The page never drew the $scheme conversation: $result")
    }

    private fun luma(pixel: Int) = (299 * Color.red(pixel) + 587 * Color.green(pixel) + 114 * Color.blue(pixel)) / 1000

    /** The most common colour in a band of rows, sampled every other pixel. */
    private fun dominant(capture: Bitmap, from: Int, to: Int): Int {
        val counts = HashMap<Int, Int>()
        for (y in from.coerceAtLeast(0) until to.coerceAtMost(capture.height) step 2) {
            for (x in 0 until capture.width step 2) {
                val p = capture.getPixel(x, y) or 0xFF000000.toInt()
                counts[p] = (counts[p] ?: 0) + 1
            }
        }
        return counts.maxByOrNull { it.value }?.key ?: 0
    }

    private fun near(a: Int, b: Int, tolerance: Int) =
        abs(Color.red(a) - Color.red(b)) <= tolerance && abs(Color.green(a) - Color.green(b)) <= tolerance &&
            abs(Color.blue(a) - Color.blue(b)) <= tolerance

    private fun hex(c: Int) = String.format("#%06x", c and 0xFFFFFF)

    private fun contrast(capture: Bitmap, from: Int, to: Int, surface: Int, scheme: String, what: String): String? {
        val base = luma(surface)
        var count = 0
        var sum = 0L
        for (y in from.coerceAtLeast(0) until to.coerceAtMost(capture.height)) {
            for (x in 0 until capture.width) {
                val l = luma(capture.getPixel(x, y))
                if (abs(l - base) >= 64) { count++; sum += l }
            }
        }
        if (count < 20) return "the $what do not stand out from the strip ($count pixels)"
        val mean = sum / count
        if (scheme == "light" && mean >= base) return "the $what (luma $mean) are not darker than the light strip (luma $base)"
        if (scheme == "dark" && mean <= base) return "the $what (luma $mean) are not lighter than the dark strip (luma $base)"
        return null
    }

    /** Every way the capture breaks the contract, empty when it holds. */
    private fun problems(capture: Bitmap, proof: JSONObject, statusBar: Int, navBar: Int, scheme: String): List<String> {
        val out = ArrayList<String>()
        val dpr = proof.getDouble("dpr")
        val painted = proof.optJSONArray("top")
        val expectedTop = if (painted == null) null else Color.rgb(painted.getInt(0), painted.getInt(1), painted.getInt(2))
        val band = (4 * dpr).toInt().coerceAtLeast(2)

        val top = dominant(capture, 0, statusBar)
        val belowTop = dominant(capture, statusBar + band, statusBar + 2 * band)
        if (!near(top, belowTop, 3)) out.add("the status bar strip is ${hex(top)}, the surface below it ${hex(belowTop)}")
        if (expectedTop != null && !near(top, expectedTop, 6)) out.add("the status bar strip is ${hex(top)}, the page painted ${hex(expectedTop)}")

        val h = capture.height
        val bottom = dominant(capture, h - navBar, h)
        val aboveBottom = dominant(capture, h - navBar - 2 * band, h - navBar - band)
        if (!near(bottom, aboveBottom, 3)) out.add("the navigation bar strip is ${hex(bottom)}, the surface above it ${hex(aboveBottom)}")

        // The icons, and the gesture handle or the navigation buttons: the pixels in each strip that stand well off its
        // surface must lie on the scheme's side, dark on light and light on dark.
        contrast(capture, 0, statusBar, top, scheme, "status bar icons")?.let { out.add(it) }
        contrast(capture, h - navBar, h, bottom, scheme, "navigation bar handle")?.let { out.add(it) }

        // The content keeps clear of the bars, and the edge surfaces reach the edges.
        val headContentTop = proof.getDouble("headContentTop") * dpr
        if (headContentTop + 1 < statusBar) out.add("the header's content starts at ${headContentTop.toInt()}px, under the ${statusBar}px status bar")
        val composerGap = proof.getDouble("composerContentGap") * dpr
        if (composerGap + 1 < navBar) out.add("the composer's content ends ${composerGap.toInt()}px from the bottom, under the ${navBar}px navigation bar")
        if (proof.getDouble("headTop") > 0.5) out.add("the header starts ${proof.getDouble("headTop")}px below the top edge")
        if (proof.getDouble("composerBottom") > 0.5) out.add("the composer ends ${proof.getDouble("composerBottom")}px above the bottom edge")
        return out
    }

    /**
     * Captures until two in a row match and the contract holds, so a frame still drawing the previous scheme or
     * waiting for the bar icons is never judged; past the deadline the last capture is kept and its problems fail.
     */
    private fun captureHolding(scenario: ActivityScenario<MainActivity>, scheme: String, name: String) {
        val proof = awaitProof(scenario, scheme)
        val (statusBar, navBar) = bars(scenario)
        assertTrue("the emulator reports a status bar", statusBar > 0)
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        var previous: Bitmap? = null
        var last: List<String> = listOf("no capture")
        var kept: Bitmap? = null
        do {
            instrumentation.waitForIdleSync()
            val capture = instrumentation.uiAutomation.takeScreenshot() ?: continue
            last = problems(capture, awaitProof(scenario, scheme), statusBar, navBar, scheme)
            val settled = previous?.sameAs(capture) == true
            previous?.recycle()
            previous = capture
            if (settled && last.isEmpty()) { kept = capture; break }
        } while (System.nanoTime() < deadline)
        previous?.let { save(it, name) }
        assertTrue("The $scheme system bars do not wear the surface ($name, proof $proof): " + last.joinToString("; "), kept != null)
    }

    private fun save(capture: Bitmap, name: String) {
        // AGP copies this directory before uninstalling the app and its data.
        val outputDir = java.io.File(requireNotNull(
            InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        ) { "The test runner must provide a retained output directory" })
        assertTrue("Cannot create capture directory", outputDir.isDirectory || outputDir.mkdirs())
        java.io.File(outputDir, "$name.png").outputStream().use {
            assertTrue("Screenshot encoding failed", capture.compress(Bitmap.CompressFormat.PNG, 100, it))
        }
    }

/** Taps the page at a point given in CSS pixels, as a finger would, so the platform raises its own keyboard. */
    private fun tap(scenario: ActivityScenario<MainActivity>, x: Double, y: Double, dpr: Double) {
        val at = IntArray(2)
        scenario.onActivity { webView(it.findViewById(android.R.id.content))!!.getLocationOnScreen(at) }
        val sx = (at[0] + x * dpr).toFloat()
        val sy = (at[1] + y * dpr).toFloat()
        val now = SystemClock.uptimeMillis()
        for ((action, time) in listOf(MotionEvent.ACTION_DOWN to now, MotionEvent.ACTION_UP to now + 60)) {
            val event = MotionEvent.obtain(now, time, action, sx, sy, 0)
            event.source = InputDevice.SOURCE_TOUCHSCREEN
            assertTrue("the tap was not delivered", instrumentation.uiAutomation.injectInputEvent(event, true))
            event.recycle()
        }
    }

    /** The keyboard's top edge on the screen in device pixels, or null while no keyboard is up. */
    private fun keyboardTop(scenario: ActivityScenario<MainActivity>): Int? {
        var top: Int? = null
        scenario.onActivity { activity ->
            val insets = activity.window.decorView.rootWindowInsets
            if (insets?.isVisible(WindowInsets.Type.ime()) == true) {
                top = activity.window.decorView.height - insets.getInsets(WindowInsets.Type.ime()).bottom
            }
        }
        return top
    }

    /** Where the web view's top edge is on the screen, in device pixels. */
    private fun webTop(scenario: ActivityScenario<MainActivity>): Int {
        val at = IntArray(2)
        scenario.onActivity { webView(it.findViewById(android.R.id.content))!!.getLocationOnScreen(at) }
        return at[1]
    }

    /**
     * With the keyboard up on the conversation's composer or on a field in Settings, nothing slides: the page has not
     * scrolled, the header is still at the top (or the settings sheet still clear of the status bar), and the field is
     * in sight between the status bar and the keyboard (issue 180).
     */
    private fun keyboardHolds(scenario: ActivityScenario<MainActivity>, scheme: String, kind: String, dpr: Double, statusBar: Int) {
        if (kind == "settings") evaluate(scenario, "window.systemBarsOpenSettings(); true")
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        var spot = "null"
        while (spot == "null" && System.nanoTime() < deadline) {
            instrumentation.waitForIdleSync()
            spot = evaluate(scenario, "JSON.stringify(window.systemBarsField && document.querySelector('app-root') && (window.systemBarsKeysProof().kind === '$kind') ? window.systemBarsField() : null)")
            if (spot == "\"null\"") spot = "null"
        }
        assertTrue("no $kind field to tap", spot != "null")
        val at = JSONObject(JSONObject("{\"v\":$spot}").getString("v"))
        tap(scenario, at.getDouble("x"), at.getDouble("y"), dpr)
        val top = statusBar / dpr
        var last = listOf("no proof")
        var shot: Bitmap? = null
        do {
            instrumentation.waitForIdleSync()
            val raw = evaluate(scenario, "JSON.stringify(window.systemBarsKeysProof())")
            val p = JSONObject(JSONObject("{\"v\":$raw}").getString("v"))
            val out = ArrayList<String>()
            val keyboard = keyboardTop(scenario)
            if (keyboard == null) out.add("the soft keyboard is not up")
            // On the screen, not only in the page's own idea of its height: the field must end above the keyboard.
            val fieldBottomOnScreen = webTop(scenario) + p.getDouble("fieldBottom") * dpr
            if (keyboard != null && fieldBottomOnScreen > keyboard + 1) out.add("the field ends at ${fieldBottomOnScreen.toInt()}px, under the keyboard at ${keyboard}px")
            if (!p.getBoolean("focused")) out.add("the $kind field does not have focus")
            if (p.getDouble("scrollY") != 0.0 || p.getDouble("doc") != 0.0) out.add("the page scrolled to ${p.getDouble("scrollY")}")
            if (p.getDouble("viewportTop") > 0.5) out.add("the view slid up by ${p.getDouble("viewportTop")}")
            if (kind == "conversation" && abs(p.getDouble("surfaceTop")) > 0.5) out.add("the header moved to ${p.getDouble("surfaceTop")}")
            if (kind == "settings" && p.getDouble("surfaceTop") + 0.5 < top) out.add("the settings sheet starts at ${p.getDouble("surfaceTop")}, under the $top status bar")
            if (p.getDouble("fieldTop") + 0.5 < top || p.getDouble("fieldBottom") > p.getDouble("viewportHeight") + 0.5) {
                out.add("the field (${p.getDouble("fieldTop")} to ${p.getDouble("fieldBottom")}) is not in sight between $top and ${p.getDouble("viewportHeight")}")
            }
            last = out
            shot?.recycle()
            shot = instrumentation.uiAutomation.takeScreenshot()
            if (out.isEmpty()) break
        } while (System.nanoTime() < deadline)
        shot?.let { save(it, "keys-$kind-$scheme") }
        assertTrue("With the keyboard up on $kind ($scheme): " + last.joinToString("; "), last.isEmpty())
        scenario.onActivity { activity ->
            val view = webView(activity.findViewById(android.R.id.content))!!
            (activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                .hideSoftInputFromWindow(view.windowToken, 0)
        }
        evaluate(scenario, "document.activeElement && document.activeElement.blur(); true")
    }

    @Test
    fun lightThenDarkAtRuntime() = run("light", "dark")

    @Test
    fun darkThenLightAtRuntime() = run("dark", "light")

    private fun run(first: String, then: String) {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
            while (evaluate(scenario, "document.querySelector('app-root')?.phase === 'onboarding'") != "true") {
                assertTrue("Empty test app did not boot", System.nanoTime() < deadline)
                instrumentation.waitForIdleSync()
            }
            // Fixture bytes exist in the test APK only. No production intent or bridge bypass.
            val fixture = instrumentation.context.assets.open("system-bars-fixture.js").bufferedReader().use { it.readText() }
            evaluate(scenario, "window.fixtureScheme = '$first';")
            evaluate(scenario, fixture)
            captureHolding(scenario, first, "bars-$first")
            evaluate(scenario, "window.systemBarsSwitch('$then'); true")
            captureHolding(scenario, then, "bars-$first-then-$then")
            val dpr = awaitProof(scenario, then).getDouble("dpr")
            val statusBar = bars(scenario).first
            keyboardHolds(scenario, then, "conversation", dpr, statusBar)
            keyboardHolds(scenario, then, "settings", dpr, statusBar)
        }
    }
}
