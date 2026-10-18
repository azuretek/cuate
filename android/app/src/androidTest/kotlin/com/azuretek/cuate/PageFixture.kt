package com.azuretek.cuate

import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertTrue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The shared seam for a page fixture from core/test (the test APK's assets are that folder): boot the real page in this
 * shell's own web view, run the fixture in it, and read the verdict the fixture leaves on a window global once it is set.
 * The same fixture is the iOS UI test's and the desktop smoke's, so each platform is judged by one script.
 */
object PageFixture {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    private fun webView(group: ViewGroup): WebView? {
        for (i in 0 until group.childCount) {
            val child = group.getChildAt(i)
            if (child is WebView) return child
            if (child is ViewGroup) webView(child)?.let { return it }
        }
        return null
    }

    fun evaluate(scenario: ActivityScenario<MainActivity>, script: String): String {
        val done = CountDownLatch(1)
        var result = "null"
        scenario.onActivity { activity ->
            val view = webView(activity.findViewById(android.R.id.content))!!
            view.evaluateJavascript(script) { value -> result = value; done.countDown() }
        }
        assertTrue("JavaScript callback timed out", done.await(JS_ANSWER_SECONDS, TimeUnit.SECONDS))
        return result
    }

    /** Boots the page to its first screen, runs [asset], and returns the JSON of window.[proof] once the fixture sets it. */
    fun run(scenario: ActivityScenario<MainActivity>, asset: String, proof: String, seconds: Long = 90): JSONObject {
        val booted = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
        while (evaluate(scenario, "document.querySelector('app-root')?.phase === 'onboarding'") != "true") {
            assertTrue("Empty test app did not boot", System.nanoTime() < booted)
            instrumentation.waitForIdleSync()
        }
        val source = instrumentation.context.assets.open(asset).bufferedReader().use { it.readText() }
        evaluate(scenario, source + "\n;true")
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        val read = "(() => { const p = window." + proof + "; return p ? JSON.stringify(p) : null; })()"
        while (System.nanoTime() < deadline) {
            val answer = evaluate(scenario, read)
            if (answer != "null") return JSONObject(JSONObject("{\"s\":$answer}").getString("s"))
            Thread.sleep(250)
        }
        throw AssertionError("the fixture $asset never set window.$proof" + SystemSurface.failureSuffix())
    }

    /** Keeps a screenshot in the retained output directory, which AGP copies before it uninstalls the app. */
    fun keepScreenshot(name: String) {
        instrumentation.waitForIdleSync()
        val capture = requireNotNull(instrumentation.uiAutomation.takeScreenshot()) { "no screenshot" }
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
