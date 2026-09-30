package com.azuretek.cuate

import android.content.res.AssetManager

/**
 * Reading a file out of the APK's own assets.
 *
 * One pattern for every file the shell shares with core: core's directories are
 * copied into the APK's assets beside the app (see app/build.gradle.kts) and read
 * here at runtime, so the app carries the one owner rather than a copy of it.
 * The desktop and the iOS shell read the same files, which is why neither
 * re-declares a value and neither can drift from the other.
 *
 * Paths are relative to the asset root, because core's directories are copied in
 * as roots: spec/naming.json, spec/host-bridge.json, build/engine.js,
 * fixtures/engine-cases.json and app/index.html all keep the layout they have in
 * the repository.
 */
object BundledSpec {
    fun text(assets: AssetManager, relativePath: String): String =
        assets.open(relativePath).use { String(it.readBytes(), Charsets.UTF_8) }

    fun bytes(assets: AssetManager, relativePath: String): ByteArray =
        assets.open(relativePath).use { it.readBytes() }
}
