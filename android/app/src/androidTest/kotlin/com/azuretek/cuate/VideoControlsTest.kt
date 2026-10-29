package com.azuretek.cuate

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Issue 416: in the media viewer a video is drawn with the player's own controls, and the viewer's close control, its
// step controls and its bar floated over them. The fixture (core/test/video-controls-fixture.js) opens the real viewer on
// a synthetic clip, paused so the player's controls show. This test finds every player control (play or pause, the
// scrubber, mute, full screen) and every one of ours (close, previous, next, the bar) in the accessibility tree, keeps a
// screenshot, and asserts each control is on screen and answers a press at its own middle (the page's hit test there
// reaches the player's video for a player control, and the control itself for ours), and that none of ours overlaps a
// player control or another of ours.
//
// Issue 446: a video whose accessibility node was built while it was still empty kept that node once its clip had
// loaded, "Unable to play media." holding none of the player's controls. It was a race, since the accessibility service
// connects when a test first asks for it, so this test takes the real order every run: the fixture holds the clip back,
// the test connects the service and reads the tree over the empty video, and only then lets the clip go. A player whose
// controls never reach the tree then fails every run rather than one in four. Every wait here is for a state.
//
// Issue 443: the emulator's accessibility read is a state of its own, not a window on the page. The active root and
// every window the automation can see can all come back without the web view's controls while the app still shows them,
// and no further read of that snapshot finds them. If the controls are still absent after the first stretch, the web
// view is asked to rebuild its tree once and the wait continues, so a stale snapshot cannot fail a green app. Every
// assertion below is unchanged: the same controls must be in the tree and the viewer must be reachable before its clip.
@RunWith(AndroidJUnit4::class)
class VideoControlsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    // No listener: preserve the accessibility event delivery being observed.
    private val waitTrace = mutableListOf<String>()

    private data class Found(val name: String, val bounds: Rect, val visible: Boolean, val label: String)

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
        assertTrue("JavaScript callback timed out", done.await(JS_ANSWER_SECONDS, TimeUnit.SECONDS))
        return result
    }

    private fun quoted(text: String): String = JSONObject.quote(text)

    @Test
    fun portraitVideoKeepsEveryControlClear() = check("portrait")

    @Test
    fun landscapeVideoKeepsEveryControlClear() = check("landscape")

    @Test
    fun emptyFailureCaptureContract() = captureContract(false)

    @Test
    fun emptyFailureCaptureSurvivesDiagnosticError() = captureContract(true)

    // Controlled observations prove capture, not recurrence or repair of the real missing-tree defect.
    private class CaptureContract(val failWindows: Boolean) {
        val name = if (failWindows) "portrait-contract-windows-error" else "portrait-contract-healthy"
        val reads = mutableListOf<String>()
        var observed = false
    }

    private fun contractFile(contract: CaptureContract, extension: String): java.io.File {
        val directory = java.io.File(requireNotNull(
            InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        ))
        return java.io.File(directory, "video-controls-" + contract.name + "-empty-failure." + extension)
    }

    private fun captureContract(failWindows: Boolean) {
        val contract = CaptureContract(failWindows)
        for (extension in listOf("json", "png")) {
            assertTrue("Stale evidence must not satisfy the contract", !contractFile(contract, extension).exists())
        }
        check("portrait", contract)
        assertTrue("The original missing-control assertion never ran", contract.observed)
    }

    private fun verifyCaptureContract(
        scenario: ActivityScenario<MainActivity>, contract: CaptureContract, error: AssertionError
    ) {
        assertTrue("An unrelated assertion must not satisfy the contract", error.message.orEmpty().startsWith(
            "the viewer was not in the accessibility tree before its clip: missing close"
        ))
        val held = JSONObject(evaluate(scenario, """
            ({ state: window.videoControlsState,
              releasePresent: Boolean(document.querySelector('[aria-label="vc:release"]')),
              video: Boolean(document.querySelector('app-image-viewer video.viewer-image')),
              pending: Boolean(document.querySelector('app-image-viewer .viewer-pending')) })
        """.trimIndent()))
        fun requireHeld(page: JSONObject) {
            assertTrue("The clip must remain held", page.getString("state").startsWith("vc:empty ") &&
                page.getBoolean("releasePresent") && !page.getBoolean("video") && page.getBoolean("pending"))
        }
        requireHeld(held)
        val json = contractFile(contract, "json")
        assertTrue("Failure JSON was not retained", json.isFile && json.length() > 0)
        val evidence = JSONObject(json.readText())
        val fields = listOf("shape", "stage", "nativeTrees", "windows", "page", "webView", "screenshot", "windowManager", "waitTrace", "cacheProbe")
        assertTrue("The retained JSON lost a diagnostic field", fields.all { evidence.has(it) })
        assertTrue("The evidence is not from the held portrait clip", evidence.getString("shape") == "portrait" &&
            evidence.getString("stage") == "empty-before-release")
        assertTrue("A diagnostic stopped the later captures", contract.reads == fields.drop(2))
        for (field in listOf("nativeTrees", "webView", "windowManager")) {
            assertTrue("A real diagnostic failed: $field", evidence.get(field) is String && evidence.getString(field).isNotBlank())
        }
        if (contract.failWindows) {
            assertTrue("The diagnostic error was not retained", evidence.getJSONObject("windows").getString("error")
                .contains("capture-contract-windows-error"))
        } else {
            assertTrue("The real windows diagnostic failed", evidence.get("windows") is String && evidence.getString("windows").isNotBlank())
        }
        assertTrue("Wait provenance must be retained", evidence.getString("waitTrace").contains("begin flags="))
        val probe = evidence.getJSONObject("cacheProbe")
        assertTrue("The cache probe must not release the clip", probe.getString("heldState").contains("vc:empty "))
        assertTrue("Cache provenance must be retained", probe.has("serviceFlags") && probe.has("cleared") &&
            probe.has("cachedTree") && probe.has("freshTree"))
        requireHeld(JSONObject(evidence.getString("page")))
        assertTrue("Screenshot capture did not finish", evidence.getString("screenshot") == "retained")
        val png = contractFile(contract, "png")
        assertTrue("Failure PNG was not retained", png.isFile && png.length() > 0)
        val image = BitmapFactory.decodeFile(png.absolutePath)
        assertTrue("Failure PNG did not decode", image != null)
        requireNotNull(image).let {
            try { assertTrue("Failure PNG has no pixels", it.width > 0 && it.height > 0) }
            finally { it.recycle() }
        }
        contract.observed = true
    }

    private fun check(shape: String, contract: CaptureContract? = null) {
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val booted = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
            while (evaluate(scenario, "document.querySelector('app-root')?.phase === 'onboarding'") != "true") {
                assertTrue("Empty test app did not boot", System.nanoTime() < booted)
                instrumentation.waitForIdleSync()
            }
            // Fixture bytes exist in the test APK only: the clip is handed to the page, which the shell has no route for.
            val clip = instrumentation.context.assets.open("video-controls-$shape.mp4").use { it.readBytes() }
            evaluate(scenario, "window.fixtureVideo = " + quoted(shape) + "; window.fixtureVideoBase64 = " + quoted(Base64.encodeToString(clip, Base64.NO_WRAP)) + "; true")
            val fixture = instrumentation.context.assets.open("video-controls-fixture.js").bufferedReader().use { it.readText() }
            evaluate(scenario, fixture)
            val empty = awaitState(scenario, "vc:empty ")
            println("video controls empty scene ($shape): $empty")
            // The tree is built over the viewer while its video has nothing to play: the viewer's own controls are in it.
            // Resolve the real tree before injecting a capture-only missing observation.
            // Injecting inside readiness forces a 30-second wait and a real tree rebuild.
            val observed = awaitControls(scenario, OURS)
            val before = if (contract == null) observed else observed - "close"
            val missing = OURS.filter { it !in before }
            println("video controls ($shape) accessibility tree over the empty video:\n" + describeTree())
            if (missing.isNotEmpty()) keepEmptyFailure(scenario, shape, contract?.name ?: shape) { name ->
                contract?.reads?.add(name)
                if (contract?.failWindows == true && name == "windows") throw IllegalStateException("capture-contract-windows-error")
            }
            if (contract != null) assertTrue("Only the controlled observation may be missing", missing == listOf("close"))
            try {
                assertTrue("the viewer was not in the accessibility tree before its clip: missing " + missing.joinToString(", ") + SystemSurface.failureSuffix(), missing.isEmpty())
            } catch (error: AssertionError) {
                if (contract == null || !error.message.orEmpty().startsWith(
                    "the viewer was not in the accessibility tree before its clip: missing close"
                )) throw error
                verifyCaptureContract(scenario, contract, error)
                return@use
            }
            assertTrue("the fixture did not let the clip go", evaluate(scenario, "window.videoControlsRelease()") == "true")
            val scene = awaitState(scenario, "vc:ready ")
            println("video controls scene ($shape): $scene")
            // Issue 443: the poster must not stand in for the clip. The fixture draws the frame the player has after its
            // seek and counts the pixels, and reports the player's own frame count, so a green test proves the clip
            // really decoded behind the poster.
            val decoded = scene.optInt("decoded", 0)
            val frames = scene.optInt("totalFrames", 0)
            println("video controls scene ($shape) decoded pixels=$decoded frames=$frames")
            assertTrue("the video never decoded behind its poster: $decoded painted pixels", decoded > 0)

            val found = awaitControls(scenario, PLAYER + OURS)
            SystemSurface.requireOurs()
            keepScreenshot("video-controls-$shape.png")

            val problems = mutableListOf<String>()
            val names = PLAYER + OURS
            for (name in names) {
                val control = found[name]
                if (control == null) { problems.add("$name is not in the accessibility tree"); continue }
                println("video controls ($shape) $name '${control.label}' at ${control.bounds.toShortString()}" + if (control.visible) " visible" else " NOT visible")
                if (control.bounds.isEmpty) problems.add("$name has no size")
                if (!control.visible) problems.add("$name is not visible to the user")
                if (name != "bar") {
                    val hit = hitAt(scenario, control.bounds)
                    val expected = if (name in PLAYER) "video" else name
                    if (hit != expected) problems.add("a press on the middle of $name ${control.bounds.toShortString()} reaches $hit, not $expected")
                }
            }
            // The player's whole area is its control area too: a press anywhere on the video shows or hides the player's
            // controls, and the player draws them anywhere inside its box. The page reports the box, in its own pixels.
            val area = videoArea(scenario, scene)
            println("video controls ($shape) video at ${area.toShortString()}")
            // Ours against every player control and the video itself, the bar included; ours against each other. The bar
            // holds controls of its own, so it is not set against what it holds.
            for (mine in OURS) for (theirs in PLAYER + "video") {
                val a = found[mine]?.bounds
                val b = if (theirs == "video") area else found[theirs]?.bounds
                if (a != null && b != null && Rect.intersects(a, b)) problems.add("$mine ${a.toShortString()} overlaps the player's $theirs ${b.toShortString()}")
            }
            val separate = OURS - "bar"
            for ((i, first) in separate.withIndex()) for (second in separate.drop(i + 1)) {
                val a = found[first]?.bounds
                val b = found[second]?.bounds
                if (a != null && b != null && Rect.intersects(a, b)) problems.add("$first overlaps $second")
            }
            if (problems.isNotEmpty()) println("video controls ($shape) accessibility tree:\n" + describeTree())
            assertTrue("the $shape video's controls are not all clear: " + problems.joinToString("; ") + SystemSurface.failureSuffix(), problems.isEmpty())
        }
    }

    /** The fixture's report once its marker reaches the state named by its prefix; a failure it reports ends the test. */
    private fun awaitState(scenario: ActivityScenario<MainActivity>, prefix: String): JSONObject {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
        var state = "null"
        do {
            instrumentation.waitForIdleSync()
            state = evaluate(scenario, "window.videoControlsState || null")
            if (state != "null") {
                val text = JSONObject("{\"s\":$state}").getString("s")
                if (text.startsWith("vc:fail")) throw AssertionError("the video controls fixture failed: $text")
                if (text.startsWith(prefix)) return JSONObject(text.removePrefix(prefix))
            }
        } while (System.nanoTime() < deadline)
        throw AssertionError("the video controls fixture never reached $prefix: $state")
    }

    /**
     * The controls named, read from the accessibility tree once all of them are there or the bound passes. The first call
     * connects the accessibility service. Between readings it waits for the service's own events to settle, a state of
     * the tree, never a fixed time. Once the first stretch passes without them, the web view is asked to rebuild its tree
     * and the wait continues within the same bound (issue 443).
     */
    private fun awaitControls(scenario: ActivityScenario<MainActivity>, names: List<String>): Map<String, Found> {
        val automation = instrumentation.uiAutomation
        automation.serviceInfo = automation.serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
        val started = System.nanoTime()
        val deadline = started + TimeUnit.SECONDS.toNanos(CONTROLS_SECONDS)
        val rebuildAt = started + TimeUnit.SECONDS.toNanos(REBUILD_AFTER_SECONDS)
        waitTrace.clear()
        fun trace(stage: String) {
            if (waitTrace.size == 128) waitTrace.removeAt(1)
            waitTrace.add("ns=" + (System.nanoTime() - started) + " " + stage)
        }
        trace("begin flags=" + automation.serviceInfo.flags + " names=" + names)
        var rebuilt = false
        var found: Map<String, Found> = emptyMap()
        do {
            instrumentation.waitForIdleSync()
            trace("collect begin")
            found = collect()
            trace("collect end names=" + found.keys)
            if (names.all { it in found }) return found
            val now = System.nanoTime()
            if (!rebuilt && now >= rebuildAt) {
                rebuilt = true
                trace("rebuild begin")
                rebuildTree(scenario)
                trace("rebuild end")
                instrumentation.waitForIdleSync()
                trace("collect begin")
                found = collect()
                trace("collect end names=" + found.keys)
                if (names.all { it in found }) return found
                continue
            }
            val left = TimeUnit.NANOSECONDS.toMillis(deadline - now)
            if (left <= 0) break
            trace("waitForIdle begin budgetMs=" + left)
            try {
                automation.waitForIdle(TREE_SETTLE_MS, left)
                trace("waitForIdle idle")
            } catch (busy: java.util.concurrent.TimeoutException) {
                trace("waitForIdle timeout")
                continue
            }
        } while (System.nanoTime() < deadline)
        trace("deadline rebuilt=" + rebuilt)
        return found
    }

    /**
     * Asks the web view to rebuild the tree behind its accessibility node. Toggling importance throws away the node
     * the automation had been handed and the next read asks the renderer for the page as it is now, which is what a
     * stale snapshot is missing. One rebuild per wait.
     */
    private fun rebuildTree(scenario: ActivityScenario<MainActivity>) {
        scenario.onActivity { activity ->
            webView(activity.findViewById(android.R.id.content))?.let { view ->
                view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
                view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
                view.sendAccessibilityEvent(android.view.accessibility.AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED)
                view.invalidate()
            }
        }
    }

    // Every window the automation can see, not only the active root: under the emulator the active root intermittently
    // comes back without the WebView's controls, while the app window is still there (issue 443).
    private fun roots(): List<AccessibilityNodeInfo> {
        val roots = mutableListOf<AccessibilityNodeInfo>()
        instrumentation.uiAutomation.rootInActiveWindow?.let { roots.add(it) }
        try {
            for (window in instrumentation.uiAutomation.windows) {
                val root = window.root ?: continue
                if (roots.none { it.windowId == root.windowId }) roots.add(root)
            }
        } catch (_: Exception) {
            // The automation can drop between windows; the active root is still collected above.
        }
        return roots
    }

    private fun collect(): Map<String, Found> {
        val found = mutableMapOf<String, Found>()
        for (root in roots()) walk(root) { node ->
            val label = (node.contentDescription ?: node.text ?: "").toString().trim()
            val lower = label.lowercase()
            val name = when {
                lower == "play" || lower == "pause" -> "play or pause"
                lower == "mute" || lower == "unmute" -> "mute"
                lower.contains("full screen") || lower.contains("fullscreen") -> "full screen"
                node.className?.toString() == "android.widget.SeekBar" || lower.contains("scrubber") -> "scrubber"
                label == "Close" -> "close"
                label == "Previous item" -> "prev"
                label == "Next item" -> "next"
                label == "Media controls" -> "bar"
                else -> null
            }
            if (name != null && name !in found) {
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                found[name] = Found(name, bounds, node.isVisibleToUser, label)
            }
        }
        return found
    }

    private fun walk(node: AccessibilityNodeInfo, visit: (AccessibilityNodeInfo) -> Unit) {
        visit(node)
        for (i in 0 until node.childCount) node.getChild(i)?.let { walk(it, visit) }
    }

    private fun describeTree(): String {
        val root = instrumentation.uiAutomation.rootInActiveWindow ?: return "(no window)"
        val lines = mutableListOf<String>()
        walk(root) { node ->
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            val label = (node.contentDescription ?: node.text ?: "").toString().take(80)
            if (label.isNotEmpty() || node.isClickable) lines.add(node.className.toString() + " '" + label + "' " + bounds.toShortString())
        }
        return lines.joinToString("\n")
    }

    /** Evidence only after the original pre-clip deadline, never a recovery or a readiness condition (issue 509). */
    private fun keepEmptyFailure(
        scenario: ActivityScenario<MainActivity>, shape: String, evidenceName: String = shape,
        beforeRead: (String) -> Unit = {}
    ) {
        val evidence = JSONObject().put("shape", shape).put("stage", "empty-before-release")
        fun capture(name: String, read: () -> Any?) {
            try { beforeRead(name); evidence.put(name, read()) } catch (error: Throwable) {
                evidence.put(name, JSONObject().put("error", error.toString()))
            }
        }
        // Read all roots without the label/clickable filter used by the human-readable report.
        capture("nativeTrees") {
            roots().map { root ->
                val lines = mutableListOf<String>()
                walk(root) { node ->
                    val bounds = Rect()
                    node.getBoundsInScreen(bounds)
                    lines.add("window=" + node.windowId + " class=" + node.className +
                        " package=" + node.packageName + " children=" + node.childCount +
                        " visible=" + node.isVisibleToUser + " bounds=" + bounds.toShortString() +
                        " label=" + (node.contentDescription ?: node.text ?: ""))
                }
                lines.joinToString("\n")
            }.joinToString("\n--- root ---\n")
        }
        capture("windows") {
            instrumentation.uiAutomation.windows.joinToString("\n") { window ->
                "id=" + window.id + " type=" + window.type + " layer=" + window.layer +
                    " active=" + window.isActive + " focused=" + window.isFocused
            }
        }
        capture("page") {
            evaluate(scenario, """
                (() => {
                  const viewer = document.querySelector('app-image-viewer');
                  const box = (node) => {
                    if (!node) return null;
                    const rect = node.getBoundingClientRect();
                    const style = getComputedStyle(node);
                    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                    return { tag: node.tagName, label: node.getAttribute('aria-label'), role: node.getAttribute('role'),
                      connected: node.isConnected, hidden: node.hidden, inert: node.inert,
                      ariaHidden: node.getAttribute('aria-hidden'), display: style.display,
                      visibility: style.visibility, opacity: style.opacity,
                      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
                      hit: hit ? { tag: hit.tagName, class: String(hit.className) } : null };
                  };
                  const controls = {};
                  for (const selector of ['.viewer', '.close-button', '.viewer-prev', '.viewer-next', '.viewer-bar']) {
                    controls[selector] = box(viewer?.querySelector(selector));
                  }
                  return { state: window.videoControlsState, visibility: document.visibilityState,
                    focused: document.hasFocus(), video: Boolean(viewer?.querySelector('video.viewer-image')),
                    pending: Boolean(viewer?.querySelector('.viewer-pending')),
                    releasePresent: Boolean(document.querySelector('[aria-label="vc:release"]')),
                    controls, viewport: { w: innerWidth, h: innerHeight, scale: devicePixelRatio } };
                })()
            """.trimIndent())
        }
        capture("webView") {
            var state = "no web view"
            scenario.onActivity { activity ->
                webView(activity.findViewById(android.R.id.content))?.let { view ->
                    state = "attached=" + view.isAttachedToWindow + " shown=" + view.isShown +
                        " windowFocus=" + view.hasWindowFocus() + " visibility=" + view.visibility +
                        " important=" + view.importantForAccessibility + " width=" + view.width + " height=" + view.height
                }
            }
            state
        }
        // Keep a failure of one diagnostic from hiding the original assertion or the other evidence.
        capture("screenshot") { keepScreenshot("video-controls-$evidenceName-empty-failure.png"); "retained" }
        capture("windowManager") {
            instrumentation.uiAutomation.executeShellCommand("timeout 5 dumpsys window windows").use { descriptor ->
                java.io.FileInputStream(descriptor.fileDescriptor).bufferedReader().use { it.readText() }
            }
        }
        capture("waitTrace") { waitTrace.joinToString("\n") }
        // Only after the original missing result and cached evidence. This is not recovery.
        capture("cacheProbe") {
            val automation = instrumentation.uiAutomation
            JSONObject().put("serviceFlags", automation.serviceInfo.flags)
                .put("cachedTree", describeTree())
                .put("cleared", automation.clearCache())
                .put("freshTree", describeTree())
                .put("heldState", evaluate(scenario, "window.videoControlsState || null"))
        }
        try {
            val outputDir = java.io.File(requireNotNull(
                InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
            ) { "The test runner must provide a retained output directory" })
            kotlin.check(outputDir.isDirectory || outputDir.mkdirs()) { "Cannot create evidence directory" }
            java.io.File(outputDir, "video-controls-$evidenceName-empty-failure.json").writeText(evidence.toString(2))
        } catch (error: Exception) {
            println("video controls failure evidence could not be retained: $error\n$evidence")
        }
    }

    /** The video's box on the screen, from the page's report in its own pixels, scaled onto the web view. */
    private fun videoArea(scenario: ActivityScenario<MainActivity>, scene: JSONObject): Rect {
        val origin = IntArray(2)
        var width = 0
        scenario.onActivity { activity ->
            val view = webView(activity.findViewById(android.R.id.content))!!
            view.getLocationOnScreen(origin)
            width = view.width
        }
        val video = scene.getJSONObject("video")
        val scale = width.toDouble() / scene.getJSONObject("viewport").getDouble("w")
        fun px(css: Double, from: Int) = (from + css * scale).toInt()
        val x = video.getDouble("x")
        val y = video.getDouble("y")
        return Rect(px(x, origin[0]), px(y, origin[1]), px(x + video.getDouble("w"), origin[0]), px(y + video.getDouble("h"), origin[1]))
    }

    /** What the page's own hit test reaches at the middle of a box on the screen: the player's video, one of ours, or another element. */
    private fun hitAt(scenario: ActivityScenario<MainActivity>, bounds: Rect): String {
        val origin = IntArray(2)
        scenario.onActivity { activity -> webView(activity.findViewById(android.R.id.content))!!.getLocationOnScreen(origin) }
        val script = "(() => { const d = window.devicePixelRatio || 1; const el = document.elementFromPoint((" + bounds.exactCenterX() + " - " + origin[0] + ") / d, (" + bounds.exactCenterY() + " - " + origin[1] + ") / d);" +
            " if (!el) return 'nothing'; if (el.matches('video.viewer-image')) return 'video';" +
            " if (el.closest('.close-button')) return 'close'; if (el.closest('.viewer-prev')) return 'prev'; if (el.closest('.viewer-next')) return 'next';" +
            " if (el.closest('.viewer-bar')) return 'bar'; return el.tagName.toLowerCase() + '.' + String(el.className || ''); })()"
        return JSONObject("{\"s\":" + evaluate(scenario, script) + "}").getString("s")
    }

    private fun keepScreenshot(name: String) {
        instrumentation.waitForIdleSync()
        val capture = requireNotNull(instrumentation.uiAutomation.takeScreenshot()) { "no screenshot" }
        // AGP copies this directory before uninstalling the app and its data.
        val outputDir = java.io.File(requireNotNull(
            InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        ) { "The test runner must provide a retained output directory" })
        assertTrue("Cannot create capture directory", outputDir.isDirectory || outputDir.mkdirs())
        val output = java.io.File(outputDir, name)
        output.outputStream().use {
            assertTrue("Screenshot encoding failed", capture.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
        }
        capture.recycle()
        assertTrue("Screenshot is empty", output.length() > 0)
    }

    private companion object {
        val PLAYER = listOf("play or pause", "scrubber", "mute", "full screen")
        val OURS = listOf("close", "prev", "next", "bar")
        const val TREE_SETTLE_MS = 300L
        const val CONTROLS_SECONDS = 30L
        const val REBUILD_AFTER_SECONDS = 15L
    }
}
