package com.azuretek.cuate

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

// Issue 453: a mention in a group read as plain words. The fixture (core/test/mention-fixture.js), the one the iOS UI
// test runs, draws the real conversation in this shell's web view for a synthetic group whose messages carry mentions,
// of a member Contacts knows, of someone it does not, inside bold words, over an effect, inside a link and two side by
// side, and reports a verdict read from what the web view computed and the name each mention is given. The test then
// reads the accessibility tree a screen reader reads, where each mention must name its person.
//
// Issue 485 and issue 446: the emulator's accessibility read is a state of its own, not a window on the page. The
// service is connected before the fixture draws, so the tree is built while the conversation is added rather than
// from a snapshot taken before it existed, and every window the automation can see is read because the active root
// intermittently comes back without the web view's virtual children. If the mentions are still absent after the first
// stretch, the web view is asked to rebuild its tree once, so a stale snapshot cannot fail a green app.
@RunWith(AndroidJUnit4::class)
class MentionTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @Test
    fun everyMentionIsSetApartAndNamesItsPerson() {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            // The service connects over the boot page before the fixture appends the conversation, so the web view's
            // tree sees the conversation as an addition and reports it, the order issue 446 found deterministic.
            val automation = instrumentation.uiAutomation
            automation.serviceInfo = automation.serviceInfo.apply {
                flags = flags or AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
                    AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
            }
            read(listOf(KNOWN, UNKNOWN))
            val proof = PageFixture.run(scenario, "mention-fixture.js", "mentionProof")
            println("mention proof: $proof")
            PageFixture.keepScreenshot("mention.png")
            assertTrue("the mentions did not draw: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
            val reading = awaitSpoken(scenario, listOf(KNOWN, UNKNOWN))
            println("mention spoken: " + reading.found + "; the last reading: " + reading.labels.take(40))
            assertTrue(
                "a screen reader is not told who each mention names; the last reading: " + reading.labels.take(40) +
                    " (in front: " + reading.packageName + ")" + SystemSurface.failureSuffix(),
                reading.found.size == 2,
            )
        }
    }

    /** One reading of every window the automation can see: which app is in front, every label, and which of [wanted] it holds. */
    private data class Reading(val packageName: String?, val labels: List<String>, val found: Set<String>)

    /**
     * The labels among [wanted] the accessibility tree carries, read again and again until all are there or the bound
     * passes (issue 485). The wait ends on the reading it judges, taken after the accessibility service has settled,
     * never a second look at a view that has drawn on since. A wait that runs out reports the last reading. Once the
     * first stretch passes without the labels, the web view is asked to rebuild its tree and the wait continues.
     */
    private fun awaitSpoken(scenario: ActivityScenario<MainActivity>, wanted: List<String>): Reading {
        val automation = instrumentation.uiAutomation
        val started = System.nanoTime()
        val deadline = started + TimeUnit.SECONDS.toNanos(SPOKEN_SECONDS)
        val rebuildAt = started + TimeUnit.SECONDS.toNanos(REBUILD_AFTER_SECONDS)
        var rebuilt = false
        var reading = read(wanted)
        while (reading.found.size < wanted.size) {
            val now = System.nanoTime()
            val left = TimeUnit.NANOSECONDS.toMillis(deadline - now)
            if (left <= 0) break
            if (!rebuilt && now >= rebuildAt) {
                rebuilt = true
                rebuildTree(scenario)
                instrumentation.waitForIdleSync()
                reading = read(wanted)
                continue
            }
            try {
                automation.waitForIdle(minOf(TREE_SETTLE_MS, left), left)
            } catch (timeout: TimeoutException) {
                // The service was busy for the whole slice; take the next reading rather than waiting longer.
            }
            instrumentation.waitForIdleSync()
            reading = read(wanted)
        }
        return reading
    }

    /**
     * Asks the web view to rebuild the tree behind its accessibility node. Toggling importance throws away the node
     * the automation had been handed and the next read asks the renderer for the page as it is now, which is what a
     * stale snapshot (a conversation added while the service was off) is missing.
     */
    private fun rebuildTree(scenario: ActivityScenario<MainActivity>) {
        scenario.onActivity { activity ->
            findWebView(activity.findViewById(android.R.id.content))?.let { view ->
                view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
                view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
                view.sendAccessibilityEvent(android.view.accessibility.AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED)
                view.invalidate()
            }
        }
    }

    private fun findWebView(group: android.view.ViewGroup): android.webkit.WebView? {
        for (i in 0 until group.childCount) {
            val child = group.getChildAt(i)
            if (child is android.webkit.WebView) return child
            if (child is android.view.ViewGroup) findWebView(child)?.let { return it }
        }
        return null
    }

    /**
     * Every root the automation can see, not only the active one: under the emulator the active root intermittently
     * comes back without the web view's virtual children while the app window is still there (issue 443).
     */
    private fun roots(): List<AccessibilityNodeInfo> {
        val roots = mutableListOf<AccessibilityNodeInfo>()
        val automation = instrumentation.uiAutomation
        automation.rootInActiveWindow?.let { roots.add(it) }
        try {
            for (window in automation.windows) {
                val root = window.root ?: continue
                if (roots.none { it.windowId == root.windowId }) roots.add(root)
            }
        } catch (_: Exception) {
            // The automation can drop between windows; the active root is still collected above.
        }
        return roots
    }

    private fun read(wanted: List<String>): Reading {
        val roots = roots()
        val labels = mutableListOf<String>()
        for (root in roots) {
            val pending = mutableListOf(root)
            while (pending.isNotEmpty() && labels.size < LABEL_BUDGET) {
                val node = pending.removeAt(pending.size - 1)
                listOfNotNull(node.text, node.contentDescription).map { it.toString().trim() }.filter { it.isNotEmpty() }.forEach { labels.add(it) }
                for (i in 0 until node.childCount) node.getChild(i)?.let { pending.add(it) }
            }
        }
        return Reading(roots.firstOrNull()?.packageName?.toString(), labels, wanted.filter { want -> labels.any { it.contains(want) } }.toSet())
    }

    private companion object {
        const val KNOWN = "Sam, mention of Sam Example"
        const val UNKNOWN = "Riley, mention of riley@example.com"
        const val SPOKEN_SECONDS = 90L
        const val REBUILD_AFTER_SECONDS = 15L
        const val TREE_SETTLE_MS = 300L
        const val LABEL_BUDGET = 400
    }
}
