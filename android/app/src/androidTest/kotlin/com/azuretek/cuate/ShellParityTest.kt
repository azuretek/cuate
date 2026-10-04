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
            "app.icon",
            "notify",
            "open.external",
            "updates.check",
            "updates.releases",
            "updates.configure",
            "updates.download",
            "updates.install",
            "window.minimize",
            "window.toggleMaximize",
            "window.close",
            "window.appearance",
            "icon.redraw",
        )
        assertEquals(declared, HostBridge.commandNames(context.assets))
    }

    // Issue 192: About shows this build's channel and build number rather than Unknown.
    @Test
    fun appInfoReportsTheChannelAndTheBuildNumber() {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val bridge = HostBridge(context, SecureStore(context), HostBridge.commandNames(context.assets), "App", "0.0.1-dev.98.7699911abc", build = 98)
        val answer = org.json.JSONObject(bridge.call("app.info", "{}")).getJSONObject("value")
        assertEquals("dev", answer.getString("channel"))
        assertEquals("98", answer.getString("build"))
        assertEquals("dev", answer.getString("updateChannel"))
        assertNotNull(info.versionName)
    }

    @Test
    fun theReleaseFeedAnswersLaterAndADownloadOfANonReleaseIsRefused() {
        val bridge = HostBridge(context, SecureStore(context), HostBridge.commandNames(context.assets), "App", "0.0.1")
        val pending = org.json.JSONObject(bridge.call("updates.releases", "{}", "7"))
        assertEquals(true, pending.optBoolean("pending"))
        val refused = org.json.JSONObject(bridge.call("updates.download", "{\"version\":\"../../etc\"}"))
        assertEquals(false, refused.getBoolean("value"))
        assertEquals("nothing is downloaded yet, so there is nothing to install", false, org.json.JSONObject(bridge.call("updates.install", "{}")).getBoolean("value"))
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
