package com.azuretek.cuate

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The shell's half of the parity the repository holds every client to: the
 * values it reads at runtime are the repository's, and the commands the bridge
 * answers are exactly the ones core/spec/host-bridge.json declares.
 */
@RunWith(AndroidJUnit4::class)
class ShellParityTest {

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun theProductNameComesFromTheRepositorySpec() {
        assertEquals("Cuate", Naming.product(context.assets))
        assertEquals("Cuate Chat", Naming.storeName(context.assets))
    }

    @Test
    fun theApplicationIdIsTheAndroidIdFromTheSpec() {
        assertEquals(Naming.androidId(context.assets), context.packageName)
    }

    @Test
    fun theBridgeAnswersExactlyTheHostBridgeSpec() {
        val declared = setOf(
            "storage.get",
            "storage.set",
            "storage.delete",
            "app.info",
            "notify",
            "open.external",
            "updates.check",
            "updates.configure",
            "updates.download",
            "updates.install",
            "window.minimize",
            "window.toggleMaximize",
            "window.close",
            "window.appearance",
        )
        assertEquals(declared, HostBridge.commandNames(context.assets))
    }

    @Test
    fun theEngineBundleIsBundledAndDefinesItsGlobal() {
        val engine = Engine.open(context)
        assertNotNull("build/engine.js must be copied in and define the engine global", engine)
        engine!!.close()
    }

    @Test
    fun storageRefusesBadKeysAndOversizedValues() {
        val store = SecureStore(context)
        assertFalse(store.set("Bad Key", "x"))
        assertFalse(store.set("ok.key", "x".repeat(9000)))
    }
}
