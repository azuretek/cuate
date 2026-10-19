package com.azuretek.cuate

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

// Issue 439: a group renamed showed no line in the conversation, only an empty message. The fixture
// (core/test/group-rename-fixture.js), the one the iOS UI test runs, draws the real conversation and the real chat list in
// this shell's web view for a synthetic group whose history holds the group being named, its name being removed and a
// rename made from this app, and reports a verdict: every rename is a quiet line naming who did it, nothing is an empty
// message, and the list titles the group by its new name with the same words as its preview.
@RunWith(AndroidJUnit4::class)
class GroupRenameTest {
    @Test
    fun aGroupRenamedIsALineNamingWhoDidIt() {
        val intent = Intent(InstrumentationRegistry.getInstrumentation().targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val proof = PageFixture.run(scenario, "group-rename-fixture.js", "groupRenameProof")
            println("group rename proof: $proof")
            PageFixture.keepScreenshot("group-rename.png")
            assertTrue("a rename did not draw as its line: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
        }
    }
}
