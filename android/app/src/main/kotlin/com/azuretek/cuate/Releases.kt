package com.azuretek.cuate

import android.content.res.AssetManager
import org.json.JSONObject

/**
 * Where a newer build of this app is learned of and fetched from (issue 192), read from core/spec/releases.json.
 *
 * The repository's public release feed needs no credential, and a published release carries the signed APK and a
 * manifest naming its size, its SHA-256 and the certificate that signed it. The page decides whether the feed names a
 * newer build (core/app/rules/updates.js); this shell only reads the feed and, when asked, fetches the release the page
 * named, filling the same templates core's releaseAssets fills.
 */
object Releases {
    private const val SPEC = "spec/releases.json"

    /** A release version, the same shape core/kit/rules/build.js compares; nothing else becomes part of a URL. */
    val VERSION = Regex("^\\d+\\.\\d+\\.\\d+(-dev\\.\\d+\\.[a-f0-9]{10})?$")

    /** A template with its {names} filled in, or null when one is missing, so a half-filled address is never fetched. */
    fun fill(template: String, values: Map<String, String>): String? {
        var out = template
        for ((key, value) in values) out = out.replace("{" + key + "}", value)
        return if (out.contains("{")) null else out
    }

    data class Assets(val feed: String, val apkName: String, val apkUrl: String, val manifestName: String, val manifestUrl: String)

    /** The feed and one release's Android assets, from the spec text and the naming spec's repo and slug. */
    fun assets(specText: String, repo: String, slug: String, version: String): Assets? {
        if (!VERSION.matches(version) || repo.isEmpty() || slug.isEmpty()) return null
        val spec = JSONObject(specText)
        val values = mapOf("repo" to repo, "slug" to slug, "version" to version)
        val android = spec.getJSONObject("android")
        val apkName = fill(android.getString("apk"), values) ?: return null
        val manifestName = fill(android.getString("manifest"), values) ?: return null
        val asset = spec.getString("asset")
        return Assets(
            feed = fill(spec.getString("feed"), values) ?: return null,
            apkName = apkName,
            apkUrl = fill(asset, values + ("name" to apkName)) ?: return null,
            manifestName = manifestName,
            manifestUrl = fill(asset, values + ("name" to manifestName)) ?: return null,
        )
    }

    fun specText(assets: AssetManager): String = BundledSpec.text(assets, SPEC)

    /** The public feed's address, for the check; it names no version. */
    fun feedUrl(assets: AssetManager): String? = try {
        fill(JSONObject(specText(assets)).getString("feed"), mapOf("repo" to Naming.repo(assets)))
    } catch (e: Exception) {
        null
    }

    /** The channel a version follows: a test build names its commit count, a plain version is stable. */
    fun channelOf(version: String): String = if (version.contains("-")) "dev" else "stable"
}
