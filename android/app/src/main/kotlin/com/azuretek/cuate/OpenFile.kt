package com.azuretek.cuate

import java.io.File
import java.util.UUID

/**
 * Open in (issue 374): a file from a conversation is written to a folder of its own under the app's cache, shared
 * through the provider the manifest declares, and offered to the system's Open with chooser. The cache is the system's
 * to clear, and each launch clears what an earlier one left.
 */
object OpenFile {
    /** The folder under the cache every copy Open in writes lives under; res/xml/file_paths.xml shares it. */
    const val FOLDER = "open"

    /**
     * The name a copy is written under: the file's own last path part, with nothing that could leave its folder or that
     * a file system refuses, and never empty, so the app it opens in shows the name it was sent under.
     */
    fun safeName(name: String): String {
        val last = name.substringAfterLast('/').substringAfterLast('\\')
        val cleaned = last.map { if (it.code < 0x20 || it in "<>:\"|?*") '_' else it }.joinToString("").trim('.', ' ')
        return if (cleaned.isEmpty()) "Attachment" else cleaned.take(200)
    }

    /**
     * Writes the bytes under their name in a fresh folder of their own, so two files with one name never meet, and
     * answers the file; null when there are no bytes or they cannot be written.
     */
    fun stage(cache: File, name: String, bytes: ByteArray): File? {
        if (bytes.isEmpty()) return null
        return try {
            val dir = File(File(cache, FOLDER), UUID.randomUUID().toString())
            if (!dir.mkdirs()) return null
            File(dir, safeName(name)).apply { writeBytes(bytes) }
        } catch (e: Exception) {
            null
        }
    }

    /** Removes every copy an earlier run wrote. */
    fun clear(cache: File): Boolean = File(cache, FOLDER).deleteRecursively()
}
