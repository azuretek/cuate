package com.azuretek.cuate

import android.os.ParcelFileDescriptor
import androidx.test.platform.app.InstrumentationRegistry
import java.io.FileInputStream

/**
 * The screen a pixel test is judged against (issue 198). A capture cannot say whether the
 * frame it holds is the app or a system dialog drawn over it, so the window manager is
 * asked which window holds input focus: that is the surface really on screen. When it is
 * not ours, a capture failure names it, and a pixel test stops blaming the page for an
 * environment fault the emulator lane exists to remove.
 */
object SystemSurface {
    private fun instrumentation() = InstrumentationRegistry.getInstrumentation()

    private fun ourPackage(): String = instrumentation().targetContext.packageName

    /** The window manager's line for the window that holds input focus, or null. */
    private fun focusLine(): String? {
        val descriptor: ParcelFileDescriptor = instrumentation().uiAutomation.executeShellCommand("dumpsys window")
        val text = descriptor.use { FileInputStream(it.fileDescriptor).bufferedReader().use { reader -> reader.readText() } }
        return text.lineSequence().firstOrNull { it.contains("mCurrentFocus") }?.trim()
    }

    /**
     * A description of the system surface covering the app, or null when the focused window
     * is ours or nothing is focused. The status bar and the soft keyboard share the screen
     * with us and are not a cover; a launcher, a SystemUI window, a permission dialog or
     * another app's "isn't responding" dialog is.
     */
    fun obscuring(): String? {
        val line = focusLine() ?: return null
        val window = line.substringAfter("mCurrentFocus=", "").trim()
        if (window.isEmpty() || window == "null") return null
        if (window.contains(ourPackage())) return null
        val covers = listOf(
            "Application Not Responding",
            "com.android.systemui",
            "com.google.android.apps.nexuslauncher",
            "com.android.launcher",
            "com.android.permissioncontroller",
            "com.google.android.permissioncontroller",
            "com.android.packageinstaller",
            "com.google.android.packageinstaller",
        ).any { window.contains(it) }
        return if (covers) line else null
    }

    /** Fails now, naming the system surface, rather than after a pixel-test timeout. */
    fun requireOurs() {
        obscuring()?.let {
            throw AssertionError("a system surface is covering the app, so the screen is not ours to judge: $it")
        }
    }

    /** Appended to a capture failure so it reads as the environment fault when it is one. */
    fun failureSuffix(): String =
        obscuring()?.let { "; a system surface is covering the app: $it" } ?: ""
}
