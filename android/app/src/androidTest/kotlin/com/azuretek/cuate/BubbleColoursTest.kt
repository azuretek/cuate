package com.azuretek.cuate

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

// Issue 459: the other person's bubble wears the theme's accent and ours is the quiet tint. The fixture
// (core/test/bubble-colours-fixture.js), the one the iOS UI test runs, draws the real conversation in this shell's web view
// for synthetic messages from both sides, in the default palette and a synthetic imported theme, light and dark, and
// reports a verdict: the received bubble is the accent bubble, ours is not, each keeps its text at 4.5:1, and the
// received one stands out from the page more than ours. A capture is kept in light and in dark.
@RunWith(AndroidJUnit4::class)
class BubbleColoursTest {
    @Test
    fun receivedBubbleWearsTheAccent() {
        val intent = Intent(InstrumentationRegistry.getInstrumentation().targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val proof = PageFixture.run(scenario, "bubble-colours-fixture.js", "bubbleColoursProof")
            println("bubble colours proof: $proof")
            PageFixture.keepScreenshot("bubble-colours-light.png")
            assertTrue("the bubbles are not the right colours: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
            PageFixture.evaluate(scenario, "document.querySelector('[data-bubbles-dark]').click(); true")
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
            while (PageFixture.evaluate(scenario, "window.bubbleColoursProof.dark === true") != "true") {
                assertTrue("the dark capture did not draw" + SystemSurface.failureSuffix(), System.nanoTime() < deadline)
                InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            }
            PageFixture.keepScreenshot("bubble-colours-dark.png")
        }
    }
}
