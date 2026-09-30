package com.azuretek.cuate

import android.content.res.AssetManager
import org.json.JSONObject

/**
 * What this product is called, read from core/spec/naming.json at runtime.
 *
 * The same file is what the desktop and the iOS shell read, so the three
 * interfaces cannot disagree about what the app is called or which ids it owns.
 * A name is a string, and a string that decides what a home screen says is worth
 * no cleverness at all, so this holds no logic beyond the read.
 */
object Naming {
    private const val SPEC = "spec/naming.json"

    private fun spec(assets: AssetManager): JSONObject? =
        try {
            JSONObject(BundledSpec.text(assets, SPEC))
        } catch (e: Exception) {
            null
        }

    /** What a person calls this app, and what the launcher label shows. */
    fun product(assets: AssetManager): String = spec(assets)?.optString("product", "") ?: ""

    /** The formal name for the store record. No surface in the app prints it. */
    fun storeName(assets: AssetManager): String = spec(assets)?.optString("storeName", "") ?: ""

    fun repo(assets: AssetManager): String = spec(assets)?.optString("repo", "") ?: ""

    /** The id this platform owns, which is the applicationId and the Keystore owner. */
    fun androidId(assets: AssetManager): String =
        spec(assets)?.optJSONObject("ids")?.optString("android", "") ?: ""
}
