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

// Issue 456: a person added to a group, removed, or leaving drew nothing but an empty message. The fixture
// (core/test/group-members-fixture.js), the one the iOS UI test runs, draws the real conversation in this shell's web view
// for a synthetic group whose people changed (Sam added someone Contacts does not know, removed someone it does, someone
// left, and you added a person) and reports a verdict read from what the web view drew. The test then reads the
// accessibility tree a screen reader reads, where each line must be there in words.
@RunWith(AndroidJUnit4::class)
class GroupMembersTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @Test
    fun everyChangeIsALineNamingWhoAndWhom() {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val proof = PageFixture.run(scenario, "group-members-fixture.js", "membersProof")
            println("group members proof: $proof")
            PageFixture.keepScreenshot("group-members.png")
            assertTrue("the changes did not draw as lines: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
            val spoken = awaitSpoken(LINES)
            println("group members spoken: $spoken")
            assertTrue("a screen reader is not given every line; it reads: " + labels().take(40) + SystemSurface.failureSuffix(), spoken.size == LINES.size)
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
        val LINES = listOf(
            "Sam Example added riley@example.com to the conversation",
            "Sam Example removed Jordan Example from the conversation",
            "riley@example.com left the conversation",
            "You added Jordan Example to the conversation",
        )
    }
}
