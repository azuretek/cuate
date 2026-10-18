package com.azuretek.cuate

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

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
            val proof = PageFixture.run(scenario, "mention-fixture.js", "mentionProof")
            println("mention proof: $proof")
            PageFixture.keepScreenshot("mention.png")
            assertTrue("the mentions did not draw: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
            val spoken = awaitSpoken(listOf(KNOWN, UNKNOWN))
            println("mention spoken: $spoken")
            assertTrue("a screen reader is not told who each mention names; it reads: " + labels().take(40) + SystemSurface.failureSuffix(), spoken.size == 2)
        }
    }

    /** The labels among [wanted] the accessibility tree carries, read once all are there or the bound passes. */
    private fun awaitSpoken(wanted: List<String>): Set<String> {
        val automation = instrumentation.uiAutomation
        automation.serviceInfo = automation.serviceInfo.apply { flags = flags or AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS }
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
        var found: Set<String> = emptySet()
        do {
            instrumentation.waitForIdleSync()
            found = wanted.filter { want -> labels().any { it.contains(want) } }.toSet()
            if (found.size == wanted.size) return found
            Thread.sleep(250)
        } while (System.nanoTime() < deadline)
        return found
    }

    private fun labels(): List<String> {
        val root = instrumentation.uiAutomation.rootInActiveWindow ?: return emptyList()
        val out = mutableListOf<String>()
        walk(root) { node -> listOfNotNull(node.contentDescription, node.text).map { it.toString().trim() }.filter { it.isNotEmpty() }.forEach { out.add(it) } }
        return out
    }

    private fun walk(node: AccessibilityNodeInfo, visit: (AccessibilityNodeInfo) -> Unit) {
        visit(node)
        for (i in 0 until node.childCount) node.getChild(i)?.let { walk(it, visit) }
    }

    private companion object {
        const val KNOWN = "Sam, mention of Sam Example"
        const val UNKNOWN = "Riley, mention of riley@example.com"
    }
}
