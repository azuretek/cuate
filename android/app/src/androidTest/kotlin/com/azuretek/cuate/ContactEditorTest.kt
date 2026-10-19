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
import org.junit.Assert.assertEquals
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

    /**
     * One reading of one window: which app it is, how its texts name the person, and the texts themselves so a wait that
     * runs out says what the contacts app was drawing (issue 446).
     */
    private data class Reading(
        val packageName: String?,
        val fullName: Boolean,
        val firstName: Boolean,
        val lastName: Boolean,
        val texts: List<String>,
    ) {
        /**
         * The window names the person: their card says the whole name, and the editor the system opens for someone it
         * could not match holds the first and last names in separate fields. Either is the person, a blank one is not.
         */
        val namesThePerson: Boolean get() = fullName || (firstName && lastName)

        override fun toString(): String =
            "Reading(packageName=$packageName, fullName=$fullName, firstName=$firstName, lastName=$lastName, texts=" +
                texts.take(12) + ")"
    }

    /**
     * Every window, read separately (issue 446). Google Contacts greets a fresh install with "Some menu items have
     * moved" in a window of its own, and while that window is in front the active root holds its notice alone and
     * never the card behind it, so the card's own window is where the person is named.
     */
    private fun readAll(): List<Reading> {
        val automation = instrumentation.uiAutomation
        val readings = mutableListOf<Reading>()
        for (window in automation.windows) {
            val root = window.root ?: continue
            readings += read(root)
        }
        if (readings.isEmpty()) automation.rootInActiveWindow?.let { readings += read(it) }
        return readings
    }

    /** Presses the first-run notice's own close control, wherever the contacts app has drawn it. */
    private fun dismissFirstRunNotice(): Boolean {
        val pending = mutableListOf<AccessibilityNodeInfo>()
        for (window in instrumentation.uiAutomation.windows) window.root?.let { pending += it }
        var label: AccessibilityNodeInfo? = null
        while (pending.isNotEmpty()) {
            val node = pending.removeAt(pending.size - 1)
            val text = (node.text?.toString() ?: node.contentDescription?.toString() ?: "").trim()
            if (text.contains("Close Popup Window", ignoreCase = true)) { label = node; break }
            for (index in 0 until node.childCount) node.getChild(index)?.let { pending += it }
        }
        // No label at all means no notice is drawn, so nothing is pressed and back is never sent to the contacts app.
        val found = label ?: return false
        if (pressNearest(found)) return true
        // The control itself is drawn by the app, not exposed as pressable. Dismissing the node, then one back press,
        // is what a person does with this notice, and it is sent only once a label was actually found (issue 446).
        if (found.performAction(AccessibilityNodeInfo.ACTION_DISMISS)) return true
        return instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
    }

    /**
     * Presses the node carrying the label, or the nearest ancestor that can be pressed. Google Contacts draws the
     * notice's close control as a container with the label as its child, so pressing the label alone does nothing and
     * the notice stays over the card until the wait runs out (issue 446).
     */
    private fun pressNearest(node: AccessibilityNodeInfo): Boolean {
        var candidate: AccessibilityNodeInfo? = node
        var depth = 0
        while (candidate != null && depth < 6) {
            if (candidate.isClickable && candidate.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
            candidate = candidate.parent
            depth++
        }
        return false
    }

    /** Every text and content description under one window's root in one walk, and how they name the seeded person. */
    private fun read(root: AccessibilityNodeInfo): Reading {
        val texts = mutableListOf<String>()
        var fullName = false
        var firstName = false
        var lastName = false
        val pending = mutableListOf(root)
        while (pending.isNotEmpty() && texts.size < TEXT_BUDGET) {
            val node = pending.removeAt(pending.size - 1)
            for (candidate in listOf(node.text?.toString(), node.contentDescription?.toString())) {
                val text = candidate?.trim().orEmpty()
                if (text.isEmpty()) continue
                texts += text
                if (text.contains(PERSON, ignoreCase = true)) fullName = true
                if (text.contains(FIRST_NAME, ignoreCase = true)) firstName = true
                if (text.contains(LAST_NAME, ignoreCase = true)) lastName = true
            }
            for (index in 0 until node.childCount) node.getChild(index)?.let { pending.add(it) }
        }
        return Reading(root.packageName?.toString(), fullName, firstName, lastName, texts)
    }

    /** What the system says is in front, so a wait that runs out says what was on screen rather than only what was not. */
    private fun inFront(): String = runCatching {
        shell("dumpsys activity activities | grep -m1 -E 'mResumedActivity|topResumedActivity'").trim()
    }.getOrDefault("(the system did not say)")

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
            // The contacts app is in front, and it is showing the seeded person. Issue 446: every window the app has
            // drawn is read again and again until one names the person, and the reading the wait ends on is the one
            // judged, never a second look at a view that has drawn on since.
            val automation = instrumentation.uiAutomation
            val front = System.nanoTime() + TimeUnit.SECONDS.toNanos(FRONT_SECONDS)
            var readings = readAll()
            var dismissed = 0
            fun named() = readings.firstOrNull { it.packageName != context.packageName && it.namesThePerson }
            while (named() == null) {
                val left = TimeUnit.NANOSECONDS.toMillis(front - System.nanoTime())
                if (left <= 0) {
                    throw AssertionError("the contacts app never showed the person; the last readings: $readings; in front: " + inFront())
                }
                // The notice sits over the card until its own control is pressed; that is the contacts app's first-run
                // behaviour, not the card, so close it and read again rather than judging the notice.
                if (dismissed < 3 && dismissFirstRunNotice()) dismissed++
                try { automation.waitForIdle(WINDOW_SETTLE_MS, minOf(WINDOW_SETTLE_MS, left)) } catch (busy: java.util.concurrent.TimeoutException) { }
                readings = readAll()
            }
            val shown = named()!!
            assertTrue("a contacts app, not this one, is in front: $readings", shown.packageName != context.packageName)
            val active = automation.rootInActiveWindow?.packageName?.toString()
            assertTrue(
                "the contacts app showing the person is the window in front: $shown; every window: $readings; in front: " + inFront(),
                active == shown.packageName,
            )
            assertEquals("the contacts app names the person: $shown", true, shown.namesThePerson)
        }
    }

    private companion object {
        const val WINDOW_SETTLE_MS = 300L
        const val FRONT_SECONDS = 90L
        const val TEXT_BUDGET = 400
        const val PERSON = "Fixture Person"
        const val FIRST_NAME = "Fixture"
        const val LAST_NAME = "Person"
    }
}
