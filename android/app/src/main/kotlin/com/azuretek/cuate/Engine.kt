package com.azuretek.cuate

import android.content.Context
import android.content.res.AssetManager
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import java.io.Closeable
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * The generated engine bundle, evaluated in the embedded engine.
 *
 * A shell whose JavaScript engine has no module loader cannot import core's
 * files, so the rules a shell needs before any page loads ship as one generated
 * bundle (scripts/gen-engine-bundle.mjs) rather than as a Kotlin port of them.
 * The bundle defines the global engine; it is evaluated once at launch, and a
 * null engine means the app still boots with the page's own copy of the rules
 * rather than refusing to start.
 *
 * The engine was chosen by measurement rather than by preference; docs/android.md
 * records the comparison and .github/workflows/android.yml records the numbers.
 */
class Engine private constructor(
    private val sandbox: JavaScriptSandbox,
    private val isolate: JavaScriptIsolate,
) : Closeable {

    companion object {
        const val BUNDLE_ASSET = "build/engine.js"
        private const val TIMEOUT_SECONDS = 60L

        fun open(context: Context, assets: AssetManager = context.assets): Engine? {
            val source = try {
                BundledSpec.text(assets, BUNDLE_ASSET)
            } catch (e: IOException) {
                return null
            }
            return try {
                val sandbox = JavaScriptSandbox
                    .createConnectedInstanceAsync(context)
                    .get(TIMEOUT_SECONDS, TimeUnit.SECONDS)
                val isolate = sandbox.createIsolate()
                // The trailing expression returns a string, because the isolate
                // API answers strings: the bundle itself returns nothing.
                val defined = isolate
                    .evaluateJavaScriptAsync(source + "\n; typeof engine")
                    .get(TIMEOUT_SECONDS, TimeUnit.SECONDS)
                if (defined == "object") {
                    Engine(sandbox, isolate)
                } else {
                    isolate.close()
                    sandbox.close()
                    null
                }
            } catch (e: Exception) {
                null
            }
        }
    }

    /** Evaluate a script and return its value; a JSON string is the common case. */
    fun evaluate(script: String): String =
        isolate.evaluateJavaScriptAsync(script).get(TIMEOUT_SECONDS, TimeUnit.SECONDS)

    override fun close() {
        isolate.close()
        sandbox.close()
    }
}
