package com.azuretek.cuate

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

// Issue 437: an edited message could not show what it said before. The fixture (core/test/edit-history-fixture.js), the
// one the iOS UI test runs, draws the real conversation in this shell's web view for a synthetic edited message with
// earlier versions, presses its Edited control and reports a verdict: the versions above the message, oldest first, the
// control reading Hide edits, a live edit adding the words it replaced, a second press folding them away, and the plain
// mark where nothing was kept.
@RunWith(AndroidJUnit4::class)
class EditHistoryTest {
    @Test
    fun editedShowsWhatTheMessageSaidBefore() {
        val intent = Intent(InstrumentationRegistry.getInstrumentation().targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val proof = PageFixture.run(scenario, "edit-history-fixture.js", "editHistoryProof")
            println("edit history proof: $proof")
            PageFixture.keepScreenshot("edit-history.png")
            assertTrue("Edited did not show the earlier versions: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
        }
    }
}
