package com.azuretek.cuate

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Exit reasons, read from Android's own process-exit history.
 *
 * Android hands an app the reasons its earlier processes ended through
 * ActivityManager.getHistoricalProcessExitReasons, which is the same posture as
 * the iOS shell reading MetricKit: the record of a crash, an ANR or a
 * low-memory kill arrives on the next launch and is written to the app's own
 * storage. The files stay on the device; nothing is sent anywhere, which is the
 * same posture the rest of the app takes with anything it keeps.
 */
object Diagnostics {
    private const val DIR = "diagnostics"

    /** The recent exit reasons for this app, as a JSON array. */
    fun exitReasons(context: Context, limit: Int = 5): String {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return "[]"
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return "[]"
        val reasons = try {
            manager.getHistoricalProcessExitReasons(context.packageName, 0, limit)
        } catch (e: Exception) {
            emptyList()
        }
        val array = JSONArray()
        for (info in reasons) {
            array.put(
                JSONObject()
                    .put("timestamp", info.timestamp)
                    .put("reason", info.reason)
                    .put("importance", info.importance)
                    .put("description", info.description ?: JSONObject.NULL),
            )
        }
        return array.toString()
    }

    /** Write the reasons to the app's own storage when there are any; returns the file name. */
    fun remember(context: Context): String? {
        val reasons = exitReasons(context)
        if (reasons == "[]") return null
        val directory = File(context.filesDir, DIR).apply { mkdirs() }
        val file = File(directory, "exit-" + System.currentTimeMillis() + ".json")
        return try {
            file.writeText(reasons)
            file.name
        } catch (e: Exception) {
            null
        }
    }
}
