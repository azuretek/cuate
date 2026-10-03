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
import android.view.WindowManager
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

    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var cover: LinearLayout
    private lateinit var coverMessage: TextView
    private var pickCallback: ValueCallback<Array<Uri>>? = null

    /** The scheme the page last said it drew, or null until it has said; the bar icons contrast with it. */
    private var pageScheme: String? = null

    /** The page's own fill (its --color-bg), shown behind the web view where the keyboard ends it; empty until named. */
    private var pageFill = ""

    /** The window's insets in CSS pixels (top, right, bottom, left), handed to the page as --shell-inset-*. */
    private var pageInsets = floatArrayOf(0f, 0f, 0f, 0f)

    /** The in-app updater the bridge owns, told when the activity returns to the front. */
    private var updater: ApkUpdater? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val product = Naming.product(assets).ifEmpty { "Cuate" }
        val bridge = HostBridge(
            this, SecureStore(this), HostBridge.commandNames(assets), product, versionName(),
            appearance = { dark, background ->
                runOnUiThread {
                    pageScheme = if (dark) "dark" else "light"
                    pageFill = background
                    applyBarIcons()
                }
                true
            },
            build = versionCode(),
            // A later answer and an update's progress reach the page here, on the UI thread a WebView requires.
            script = { js -> runOnUiThread { if (::webView.isInitialized) webView.evaluateJavascript(js, null) } },
        )
        updater = bridge.updater
        ApkUpdater.live = bridge.updater
        Diagnostics.remember(this)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            // Only the media viewer zooms, in the page (issue 180): the web view itself never zooms, and the page's
            // text size is the text-size setting's rather than the system font scale applied on top of it.
            settings.setSupportZoom(false)
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.textZoom = 100
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
            setBackgroundColor(getColor(R.color.surface))
            addView(ProgressBar(this@MainActivity))
            addView(coverMessage)
        }

        root = FrameLayout(this)
        root.setBackgroundColor(getColor(R.color.surface))
        root.addView(webView, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        root.addView(cover, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        root.setOnApplyWindowInsetsListener { _, insets ->
            applyInsets(insets)
            insets
        }
        setContentView(root)
        edgeToEdge()
        applyBarIcons()

        webView.loadUrl(START_URL)
    }

    /**
     * The page paints behind the status bar, the navigation bar and any display cutout, and pads its edge surfaces by
     * the insets it is handed, so each bar wears the colour of the surface beside it (issue 175). Android 15 forces
     * this for the target SDK; the earlier releases are asked for the same thing here, with transparent bars and no
     * contrast scrim of the system's own.
     */
    @Suppress("DEPRECATION")
    private fun edgeToEdge() {
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                } else {
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                }
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
        } else {
            window.decorView.systemUiVisibility = window.decorView.systemUiVisibility or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
    }

    /**
     * The bar icons contrast with the page: dark on a light surface, light on a dark one. Until the page has said which
     * scheme it drew, the system's own night mode decides, which is what the page follows by default. The page names its
     * scheme and its fill through window.appearance; the page's choice wins over the system's, since it may differ. The
     * bars themselves stay transparent: the page paints behind them.
     */
    @Suppress("DEPRECATION")
    private fun applyBarIcons() {
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val light = (pageScheme ?: if (night) "dark" else "light") == "light"
        val fill = try {
            Color.parseColor(pageFill)
        } catch (e: RuntimeException) {
            // parseColor throws IllegalArgumentException for an unknown form and StringIndexOutOfBoundsException for an
            // empty one, which is what the shell holds before the page has named its fill.
            getColor(R.color.surface)
        }
        root.setBackgroundColor(fill)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (light) mask else 0, mask)
        } else {
            val mask = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            val flags = window.decorView.systemUiVisibility
            window.decorView.systemUiVisibility = if (light) flags or mask else flags and mask.inv()
        }
    }

    /**
     * The system bars and the cutout become the page's insets, in CSS pixels. The keyboard is the one inset the page
     * does not paint behind: the web view ends at its top edge, as the resizes-content viewport expects, and nothing
     * under it needs the navigation bar's inset while it is up.
     */
    @Suppress("DEPRECATION")
    private fun applyInsets(insets: WindowInsets) {
        val bars: IntArray
        val keyboard: Int
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            bars = intArrayOf(b.top, b.right, b.bottom, b.left)
            keyboard = insets.getInsets(WindowInsets.Type.ime()).bottom
        } else {
            bars = intArrayOf(insets.stableInsetTop, insets.stableInsetRight, insets.stableInsetBottom, insets.stableInsetLeft)
            keyboard = if (insets.systemWindowInsetBottom > insets.stableInsetBottom) insets.systemWindowInsetBottom else 0
        }
        val typing = keyboard > bars[2]
        val params = webView.layoutParams as FrameLayout.LayoutParams
        val margin = if (typing) keyboard else 0
        if (params.bottomMargin != margin) {
            params.bottomMargin = margin
            webView.layoutParams = params
        }
        val density = resources.displayMetrics.density
        pageInsets = floatArrayOf(bars[0] / density, bars[1] / density, if (typing) 0f else bars[2] / density, bars[3] / density)
        sendInsets()
    }

    private fun sendInsets() {
        val (top, right, bottom, left) = pageInsets.map { "%.2fpx".format(java.util.Locale.ROOT, it) }
        webView.evaluateJavascript(
            "(function (s) { s.setProperty('--shell-inset-top', '$top'); s.setProperty('--shell-inset-right', '$right'); " +
                "s.setProperty('--shell-inset-bottom', '$bottom'); s.setProperty('--shell-inset-left', '$left'); })" +
                "(document.documentElement.style);",
            null,
        )
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // The activity keeps its page through a night mode change, so the shell's own surface follows here; the page
        // follows the system through its own media query and reports the scheme it then drew.
        cover.setBackgroundColor(getColor(R.color.surface))
        applyBarIcons()
    }

    /** Back from the setting that allows installs: an update waiting on it continues (issue 192). */
    override fun onResume() {
        super.onResume()
        updater?.resumed()
    }

    override fun onDestroy() {
        if (ApkUpdater.live === updater) ApkUpdater.live = null
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

    private fun fail(message: String) {
        cover.visibility = View.VISIBLE
        coverMessage.text = message
    }

    /** The build number this APK carries, which the release pipeline sets to the commit count. */
    private fun versionCode(): Long = try {
        val info = packageManager.getPackageInfo(packageName, 0)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
    } catch (e: Exception) {
        0
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
            sendInsets()
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            sendInsets()
            cover.visibility = View.GONE
        }

        override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
            if (request?.isForMainFrame == true) {
                fail(error?.description?.toString() ?: "the page did not load")
            }
        }
    }
}
