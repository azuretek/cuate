package com.azuretek.cuate

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

// Issue 433: a text effect a sender chose in Messages drew as plain words. The fixture (core/test/text-effects-fixture.js),
// the one the iOS UI test runs, draws the real conversation in this shell's web view for synthetic messages carrying each
// of the eight effects, samples them while they play, and reports a verdict: every effect over its own stretch, playing,
// the Big stretch growing past its settled size, and every one settled back to the words as sent.
@RunWith(AndroidJUnit4::class)
class TextEffectsTest {
    @Test
    fun everyTextEffectPlaysOverItsStretch() {
        val intent = Intent(InstrumentationRegistry.getInstrumentation().targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val proof = PageFixture.run(scenario, "text-effects-fixture.js", "textEffectsProof")
            println("text effects proof: $proof")
            PageFixture.keepScreenshot("text-effects.png")
            assertTrue("the text effects did not play: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
        }
    }
}
