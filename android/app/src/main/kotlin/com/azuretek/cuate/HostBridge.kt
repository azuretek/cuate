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
    /** Matches the system bars to the scheme the page draws; answers whether it was applied. */
    private val appearance: (dark: Boolean, background: String) -> Boolean = { _, _ -> false },
    /** The build number this APK carries (its versionCode), shown on About and listed beside the version. */
    private val build: Long = 0,
    /** Runs a script in the page, on the UI thread: how a later answer and an event reach it. */
    private val script: (String) -> Unit = {},
) {

    /** Updating in the app (issue 192): download, verify and hand the release's APK to the system installer. */
    val updater = ApkUpdater(context) { state -> emit("update.state", state) }

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
        /** The hook a later answer settles a pending call through, and the one an event reaches its listeners through. */
        const val RESOLVE_HOOK = "__cuateResolve"
        const val EMIT_HOOK = "__cuateEmit"

        /** A call whose answer comes later (a read from the network) answers this now and settles through RESOLVE_HOOK. */
        private val PENDING: JSONObject get() = JSONObject().put("ok", true).put("pending", true)

        val injectedScript: String = """
            (function () {
              if (window.bridge) { return; }
              var pending = {};
              var seq = 0;
              var listeners = {};
              window.$RESOLVE_HOOK = function (payload) {
                var waiting = pending[payload.id];
                if (!waiting) { return; }
                delete pending[payload.id];
                if (payload.ok) { waiting.resolve(payload.value); } else { waiting.reject(new Error(String(payload.value))); }
              };
              window.$EMIT_HOOK = function (name, payload) {
                (listeners[name] || []).slice().forEach(function (handler) { try { handler(payload); } catch (e) {} });
              };
              window.bridge = {
                call: function (name, args) {
                  return new Promise(function (resolve, reject) {
                    var id = String(++seq);
                    var payload = JSON.parse(window.$INTERFACE_NAME.call(String(name), JSON.stringify(args || {}), id));
                    if (payload.pending) { pending[id] = { resolve: resolve, reject: reject }; return; }
                    if (payload.ok) { resolve(payload.value); } else { reject(new Error(String(payload.value))); }
                  });
                },
                on: function (name, handler) {
                  (listeners[name] = listeners[name] || []).push(handler);
                  return function () { listeners[name] = (listeners[name] || []).filter(function (h) { return h !== handler; }); };
                }
              };
            })();
        """.trimIndent()
    }

    /** A call with no way to answer later: what a test calls directly. */
    fun call(name: String, argsJson: String): String = call(name, argsJson, "")

    @JavascriptInterface
    fun call(name: String, argsJson: String, id: String): String {
        val args = try {
            JSONObject(argsJson)
        } catch (e: Exception) {
            JSONObject()
        }
        val result = try {
            dispatch(name, args, id)
        } catch (e: Exception) {
            failure(e.message ?: "bridge failure")
        }
        return result.toString()
    }

    /** An event the page listens for with window.bridge.on, sent from any thread. */
    fun emit(name: String, payload: JSONObject) {
        script("window.$EMIT_HOOK && window.$EMIT_HOOK(" + JSONObject.quote(name) + ", " + payload.toString() + ");")
    }

    private fun settle(id: String, ok: Boolean, value: Any) {
        val payload = JSONObject().put("id", id).put("ok", ok).put("value", value)
        script("window.$RESOLVE_HOOK && window.$RESOLVE_HOOK(" + payload.toString() + ");")
    }

    /**
     * The repository's public release feed (issue 192), read off the bridge's thread so the page never waits on the
     * network, and answered later. The page decides from it with the rule both phones share.
     */
    private fun releases(id: String): JSONObject {
        if (id.isEmpty()) return failure("updates.releases answers later, so it needs a call id")
        Thread {
            try {
                val override = ReleaseTransport.override
                val url = Releases.feedUrl(context.assets) ?: throw IllegalStateException("the release feed's address could not be formed")
                settle(id, true, (override ?: ReleaseTransport.Https).text(url))
            } catch (e: Exception) {
                settle(id, false, "the release list could not be read: " + (e.message ?: e.javaClass.simpleName))
            }
        }.apply { name = "release-feed" }.start()
        return PENDING
    }

    private fun dispatch(name: String, args: JSONObject, id: String): JSONObject {
        if (name !in commands) return failure("undeclared bridge command: " + name)
        return when (name) {
            "storage.get" -> success(store.get(args.optString("key")) ?: JSONObject.NULL)
            "storage.set" -> success(store.set(args.optString("key"), args.optString("value")))
            "storage.delete" -> success(store.delete(args.optString("key")))
            // The client's half of the About page's build report: the version, the channel it follows and the build
            // number this APK carries (issue 192), so About shows neither as Unknown.
            "app.info" -> success(
                JSONObject().put("product", product).put("version", version)
                    .put("channel", Releases.channelOf(version))
                    .put("build", if (build > 0) build.toString() else JSONObject.NULL)
                    .put("updateChannel", if (Releases.channelOf(version) == "dev") "dev" else "latest")
                    .put("platform", "android"),
            )
            "notify" -> success(notify(args))
            "open.external" -> success(openExternal(args))
            // The page runs this phone's check itself from the release feed (issue 192), so the shell has no state of
            // its own to answer; the one bridge spec still declares the command for the desktop's tray check.
            "updates.check" -> success(JSONObject.NULL)
            "updates.releases" -> releases(id)
            // A download is always asked for by the person (the notice's or About's Download), so there is nothing
            // to configure.
            "updates.configure" -> success(false)
            "updates.download" -> success(updater.download(args.optString("version")))
            "updates.install" -> success(updater.install())
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
