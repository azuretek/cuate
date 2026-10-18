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

// Issue 441: the device's message store, measured in the shell's own web view. The fixture
// (core/test/message-cache-fixture.js) signs the real page in to a stand-in server over an emulated slow link and says
// what a launch cost: the bytes the server sent and the time from sign-in to the first message drawn in the conversation
// it opens. Four launches of the activity over the same web view storage: without the store (a web view with no
// IndexedDB, the page as it was before the store) and with it, each cold (an empty store) and warm (the store the cold
// launch left). The measurements are printed for the pull request.
@RunWith(AndroidJUnit4::class)
class MessageCacheTest {
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

    private fun launch(mode: String, run: String): JSONObject {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val booted = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
            while (evaluate(scenario, "document.querySelector('app-root')?.phase === 'onboarding'") != "true") {
                assertTrue("Empty test app did not boot", System.nanoTime() < booted)
                instrumentation.waitForIdleSync()
            }
            evaluate(scenario, "window.fixtureCacheMode = " + JSONObject.quote(mode) + "; window.fixtureCacheRun = " + JSONObject.quote(run) + "; true")
            val fixture = instrumentation.context.assets.open("message-cache-fixture.js").bufferedReader().use { it.readText() }
            evaluate(scenario, fixture)
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(120)
            var state = "null"
            do {
                Thread.sleep(250)
                state = evaluate(scenario, "window.messageCacheState || null")
                if (state != "null") {
                    val text = JSONObject("{\"s\":$state}").getString("s")
                    if (text.startsWith("cache:fail")) throw AssertionError("the message cache fixture failed ($mode $run): $text")
                    if (text.startsWith("cache:result ")) {
                        val json = text.removePrefix("cache:result ")
                        println("MESSAGE CACHE $json")
                        return JSONObject(json)
                    }
                }
            } while (System.nanoTime() < deadline)
            throw AssertionError("the message cache fixture never answered ($mode $run): $state")
        }
    }

    @Test
    fun warmLaunchDrawsFromTheStoreAndAsksOnlyForWhatChanged() {
        val offCold = launch("off", "cold")
        val offWarm = launch("off", "warm")
        val onCold = launch("on", "cold")
        val onWarm = launch("on", "warm")
        assertEquals("with IndexedDB refused the page opens no store", false, offCold.getBoolean("store") || offWarm.getBoolean("store"))
        assertTrue("the Android web view keeps the store", onCold.getBoolean("store") && onWarm.getBoolean("store"))
        assertEquals("a warm open reads no page of a conversation the store holds", 0, onWarm.getInt("pageReads"))
        assertEquals("nor any picture a tile drew before", 0, onWarm.getInt("pictureReads"))
        assertTrue("without the store a conversation's photo and backdrop are read on every launch: $offWarm", offWarm.getInt("photoReads") > 0)
        assertEquals("and with it on none", 0, onWarm.getInt("photoReads"))
        assertTrue("and its scheme is drawn in a fraction of the time: $onWarm against $offWarm", onWarm.getLong("themedMs") < offWarm.getLong("themedMs") / 2)
        assertTrue("and still draws an edit made while it was closed", onWarm.getBoolean("shownEdit"))
        assertTrue("a warm open costs a fraction of the bytes it did: $onWarm against $offWarm", onWarm.getLong("bytes") < offWarm.getLong("bytes") / 4)
        assertTrue("and draws its first message in a fraction of the time: $onWarm against $offWarm", onWarm.getLong("firstVisibleMs") < offWarm.getLong("firstVisibleMs") / 2)
    }
}
