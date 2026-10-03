package com.azuretek.cuate

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.webkit.WebViewAssetLoader

/**
 * The app's one screen: core's page, hosted in a WebView, under a cover until
 * the page has painted.
 *
 * The shell supplies a web view, secure storage, notifications and one host
 * bridge, and nothing else. Every screen and rule is in core/, which the build
 * copies into the APK's assets.
 */
class MainActivity : Activity() {

    companion object {
        /** The asset loader's own origin, so no network is involved in loading the page. */
        const val ASSET_ROOT = "/assets/"
        const val START_URL = "https://appassets.androidplatform.net" + ASSET_ROOT + "app/index.html"
        /** The request code for the system file picker the composer's attach menu opens. */
        const val PICK_FILE = 41
    }

    private lateinit var webView: WebView
    private lateinit var root: FrameLayout
    private lateinit var cover: LinearLayout
    private lateinit var coverMessage: TextView
    private var pickCallback: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val product = Naming.product(assets).ifEmpty { "Cuate" }
        val bridge = HostBridge(this, SecureStore(this), HostBridge.commandNames(assets), product, versionName()) { dark, background ->
            runOnUiThread { appearance(dark, background) }
            true
        }
        Diagnostics.remember(this)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            addJavascriptInterface(bridge, HostBridge.INTERFACE_NAME)
            webViewClient = ShellClient()
            webChromeClient = PickerClient()
        }

        coverMessage = TextView(this).apply {
            text = product
            gravity = Gravity.CENTER
        }
        cover = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.WHITE)
            addView(ProgressBar(this@MainActivity))
            addView(coverMessage)
        }

        root = FrameLayout(this)
        root.addView(webView, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        root.addView(cover, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        // Android 15 draws every app edge to edge, so the status and navigation bars would sit over the page's header
        // and composer. The page is kept between them, and the strips behind the bars take the page's own fill.
        // Before Android 15 the window stops at the bars by itself.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            root.setOnApplyWindowInsetsListener { view, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                insets
            }
        }
        setContentView(root)
        // Until the page names its scheme, the bars follow the system's.
        appearance(systemDark(), "")

        webView.loadUrl(START_URL)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    /**
     * A WebView draws nothing for a file input unless its host opens the picker, so the composer's attach menu
     * would do nothing on Android without this. The system picker answers here, and the page receives the file.
     */
    @Deprecated("Activity result APIs need AndroidX activity; the shell is a plain Activity")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == PICK_FILE) {
            pickCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            pickCallback = null
            return
        }
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun systemDark(): Boolean =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    /**
     * Dark icons on a light page and light icons on a dark one, over the page's own fill, so the clock and the
     * battery stay readable in either scheme. The page's choice wins over the system's, since it may differ.
     */
    private fun appearance(dark: Boolean, background: String) {
        val fill = try {
            Color.parseColor(background)
        } catch (e: IllegalArgumentException) {
            if (dark) Color.BLACK else Color.WHITE
        }
        root.setBackgroundColor(fill)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            // Before Android 15 the bars draw their own fill rather than the page's.
            @Suppress("DEPRECATION")
            window.statusBarColor = fill
            @Suppress("DEPRECATION")
            window.navigationBarColor = fill
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (dark) 0 else light, light)
        } else {
            @Suppress("DEPRECATION")
            val flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            @Suppress("DEPRECATION")
            val current = window.decorView.systemUiVisibility
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (dark) current and flags.inv() else current or flags
        }
    }

    private fun fail(message: String) {
        cover.visibility = View.VISIBLE
        coverMessage.text = message
    }

    private fun versionName(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "0"
    } catch (e: Exception) {
        "0"
    }

    /** Opens the system picker for a file input, with the page's own accept filter, and hands back what was picked. */
    private inner class PickerClient : WebChromeClient() {
        override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
            pickCallback?.onReceiveValue(null)
            pickCallback = callback
            val intent = params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            return try {
                @Suppress("DEPRECATION")
                startActivityForResult(intent, PICK_FILE)
                true
            } catch (e: ActivityNotFoundException) {
                pickCallback = null
                false
            }
        }
    }

    /** The web view host: one asset loader and one delegate for the page's lifecycle. */
    private inner class ShellClient : WebViewClient() {
        private val loader = WebViewAssetLoader.Builder()
            .addPathHandler(ASSET_ROOT, WebViewAssetLoader.AssetsPathHandler(this@MainActivity))
            .build()

        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? =
            if (request == null) null else loader.shouldInterceptRequest(request.url)

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            view?.evaluateJavascript(HostBridge.injectedScript, null)
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            cover.visibility = View.GONE
        }

        override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
            if (request?.isForMainFrame == true) {
                fail(error?.description?.toString() ?: "the page did not load")
            }
        }
    }
}
