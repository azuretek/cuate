package com.azuretek.cuate

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
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
    }

    private lateinit var webView: WebView
    private lateinit var cover: LinearLayout
    private lateinit var coverMessage: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val product = Naming.product(assets).ifEmpty { "Cuate" }
        val bridge = HostBridge(this, SecureStore(this), HostBridge.commandNames(assets), product, versionName())
        Diagnostics.remember(this)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            addJavascriptInterface(bridge, HostBridge.INTERFACE_NAME)
            webViewClient = ShellClient()
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

        val root = FrameLayout(this)
        root.addView(webView, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        root.addView(cover, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        setContentView(root)

        webView.loadUrl(START_URL)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
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
