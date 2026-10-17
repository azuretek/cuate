package com.azuretek.cuate

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.util.Base64
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Issue 432: a recording in a conversation was drawn as a file card, and pressing it left the conversation. The
// fixture (core/test/audio-fixture.js) draws two synthetic recordings in a conversation in this shell's own web view, one
// someone else sent and not played yet, and one we sent. This test presses play through the accessibility tree, as a
// person would, and asserts from the page's report that the recording plays where it is: its time and its elapsed clock
// move, its waveform fills, its mark goes, and pause holds it part way in. A screenshot of each state is kept.
@RunWith(AndroidJUnit4::class)
class AudioPlaybackTest {
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
    fun aRecordingPlaysInItsMessage() {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val booted = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
            while (evaluate(scenario, "document.querySelector('app-root')?.phase === 'onboarding'") != "true") {
                assertTrue("Empty test app did not boot", System.nanoTime() < booted)
                instrumentation.waitForIdleSync()
            }
            // Fixture bytes exist in the test APK only: the recording is handed to the page, which the shell has no route for.
            val clip = instrumentation.context.assets.open("audio-fixture.m4a").use { it.readBytes() }
            evaluate(scenario, "window.fixtureAudioBase64 = " + JSONObject.quote(Base64.encodeToString(clip, Base64.NO_WRAP)) + "; true")
            val fixture = instrumentation.context.assets.open("audio-fixture.js").bufferedReader().use { it.readText() }
            evaluate(scenario, fixture)

            val ready = await(scenario, "au:ready", 60)
            println("audio fixture ready: $ready")
            SystemSurface.requireOurs()
            val before = players(ready)
            assertEquals("the recording someone else sent is marked not played: $ready", true, before.getJSONObject(0).getBoolean("unplayed"))
            assertEquals("it says how long it runs: $ready", "0:04", before.getJSONObject(0).getString("length"))
            assertEquals("ours is never marked: $ready", false, before.getJSONObject(1).getBoolean("unplayed"))
            for (i in 0 until before.length()) assertEquals("the waveform keeps clear of the time: $ready", true, before.getJSONObject(i).getBoolean("clear"))
            keepScreenshot("audio-ready.png")

            press("Play memo.m4a")
            val playing = await(scenario, "au:playing", 30)
            println("audio fixture after play: $playing")
            val first = players(playing).getJSONObject(0)
            assertTrue("its time moved: $playing", first.getDouble("currentTime") >= 1.0)
            assertNotEquals("its elapsed clock moved: $playing", "0:00", first.getString("elapsed"))
            assertTrue("its waveform fills: $playing", first.getInt("filled") > 0)
            assertEquals("its mark is gone once played: $playing", false, first.getBoolean("unplayed"))
            keepScreenshot("audio-playing.png")

            press("Pause memo.m4a")
            val paused = await(scenario, "au:paused", 10)
            println("audio fixture after pause: $paused")
            keepScreenshot("audio-paused.png")
        }
    }

    private fun players(state: String): org.json.JSONArray = JSONObject(state.substringAfter(' ')).getJSONArray("players")

    /** The fixture's marker once it reads as the state wanted, failing on the fixture's own failure or the bound. */
    private fun await(scenario: ActivityScenario<MainActivity>, wanted: String, seconds: Long): String {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        var state = "null"
        do {
            instrumentation.waitForIdleSync()
            val raw = evaluate(scenario, "window.audioFixtureState || null")
            if (raw != "null") {
                state = JSONObject("{\"s\":$raw}").getString("s")
                if (state.startsWith("au:fail")) throw AssertionError("the audio fixture failed: $state")
                if (state.startsWith("$wanted ")) return state
            }
            Thread.sleep(100)
        } while (System.nanoTime() < deadline)
        throw AssertionError("the audio fixture never reached $wanted: $state" + SystemSurface.failureSuffix())
    }

    /** Presses the control the accessibility tree names, as a person's tap on it would. */
    private fun press(label: String) {
        val automation = instrumentation.uiAutomation
        automation.serviceInfo = automation.serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
        }
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        do {
            instrumentation.waitForIdleSync()
            val node = automation.rootInActiveWindow?.let { find(it, label) }
            if (node != null) {
                assertTrue("$label is not visible to the user", node.isVisibleToUser)
                assertTrue("$label did not take the press", node.performAction(AccessibilityNodeInfo.ACTION_CLICK))
                return
            }
            Thread.sleep(250)
        } while (System.nanoTime() < deadline)
        throw AssertionError("$label is not in the accessibility tree" + SystemSurface.failureSuffix())
    }

    private fun find(node: AccessibilityNodeInfo, label: String): AccessibilityNodeInfo? {
        if ((node.contentDescription ?: node.text ?: "").toString().trim() == label) return node
        for (i in 0 until node.childCount) node.getChild(i)?.let { child -> find(child, label)?.let { return it } }
        return null
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
}
