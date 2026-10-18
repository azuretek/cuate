package com.azuretek.cuate

import android.os.ParcelFileDescriptor
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Issue 393: Edit contact on Android opens the system's contacts app on the person the conversation is with. The test
// writes a synthetic person into the emulator's Contacts store through the shell (the app itself holds no contacts
// permission and needs none), injects core/test/contacts-fixture.js, which draws the real conversation header from
// this shell's app.info and presses Edit contact, then holds the contacts app to being in front with that person.
@RunWith(AndroidJUnit4::class)
class ContactEditorTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val phone = "+15555550123"
    private var rawId: String? = null

    private fun shell(command: String): String {
        val pfd = instrumentation.uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(pfd).bufferedReader().use { it.readText() }
    }

    @Before
    fun seedThePerson() {
        shell("content insert --uri content://com.android.contacts/raw_contacts --bind account_type:n: --bind account_name:n:")
        val rows = shell("content query --uri content://com.android.contacts/raw_contacts --projection _id")
        rawId = Regex("_id=(\\d+)").findAll(rows).map { it.groupValues[1].toLong() }.maxOrNull()?.toString()
        val id = rawId ?: throw AssertionError("the synthetic person was not written: $rows")
        shell("content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:$id --bind mimetype:s:vnd.android.cursor.item/name --bind data2:s:Fixture --bind data3:s:Person")
        shell("content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:$id --bind mimetype:s:vnd.android.cursor.item/phone_v2 --bind data1:s:$phone --bind data2:i:2")
    }

    @After
    fun removeThePerson() {
        rawId?.let { shell("content delete --uri content://com.android.contacts/raw_contacts --where _id=$it") }
    }

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

    private fun named(node: AccessibilityNodeInfo?, text: String): Boolean = node != null && node.findAccessibilityNodeInfosByText(text).isNotEmpty()

    @Test
    fun editContactOpensTheContactsApp() {
        val context = instrumentation.targetContext
        val fixture = instrumentation.context.assets.open("contacts-fixture.js").bufferedReader().use { it.readText() }
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val ready = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
            while (evaluate(scenario, "Boolean(customElements.get('app-conversation') && window.bridge)") != "true") {
                if (System.nanoTime() > ready) throw AssertionError("the page never loaded")
                instrumentation.waitForIdleSync()
            }
            evaluate(scenario, fixture)
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
            var proof: JSONObject? = null
            while (System.nanoTime() < deadline && proof == null) {
                val raw = evaluate(scenario, "window.contactsProof ? JSON.stringify(window.contactsProof) : null")
                if (raw != "null") proof = JSONObject(JSONObject("{\"v\":$raw}").getString("v"))
                else instrumentation.waitForIdleSync()
            }
            val got = proof ?: throw AssertionError("the contacts fixture never answered")
            if (got.has("error")) throw AssertionError("contacts fixture failed: " + got.getString("error"))
            assertTrue("the control is drawn: $got", got.getBoolean("drawn"))
            assertTrue("the bridge opened the contacts app: $got", got.optBoolean("answer"))
            // The contacts app is in front, and it is showing the seeded person. Both are judged on ONE reading of the
            // window in front: the contacts app keeps drawing as it opens, so a second look at a node already read can
            // find it changed (issue 446). Between readings the test waits for the next accessibility event, a change.
            val automation = instrumentation.uiAutomation
            val front = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
            var shown: String? = null
            try {
                while (System.nanoTime() < front && shown == null) {
                    val changed = CountDownLatch(1)
                    automation.setOnAccessibilityEventListener { changed.countDown() }
                    val window = automation.rootInActiveWindow
                    if (window != null && window.packageName != context.packageName && named(window, "Fixture Person")) shown = window.packageName.toString()
                    else changed.await(2, TimeUnit.SECONDS)
                }
            } finally {
                automation.setOnAccessibilityEventListener(null)
            }
            val app = shown ?: throw AssertionError("the contacts app never showed the person; in front: " + automation.rootInActiveWindow?.packageName)
            assertNotEquals("a contacts app, not this one, is in front", context.packageName, app)
        }
    }
}
