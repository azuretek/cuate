package com.azuretek.cuate

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

// Issue 533 (Abi, 2026-11-16): React offered the full emoji panel on a conversation that carries only the six classic
// reactions, and refused the pick afterwards; and a reaction that arrived as text could show as a stray message. The
// fixture (core/test/reaction-choices-fixture.js), the one the iOS UI test and the desktop smoke run, draws the real
// conversation in this shell's web view for an SMS, an RCS and two message-service conversations, opens React in each,
// folds every cited phrasing of a reaction that arrived as text, and reports a verdict: SMS and RCS offer exactly the six
// with no search, the message service with an engine that sends any emoji offers the full panel, and every reaction is a
// chip on its message or a labelled line, never a bubble.
@RunWith(AndroidJUnit4::class)
class ReactionChoicesTest {
    @Test
    fun reactOffersWhatTheConversationCarriesAndTextReactionsFold() {
        val intent = Intent(InstrumentationRegistry.getInstrumentation().targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val proof = PageFixture.run(scenario, "reaction-choices-fixture.js", "reactionChoicesProof")
            println("reaction choices proof: $proof")
            PageFixture.keepScreenshot("reaction-choices.png")
            assertTrue("React offered what the conversation cannot carry, or a reaction showed as a message: $proof" + SystemSurface.failureSuffix(), proof.optBoolean("ok"))
        }
    }
}
