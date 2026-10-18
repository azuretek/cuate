package com.azuretek.cuate

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
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
@RunWith(AndroidJUnit4::class)
class MentionTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @Test
    fun everyMentionIsSetApartAndNamesItsPerson() {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            // Issue 485: the fixture gives its verdict only once the conversation is on screen, so the tree the service
            // connects for below is built over a screen that has the mentions, never over the connect page.
            val proof = PageFixture.run(scenario, "mention-fixture.js", "mentionProof")
            println("mention proof: $proof")
            PageFixture.keepScreenshot("mention.png")
            assertTrue("the mentions did not draw: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
            val reading = awaitSpoken(listOf(KNOWN, UNKNOWN))
            println("mention spoken: " + reading.found + "; the last reading: " + reading.labels.take(40))
            assertTrue(
                "a screen reader is not told who each mention names; the last reading: " + reading.labels.take(40) +
                    " (in front: " + reading.packageName + ")" + SystemSurface.failureSuffix(),
                reading.found.size == 2,
            )
        }
    }

    /** One reading of the window in front: which app it is, every label it carries, and which of [wanted] it holds. */
    private data class Reading(val packageName: String?, val labels: List<String>, val found: Set<String>)

    /**
     * The labels among [wanted] the accessibility tree carries, read again and again until all are there or the bound
     * passes (issue 485). The wait ends on the reading it judges, taken after the accessibility service has settled,
     * never a second look at a view that has drawn on since. A wait that runs out reports the last reading.
     */
    private fun awaitSpoken(wanted: List<String>): Reading {
        val automation = instrumentation.uiAutomation
        automation.serviceInfo = automation.serviceInfo.apply { flags = flags or AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS }
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(SPOKEN_SECONDS)
        var reading = read(wanted)
        while (reading.found.size < wanted.size) {
            val left = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime())
            if (left <= 0) break
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

    private fun read(wanted: List<String>): Reading {
        val root = instrumentation.uiAutomation.rootInActiveWindow
            ?: return Reading(null, emptyList(), emptySet())
        val labels = mutableListOf<String>()
        val pending = mutableListOf(root)
        while (pending.isNotEmpty() && labels.size < LABEL_BUDGET) {
            val node = pending.removeAt(pending.size - 1)
            listOfNotNull(node.text, node.contentDescription).map { it.toString().trim() }.filter { it.isNotEmpty() }.forEach { labels.add(it) }
            for (i in 0 until node.childCount) node.getChild(i)?.let { pending.add(it) }
        }
        return Reading(root.packageName?.toString(), labels, wanted.filter { want -> labels.any { it.contains(want) } }.toSet())
    }

    private companion object {
        const val KNOWN = "Sam, mention of Sam Example"
        const val UNKNOWN = "Riley, mention of riley@example.com"
        const val SPOKEN_SECONDS = 90L
        const val TREE_SETTLE_MS = 300L
        const val LABEL_BUDGET = 400
    }
}
