package com.azuretek.cuate

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

// Issue 447: bold, italic, underlined and struck-through words drew as plain words. The fixture
// (core/test/text-format-fixture.js), the one the iOS UI test runs, draws the real conversation in this shell's web view
// for synthetic messages carrying each style, several on one stretch, one around a link and one beside a text effect,
// and reports a verdict read from what the web view computed for each stretch.
@RunWith(AndroidJUnit4::class)
class TextFormatTest {
    @Test
    fun everyStyleDrawsOnItsStretch() {
        val intent = Intent(InstrumentationRegistry.getInstrumentation().targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val proof = PageFixture.run(scenario, "text-format-fixture.js", "textFormatProof")
            println("text formatting proof: $proof")
            PageFixture.keepScreenshot("text-format.png")
            assertTrue("the styles did not draw: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
        }
    }
}
