package com.azuretek.cuate

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

// Issue 167: the app icon chosen in Settings is applied on Android by enabling its launcher alias alone. The bridge's
// own app.icon is called, and the package manager is read back: the chosen alias is the one launcher entry the app has,
// an id the spec does not name changes nothing, and the default is put back after.
@RunWith(AndroidJUnit4::class)
class AppIconTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun alias(id: String) = MainActivity::class.java.name.substringBeforeLast('.') + ".AppIcon_" + id

    private fun launchers(): List<String> {
        val launch = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(context.packageName)
        return context.packageManager.queryIntentActivities(launch, 0).map { it.activityInfo.name }
    }

    private fun ask(bridge: HostBridge, icon: String): JSONObject {
        val reply = JSONObject(bridge.call("app.icon", JSONObject().put("icon", icon).toString()))
        assertTrue("the bridge answers app.icon: $reply", reply.getBoolean("ok"))
        return reply.getJSONObject("value")
    }

    @Test
    fun choosingAnIconMakesItsAliasTheOneLauncherEntry() {
        val spec = JSONObject(BundledSpec.text(context.assets, "spec/app-icons.json"))
        val fallback = spec.getString("default")
        val families = spec.getJSONArray("families")
        val ids = (0 until families.length()).flatMap { f ->
            val variants = families.getJSONObject(f).getJSONObject("variants")
            listOf("light", "dark").map { variants.getJSONObject(it).getString("id") }
        }
        val other = ids.first { it != fallback }
        val bridge = HostBridge(context, SecureStore(context), HostBridge.commandNames(context.assets), "App", "0")
        try {
            assertEquals("a fresh install launches from the default alone", listOf(alias(fallback)), launchers())
            val applied = ask(bridge, other)
            assertTrue("applied: $applied", applied.getBoolean("applied"))
            assertEquals(listOf(alias(other)), launchers())
            assertEquals(PackageManager.COMPONENT_ENABLED_STATE_ENABLED, context.packageManager.getComponentEnabledSetting(ComponentName(context.packageName, alias(other))))
            val refused = ask(bridge, "nope")
            assertFalse("an id the spec does not name is refused: $refused", refused.getBoolean("applied"))
            assertEquals("a refused id changes nothing", listOf(alias(other)), launchers())
        } finally {
            assertTrue(ask(bridge, fallback).getBoolean("applied"))
            assertEquals(listOf(alias(fallback)), launchers())
        }
    }
}
