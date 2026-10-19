package com.azuretek.cuate

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.graphics.Rect
import android.util.Base64
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
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

// Issue 416: in the media viewer a video is drawn with the player's own controls, and the viewer's close control, its
// step controls and its bar floated over them. The fixture (core/test/video-controls-fixture.js) opens the real viewer on
// a synthetic clip, paused so the player's controls show. This test finds every player control (play or pause, the
// scrubber, mute, full screen) and every one of ours (close, previous, next, the bar) in the accessibility tree, keeps a
// screenshot, and asserts each control is on screen and answers a press at its own middle (the page's hit test there
// reaches the player's video for a player control, and the control itself for ours), and that none of ours overlaps a
// player control or another of ours.
@RunWith(AndroidJUnit4::class)
class VideoControlsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private data class Found(val name: String, val bounds: Rect, val visible: Boolean, val label: String)

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

    private fun quoted(text: String): String = JSONObject.quote(text)

    @Test
    fun portraitVideoKeepsEveryControlClear() = check("portrait")

    @Test
    fun landscapeVideoKeepsEveryControlClear() = check("landscape")

    private fun check(shape: String) {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val booted = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
            while (evaluate(scenario, "document.querySelector('app-root')?.phase === 'onboarding'") != "true") {
                assertTrue("Empty test app did not boot", System.nanoTime() < booted)
                instrumentation.waitForIdleSync()
            }
            // Fixture bytes exist in the test APK only: the clip is handed to the page, which the shell has no route for.
            val clip = instrumentation.context.assets.open("video-controls-$shape.mp4").use { it.readBytes() }
            evaluate(scenario, "window.fixtureVideo = " + quoted(shape) + "; window.fixtureVideoBase64 = " + quoted(Base64.encodeToString(clip, Base64.NO_WRAP)) + "; true")
            val fixture = instrumentation.context.assets.open("video-controls-fixture.js").bufferedReader().use { it.readText() }
            evaluate(scenario, fixture)
            val scene = awaitScene(scenario)
            println("video controls scene ($shape): $scene")
            // Issue 443: the poster must not stand in for the clip. The fixture draws the frame the player has after its
            // seek and counts the pixels, and reports the player's own frame count, so a green test proves the clip
            // really decoded behind the poster.
            val decoded = scene.optInt("decoded", 0)
            val frames = scene.optInt("totalFrames", 0)
            println("video controls scene ($shape) decoded pixels=$decoded frames=$frames")
            assertTrue("the video never decoded behind its poster: $decoded painted pixels", decoded > 0)

            val found = awaitControls()
            SystemSurface.requireOurs()
            keepScreenshot("video-controls-$shape.png")

            val problems = mutableListOf<String>()
            val names = PLAYER + OURS
            for (name in names) {
                val control = found[name]
                if (control == null) { problems.add("$name is not in the accessibility tree"); continue }
                println("video controls ($shape) $name '${control.label}' at ${control.bounds.toShortString()}" + if (control.visible) " visible" else " NOT visible")
                if (control.bounds.isEmpty) problems.add("$name has no size")
                if (!control.visible) problems.add("$name is not visible to the user")
                if (name != "bar") {
                    val hit = hitAt(scenario, control.bounds)
                    val expected = if (name in PLAYER) "video" else name
                    if (hit != expected) problems.add("a press on the middle of $name ${control.bounds.toShortString()} reaches $hit, not $expected")
                }
            }
            // The player's whole area is its control area too: a press anywhere on the video shows or hides the player's
            // controls, and the player draws them anywhere inside its box. The page reports the box, in its own pixels.
            val area = videoArea(scenario, scene)
            println("video controls ($shape) video at ${area.toShortString()}")
            // Ours against every player control and the video itself, the bar included; ours against each other. The bar
            // holds controls of its own, so it is not set against what it holds.
            for (mine in OURS) for (theirs in PLAYER + "video") {
                val a = found[mine]?.bounds
                val b = if (theirs == "video") area else found[theirs]?.bounds
                if (a != null && b != null && Rect.intersects(a, b)) problems.add("$mine ${a.toShortString()} overlaps the player's $theirs ${b.toShortString()}")
            }
            val separate = OURS - "bar"
            for ((i, first) in separate.withIndex()) for (second in separate.drop(i + 1)) {
                val a = found[first]?.bounds
                val b = found[second]?.bounds
                if (a != null && b != null && Rect.intersects(a, b)) problems.add("$first overlaps $second")
            }
            if (problems.isNotEmpty()) println("video controls ($shape) accessibility tree:\n" + describeTree())
            assertTrue("the $shape video's controls are not all clear: " + problems.joinToString("; ") + SystemSurface.failureSuffix(), problems.isEmpty())
        }
    }

    private fun awaitScene(scenario: ActivityScenario<MainActivity>): JSONObject {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
        var state = "null"
        do {
            instrumentation.waitForIdleSync()
            state = evaluate(scenario, "window.videoControlsState || null")
            if (state != "null") {
                val text = JSONObject("{\"s\":$state}").getString("s")
                if (text.startsWith("vc:fail")) throw AssertionError("the video controls fixture failed: $text")
                if (text.startsWith("vc:ready ")) return JSONObject(text.removePrefix("vc:ready "))
            }
        } while (System.nanoTime() < deadline)
        throw AssertionError("the video controls fixture never became ready: $state")
    }

    /** Every control named, read from the accessibility tree once all of them are there or the bound passes. */
    private fun awaitControls(): Map<String, Found> {
        val automation = instrumentation.uiAutomation
        automation.serviceInfo = automation.serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
        }
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
        var found: Map<String, Found> = emptyMap()
        do {
            instrumentation.waitForIdleSync()
            found = collect()
            if ((PLAYER + OURS).all { it in found }) return found
            Thread.sleep(250)
        } while (System.nanoTime() < deadline)
        return found
    }

    private fun collect(): Map<String, Found> {
        val root = instrumentation.uiAutomation.rootInActiveWindow ?: return emptyMap()
        val found = mutableMapOf<String, Found>()
        walk(root) { node ->
            val label = (node.contentDescription ?: node.text ?: "").toString().trim()
            val lower = label.lowercase()
            val name = when {
                lower == "play" || lower == "pause" -> "play or pause"
                lower == "mute" || lower == "unmute" -> "mute"
                lower.contains("full screen") || lower.contains("fullscreen") -> "full screen"
                node.className?.toString() == "android.widget.SeekBar" || lower.contains("scrubber") -> "scrubber"
                label == "Close" -> "close"
                label == "Previous item" -> "prev"
                label == "Next item" -> "next"
                label == "Media controls" -> "bar"
                else -> null
            }
            if (name != null && name !in found) {
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                found[name] = Found(name, bounds, node.isVisibleToUser, label)
            }
        }
        return found
    }

    private fun walk(node: AccessibilityNodeInfo, visit: (AccessibilityNodeInfo) -> Unit) {
        visit(node)
        for (i in 0 until node.childCount) node.getChild(i)?.let { walk(it, visit) }
    }

    private fun describeTree(): String {
        val root = instrumentation.uiAutomation.rootInActiveWindow ?: return "(no window)"
        val lines = mutableListOf<String>()
        walk(root) { node ->
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            val label = (node.contentDescription ?: node.text ?: "").toString().take(80)
            if (label.isNotEmpty() || node.isClickable) lines.add(node.className.toString() + " '" + label + "' " + bounds.toShortString())
        }
        return lines.joinToString("\n")
    }

    /** The video's box on the screen, from the page's report in its own pixels, scaled onto the web view. */
    private fun videoArea(scenario: ActivityScenario<MainActivity>, scene: JSONObject): Rect {
        val origin = IntArray(2)
        var width = 0
        scenario.onActivity { activity ->
            val view = webView(activity.findViewById(android.R.id.content))!!
            view.getLocationOnScreen(origin)
            width = view.width
        }
        val video = scene.getJSONObject("video")
        val scale = width.toDouble() / scene.getJSONObject("viewport").getDouble("w")
        fun px(css: Double, from: Int) = (from + css * scale).toInt()
        val x = video.getDouble("x")
        val y = video.getDouble("y")
        return Rect(px(x, origin[0]), px(y, origin[1]), px(x + video.getDouble("w"), origin[0]), px(y + video.getDouble("h"), origin[1]))
    }

    /** What the page's own hit test reaches at the middle of a box on the screen: the player's video, one of ours, or another element. */
    private fun hitAt(scenario: ActivityScenario<MainActivity>, bounds: Rect): String {
        val origin = IntArray(2)
        scenario.onActivity { activity -> webView(activity.findViewById(android.R.id.content))!!.getLocationOnScreen(origin) }
        val script = "(() => { const d = window.devicePixelRatio || 1; const el = document.elementFromPoint((" + bounds.exactCenterX() + " - " + origin[0] + ") / d, (" + bounds.exactCenterY() + " - " + origin[1] + ") / d);" +
            " if (!el) return 'nothing'; if (el.matches('video.viewer-image')) return 'video';" +
            " if (el.closest('.close-button')) return 'close'; if (el.closest('.viewer-prev')) return 'prev'; if (el.closest('.viewer-next')) return 'next';" +
            " if (el.closest('.viewer-bar')) return 'bar'; return el.tagName.toLowerCase() + '.' + String(el.className || ''); })()"
        return JSONObject("{\"s\":" + evaluate(scenario, script) + "}").getString("s")
    }

    private fun keepScreenshot(name: String) {
        instrumentation.waitForIdleSync()
        val capture = requireNotNull(instrumentation.uiAutomation.takeScreenshot()) { "no screenshot" }
        // AGP copies this directory before uninstalling the app and its data.
        val outputDir = java.io.File(requireNotNull(
            InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        ) { "The test runner must provide a retained output directory" })
        assertTrue("Cannot create capture directory", outputDir.isDirectory || outputDir.mkdirs())
        val output = java.io.File(outputDir, name)
        output.outputStream().use {
            assertTrue("Screenshot encoding failed", capture.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
        }
        capture.recycle()
        assertTrue("Screenshot is empty", output.length() > 0)
    }

    private companion object {
        val PLAYER = listOf("play or pause", "scrubber", "mute", "full screen")
        val OURS = listOf("close", "prev", "next", "bar")
    }
}
