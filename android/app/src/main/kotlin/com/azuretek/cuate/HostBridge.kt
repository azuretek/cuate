package com.azuretek.cuate

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * The shell's half of core/spec/host-bridge.json.
 *
 * Every command a page may call lives in that spec and the shell refuses
 * anything else, so a platform difference is data in the spec rather than a
 * branch in core. The page reaches this through window.bridge.call, which the
 * injected script below installs over the JavaScript interface; a reply is one
 * JSON object, so a value that is nil, a string, a bool or an object travels the
 * same way and the page's resolver has one shape to read.
 */
class HostBridge(
    private val context: Context,
    private val store: SecureStore,
    private val commands: Set<String>,
    private val product: String,
    private val version: String,
    /** Matches the system bars to the scheme the page draws; answers whether it was applied. */
    private val appearance: (dark: Boolean, background: String) -> Boolean = { _, _ -> false },
) {

    companion object {
        const val INTERFACE_NAME = "cuateNative"

        /** Storage keys are lower-case words joined by dots, the same shape the desktop enforces. */
        private const val CHANNEL_ID = "cuate.default"
        private const val REQUEST_NOTIFICATIONS = 6601

        /** The command names the bundled spec declares. */
        fun commandNames(assets: android.content.res.AssetManager): Set<String> = try {
            val spec = JSONObject(BundledSpec.text(assets, "spec/host-bridge.json"))
            spec.optJSONObject("commands")?.keys()?.asSequence()?.toSet() ?: emptySet()
        } catch (e: Exception) {
            emptySet()
        }

        /**
         * The document-start script that installs window.bridge over the
         * JavaScript interface. Installed before the page boots, because the
         * page may call window.bridge during its own first render.
         */
        val injectedScript: String = """
            (function () {
              if (window.bridge) { return; }
              window.bridge = {
                call: function (name, args) {
                  return new Promise(function (resolve, reject) {
                    var payload = JSON.parse(window.$INTERFACE_NAME.call(String(name), JSON.stringify(args || {})));
                    if (payload.ok) { resolve(payload.value); } else { reject(new Error(String(payload.value))); }
                  });
                }
              };
            })();
        """.trimIndent()
    }

    @JavascriptInterface
    fun call(name: String, argsJson: String): String {
        val args = try {
            JSONObject(argsJson)
        } catch (e: Exception) {
            JSONObject()
        }
        val result = try {
            dispatch(name, args)
        } catch (e: Exception) {
            failure(e.message ?: "bridge failure")
        }
        return result.toString()
    }

    private fun dispatch(name: String, args: JSONObject): JSONObject {
        if (name !in commands) return failure("undeclared bridge command: " + name)
        return when (name) {
            "storage.get" -> success(store.get(args.optString("key")) ?: JSONObject.NULL)
            "storage.set" -> success(store.set(args.optString("key"), args.optString("value")))
            "storage.delete" -> success(store.delete(args.optString("key")))
            "app.info" -> success(
                JSONObject().put("product", product).put("version", version).put("platform", "android"),
            )
            "app.icon" -> success(appIcon(args.optString("icon")))
            "notify" -> success(notify(args))
            "open.external" -> success(openExternal(args))
            // About's Check for updates (issue 171). A build reaches this phone as a newer APK, so there is no check to
            // run: the answer says this build does not update itself, and the page gives the reason from
            // core/app/rules/updates.js, so the words for each platform live in one place.
            "updates.check" -> success(JSONObject().put("state", "unsupported").put("canInstall", false))
            // No self-updater on Android, so there is nothing to configure, download or install; each answers false
            // and the page offers no action. The one bridge spec still declares them for the desktop.
            "updates.configure" -> success(false)
            "updates.download" -> success(false)
            "updates.install" -> success(false)
            // A phone has no window to minimise, maximise or close, so the window commands answer false and the bar is
            // never drawn; the one bridge spec still declares them for the desktop.
            "window.minimize" -> success(false)
            "window.toggleMaximize" -> success(false)
            "window.close" -> success(false)
            // The status and navigation bars draw over the page's colours, so their icons follow the page's scheme.
            "window.appearance" -> success(appearance(args.optString("scheme") == "dark", args.optString("background")))
            else -> failure("undeclared bridge command: " + name)
        }
    }

    /**
     * The app icon chosen in Settings (issue 167). Every icon spec/app-icons.json names is a launcher alias of the one
     * activity, .AppIcon_<id>, and only the default is enabled in the manifest. Choosing one enables its alias first and
     * then disables the others, so the app always has a launcher entry, and the launcher draws the enabled alias's
     * icon. DONT_KILL_APP and the activity itself staying enabled mean the change never closes the app; a launcher may
     * take a moment to redraw. An id the spec does not name is refused and nothing changes.
     */
    private fun appIcon(icon: String): JSONObject {
        val answer = JSONObject().put("icon", icon)
        val spec = JSONObject(BundledSpec.text(context.assets, "spec/app-icons.json"))
        val icons = spec.getJSONArray("icons")
        val ids = (0 until icons.length()).map { icons.getJSONObject(it).getString("id") }
        if (icon !in ids) return answer.put("applied", false)
        val fallback = spec.getString("default")
        val pm = context.packageManager
        fun alias(id: String) = ComponentName(context.packageName, MainActivity::class.java.name.substringBeforeLast('.') + ".AppIcon_" + id)
        fun enabled(id: String) = when (pm.getComponentEnabledSetting(alias(id))) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> id == fallback
            else -> false
        }
        if (!enabled(icon)) {
            pm.setComponentEnabledSetting(alias(icon), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
        }
        for (other in ids) {
            if (other != icon && enabled(other)) {
                pm.setComponentEnabledSetting(alias(other), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
            }
        }
        return answer.put("applied", true)
    }

    private fun notify(args: JSONObject): Boolean {
        val title = args.optString("title").take(200)
        val body = args.optString("body").take(500)
        if (title.isEmpty()) return false
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return false
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, product, NotificationManager.IMPORTANCE_DEFAULT),
        )
        // Authorization is asked for on the first notification rather than at
        // launch, so a fresh install is not greeted by a permission dialog
        // before it has drawn anything.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            if (!granted) {
                (context as? Activity)?.requestPermissions(
                    arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                    REQUEST_NOTIFICATIONS,
                )
                return true
            }
        }
        val notification = android.app.Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .build()
        manager.notify(title.hashCode(), notification)
        return true
    }

    private fun openExternal(args: JSONObject): Boolean {
        val text = args.optString("url")
        val uri = Uri.parse(text)
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return false
        return try {
            context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun success(value: Any): JSONObject = JSONObject().put("ok", true).put("value", value)

    private fun failure(value: Any): JSONObject = JSONObject().put("ok", false).put("value", value)
}
