package com.azuretek.cuate

import android.content.Intent
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Issue 171: the About page on Android is the same page the desktop draws, opened from Settings' last row, and its
// Check for updates reads the release feed through this shell's own bridge (updates.releases, issue 192), whose answer
// arrives as the app notice. The fixture (core/test/about-fixture.js) drives the real components; this test injects it,
// waits for its proof and keeps a light and a dark capture of the update-available state.
//
// The release is this test's own (ReleaseTransport.override, set in this process only): the feed is the synthetic
// core/test/release-feed-fixture.atom, and the release it names carries this very APK with a manifest describing it,
// so the download, the digest and the signer checks run for real from an older build to a newer one without a network.
@RunWith(AndroidJUnit4::class)
class AboutPageTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    /** The newest release the fixture feed names on the stable channel a test build follows. */
    private val offered = "99.0.0"

    @Before
    fun serveTheFixtureRelease() {
        val context = instrumentation.targetContext
        val feed = instrumentation.context.assets.open("release-feed-fixture.atom").bufferedReader().use { it.readText() }
        val bytes = java.io.File(context.applicationInfo.sourceDir).readBytes()
        val slug = JSONObject(BundledSpec.text(context.assets, "spec/naming.json")).getString("slug")
        val info = context.packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES)
        val signer = ApkVerify.sha256(info.signingInfo!!.signingCertificateHistory[0].toByteArray())
        val manifest = JSONObject().put("version", offered).put("commit", "0".repeat(40)).put("file", "$slug-android-$offered.apk")
            .put("size", bytes.size.toLong()).put("sha256", ApkVerify.sha256(bytes)).put("signer", signer).toString()
        ReleaseTransport.override = object : ReleaseTransport {
            override fun text(url: String): String = if (url.endsWith(".manifest.json")) manifest else feed
            override fun open(url: String): ReleaseTransport.Body = ReleaseTransport.Body(bytes.inputStream(), bytes.size.toLong())
        }
    }

    @After
    fun stopServing() {
        ReleaseTransport.override = null
    }

    private fun webView(group: ViewGroup): WebView? {
        for (i in 0 until group.childCount) {
            val child = group.getChildAt(i)
            if (child is WebView) return child
            if (child is ViewGroup) webView(child)?.let { return it }
        }
        return null
    }

    private fun evaluate(scenario: ActivityScenario<MainActivity>, script: String): String {
        val done = CountDownLatch(1)
        var result = "null"
        scenario.onActivity { activity ->
            val view = webView(activity.findViewById(android.R.id.content))!!
            view.evaluateJavascript(script) { value -> result = value; done.countDown() }
        }
        assertTrue("JavaScript callback timed out", done.await(5, TimeUnit.SECONDS))
        return result
    }

    private fun awaitProof(scenario: ActivityScenario<MainActivity>): JSONObject {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
        var result = "null"
        do {
            instrumentation.waitForIdleSync()
            result = evaluate(scenario, "window.aboutProof || null")
            if (result != "null") {
                val proof = JSONObject(result)
                if (proof.has("error")) throw AssertionError("About fixture failed: " + proof.getString("error"))
                if (proof.getBoolean("ok")) return proof
            }
        } while (System.nanoTime() < deadline)
        throw AssertionError("The About page never showed its notice: $result")
    }

    // The page as painted, not a frame the WebView drew before it: the app icon's own tile colour
    // (desktop/build/icon.svg) is on screen, which it only is once the About page has drawn its icon.
    private fun iconShown(capture: android.graphics.Bitmap): Boolean {
        val tile = android.graphics.Color.rgb(0x15, 0x6c, 0x68)
        var hits = 0
        for (y in 0 until capture.height step 4) {
            for (x in 0 until capture.width step 4) {
                val p = capture.getPixel(x, y)
                if (Math.abs(android.graphics.Color.red(p) - android.graphics.Color.red(tile)) <= 8
                    && Math.abs(android.graphics.Color.green(p) - android.graphics.Color.green(tile)) <= 8
                    && Math.abs(android.graphics.Color.blue(p) - android.graphics.Color.blue(tile)) <= 8) hits++
            }
        }
        return hits >= 50
    }

    // Two captures in a row that draw the same picture with the icon on it, so a frame still arriving, or one
    // the WebView drew before the page, is never kept.
    private fun settledCapture(): android.graphics.Bitmap {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        var previous: android.graphics.Bitmap? = null
        do {
            instrumentation.waitForIdleSync()
            val capture = instrumentation.uiAutomation.takeScreenshot()
            if (capture != null && !iconShown(capture)) {
                capture.recycle()
            } else if (capture != null) {
                val last = previous
                if (last != null && last.sameAs(capture)) { last.recycle(); return capture }
                last?.recycle()
                previous = capture
            }
        } while (System.nanoTime() < deadline)
        throw AssertionError("The screen never showed the About page with its icon")
    }

    // Two captures in a row that draw the same picture, for a view scrolled away from the icon settledCapture looks for.
    private fun steadyCapture(): android.graphics.Bitmap {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        var previous: android.graphics.Bitmap? = null
        do {
            instrumentation.waitForIdleSync()
            val capture = instrumentation.uiAutomation.takeScreenshot() ?: continue
            val last = previous
            if (last != null && last.sameAs(capture)) { last.recycle(); return capture }
            last?.recycle()
            previous = capture
        } while (System.nanoTime() < deadline)
        throw AssertionError("The screen never settled")
    }

    private fun keep(capture: android.graphics.Bitmap, name: String) {
        // AGP copies this directory before uninstalling the app and its data.
        val outputDir = java.io.File(requireNotNull(
            InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        ) { "The test runner must provide a retained output directory" })
        assertTrue("Cannot create capture directory", outputDir.isDirectory || outputDir.mkdirs())
        val output = java.io.File(outputDir, name)
        output.outputStream().use {
            assertTrue("Screenshot encoding failed", capture.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
        }
        assertTrue("Screenshot is empty", output.length() > 0)
    }

    private fun waitFor(scenario: ActivityScenario<MainActivity>, script: String, what: String, seconds: Long = 30) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (evaluate(scenario, script) != "true") {
            assertTrue("Timed out waiting for $what: " + evaluate(scenario, "(document.querySelector('.app-notice') || {}).textContent || ''"), System.nanoTime() < deadline)
            instrumentation.waitForIdleSync()
        }
    }

    // From an older build to a newer one (issue 192): About's Download fetches the release's APK, the shell checks its
    // size, its SHA-256 and its signer against the manifest and this app, and the notice and About's button then offer
    // the install. Install asks once, in the app's own words, before Android's own permission screen.
    @Test
    fun downloadVerifyAndAskToInstall() {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            waitFor(scenario, "document.querySelector('app-root')?.phase === 'onboarding'", "the empty test app to boot", 20)
            val fixture = instrumentation.context.assets.open("about-fixture.js").bufferedReader().use { it.readText() }
            evaluate(scenario, "window.fixtureScheme = 'light';")
            evaluate(scenario, fixture)
            awaitProof(scenario)
            evaluate(scenario, "document.querySelector('app-about [data-action=check-updates]').click()")
            waitFor(scenario, "((document.querySelector('.app-notice') || {}).textContent || '').includes('downloaded and verified')", "the verified download")
            waitFor(scenario, "(function (b) { return Boolean(b) && b.dataset.command === 'updates.install' && !b.dataset.press; })(document.querySelector('app-about [data-action=check-updates]'))", "About to offer the install")
            val label = evaluate(scenario, "document.querySelector('app-about [data-action=check-updates]').textContent.trim()")
            assertTrue("About's button is the notice's Install: $label", label == "\"Install\"")
            // The press that started the download holds its own success mark for a moment, so the capture is kept only
            // when the button reads Install both before and after it was taken. The page is scrolled to the button,
            // so the capture shows it and the line under it that names the verified download.
            evaluate(scenario, "document.querySelector('app-about [data-action=check-updates]').scrollIntoView({ block: 'center' })")
            val idleInstall = "(function (b) { return Boolean(b) && !b.dataset.press && b.textContent.trim() === 'Install'; })(document.querySelector('app-about [data-action=check-updates]'))"
            val until = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
            var ready: android.graphics.Bitmap? = null
            while (ready == null) {
                assertTrue("About never settled on Install", System.nanoTime() < until)
                waitFor(scenario, idleInstall, "About's Install to settle")
                val capture = steadyCapture()
                if (evaluate(scenario, idleInstall) == "true") ready = capture else capture.recycle()
            }
            keep(requireNotNull(ready), "update-ready-light.png")
            evaluate(scenario, "document.querySelector('app-about [data-action=check-updates]').click()")
            // Android has not yet allowed this app to install apps, so the app says why before sending the person there.
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
            var shown = false
            while (!shown && System.nanoTime() < deadline) {
                instrumentation.waitForIdleSync()
                shown = instrumentation.uiAutomation.rootInActiveWindow
                    ?.findAccessibilityNodeInfosByText("install its updates")?.isNotEmpty() == true
            }
            assertTrue("The one-time install prompt says why", shown)
            keep(instrumentation.uiAutomation.takeScreenshot(), "update-install-prompt-light.png")
        }
    }

    @Test
    fun lightAbout() = about("light")

    @Test
    fun darkAbout() = about("dark")

    private fun about(scheme: String) {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
            while (evaluate(scenario, "document.querySelector('app-root')?.phase === 'onboarding'") != "true") {
                assertTrue("Empty test app did not boot", System.nanoTime() < deadline)
                instrumentation.waitForIdleSync()
            }
            // Fixture bytes exist in the test APK only. No production intent or bridge bypass.
            val fixture = instrumentation.context.assets.open("about-fixture.js").bufferedReader().use { it.readText() }
            evaluate(scenario, "window.fixtureScheme = '$scheme';")
            evaluate(scenario, fixture)
            val proof = awaitProof(scenario)
            assertTrue("About draws its icon, Check for updates and the build: " + proof, proof.getString("parts") == "identity|updates|build")
            assertTrue("The notice offers the newer build: " + proof, proof.getString("notice").contains("Version $offered is available"))
            assertTrue("About's button is the notice's Download: " + proof, proof.getString("button") == "Download" && proof.getString("command") == "updates.download")
            keep(settledCapture(), "about-$scheme.png")
        }
    }
}
