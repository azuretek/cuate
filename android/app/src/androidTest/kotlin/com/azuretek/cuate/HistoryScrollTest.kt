package com.azuretek.cuate

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

// Issue 535: scrolling a long conversation waited at each page edge. The fixture (core/test/history-scroll-fixture.js),
// the one the iOS UI test and the desktop history proof run, signs the real page in to a stand-in server in this shell's
// web view and scrolls half a screen at a time up past several evicted pages and back down to the newest message, every
// page landing only once the reader has read another screen, and reports a verdict: every message that came into view
// was already loaded, every page was asked for about a page ahead, nothing on screen moved when a page landed, one page
// at most was on its way each way, and the window never held more than three pages.
@RunWith(AndroidJUnit4::class)
class HistoryScrollTest {
    @Test
    fun historyLoadsAheadBothWays() {
        val intent = Intent(InstrumentationRegistry.getInstrumentation().targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val proof = PageFixture.run(scenario, "history-scroll-fixture.js", "historyScrollProof", 180)
            println("history scroll proof: $proof")
            PageFixture.keepScreenshot("history-scroll.png")
            assertTrue("History did not load ahead both ways: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
        }
    }
}
