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

    private fun awaitProof(scenario: ActivityScenario<MainActivity>, landscape: Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        var result = "null"
        do {
            instrumentation.waitForIdleSync()
            result = evaluate(scenario, "window.rotationProof || null")
            if (result != "null") {
                val proof = JSONObject(result)
                if (proof.has("error")) throw AssertionError("Rotation fixture failed: " + proof.getString("error"))
                if (proof.getBoolean("ok") && (proof.getInt("width") > proof.getInt("height")) == landscape) return
            }
        } while (System.nanoTime() < deadline)
        throw AssertionError("Rotation retention failed: $result")
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
            awaitProof(scenario, false)
            val capture = instrumentation.uiAutomation.takeScreenshot()
            // AGP copies this directory before uninstalling the app and its data.
            val outputDir = java.io.File(requireNotNull(
                InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
            ) { "The test runner must provide a retained output directory" })
            assertTrue("Cannot create capture directory", outputDir.isDirectory || outputDir.mkdirs())
            val output = java.io.File(outputDir, "chat-$scheme.png")
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
