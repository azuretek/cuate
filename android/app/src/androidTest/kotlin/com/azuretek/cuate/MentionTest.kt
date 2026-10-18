package com.azuretek.cuate

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

// Issue 453: a mention in a group read as plain words. The fixture (core/test/mention-fixture.js), the one the iOS UI
// test runs, draws the real conversation in this shell's web view for a synthetic group whose messages carry mentions,
// of a member Contacts knows, of someone it does not, inside bold words and two side by side, and reports a verdict read
// from what the web view computed and the name each mention is titled with.
@RunWith(AndroidJUnit4::class)
class MentionTest {
    @Test
    fun everyMentionIsSetApartAndNamesItsPerson() {
        val intent = Intent(InstrumentationRegistry.getInstrumentation().targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val proof = PageFixture.run(scenario, "mention-fixture.js", "mentionProof")
            println("mention proof: $proof")
            PageFixture.keepScreenshot("mention.png")
            assertTrue("the mentions did not draw: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
        }
    }
}
