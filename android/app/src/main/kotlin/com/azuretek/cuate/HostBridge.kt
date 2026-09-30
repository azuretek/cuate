package com.azuretek.cuate

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
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
            "notify" -> success(notify(args))
            "open.external" -> success(openExternal(args))
            else -> failure("undeclared bridge command: " + name)
        }
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
