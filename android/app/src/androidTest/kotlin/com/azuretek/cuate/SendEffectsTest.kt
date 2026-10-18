package com.azuretek.cuate

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

// Issue 442: a message sent with a bubble or screen effect arrived as an ordinary message. The fixture
// (core/test/send-effects-fixture.js), the one the iOS UI test runs, draws the real conversation in this shell's web view,
// hands it a synthetic message sent with each of the thirteen effects as it would arrive, and reports a verdict: every
// bubble effect on its bubble, every screen effect over the conversation, Invisible Ink veiled until pressed, and a line
// under each naming it with a Replay control.
@RunWith(AndroidJUnit4::class)
class SendEffectsTest {
    @Test
    fun everyEffectPlaysWhereItBelongsAndIsNamed() {
        val intent = Intent(InstrumentationRegistry.getInstrumentation().targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val proof = PageFixture.run(scenario, "send-effects-fixture.js", "sendEffectsProof", 120)
            println("send effects proof: $proof")
            PageFixture.keepScreenshot("send-effects.png")
            assertTrue("the send effects did not play: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
        }
    }
}
