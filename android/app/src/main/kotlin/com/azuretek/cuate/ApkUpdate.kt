package com.azuretek.cuate

import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * What a release's manifest says about its APK: the version, the commit, the file, its size, its SHA-256 and the
 * SHA-256 of the certificate that signed it. Written by the release pipeline (android.yml) beside the APK.
 */
data class ApkManifest(val version: String, val commit: String, val file: String, val size: Long, val sha256: String, val signer: String) {
    companion object {
        fun parse(text: String): ApkManifest? = try {
            val json = JSONObject(text)
            ApkManifest(
                json.optString("version"), json.optString("commit"), json.optString("file"),
                json.optLong("size", -1), json.optString("sha256"), json.optString("signer"),
            )
        } catch (e: Exception) {
            null
        }
    }
}

/**
 * The checks that stand between a downloaded APK and the system installer (issue 192). Pure, so each is tested on the
 * JVM with no device: the manifest is the release's, the bytes are the ones it describes, and the APK is signed by the
 * same certificate as the installed app and the one the manifest names. Android refuses an update signed by another
 * key anyway; checking first means the person is never asked to confirm an install that cannot succeed. The manifest
 * rule is apkManifestProblem in core/app/rules/updates.js, and the tests hold both to the same cases.
 */
object ApkVerify {
    private val HEX64 = Regex("^[a-f0-9]{64}$")
    private val COMMIT = Regex("^[a-f0-9]{40}$")

    fun manifestProblem(manifest: ApkManifest?, version: String, slug: String): String? {
        if (manifest == null) return "the manifest is not an object"
        if (manifest.version != version) return "the manifest names another version: " + manifest.version
        // A test build's version names its commit, so the two must agree; a stable version names none to compare.
        val dev = Releases.channelOf(version) == "dev"
        if (!COMMIT.matches(manifest.commit) || (dev && !version.endsWith("." + manifest.commit.take(10)))) return "the manifest's commit is not the one the version names"
        if (manifest.file != slug + "-android-" + version + ".apk") return "the manifest names an unexpected file: " + manifest.file
        if (manifest.size <= 0) return "the manifest carries no size"
        if (!HEX64.matches(manifest.sha256)) return "the manifest carries no SHA-256 digest"
        if (!HEX64.matches(manifest.signer)) return "the manifest names no signer certificate"
        return null
    }

    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    fun sha256(bytes: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))

    /** The downloaded bytes against the manifest: the size first, then the digest, and nothing passes on a missing value. */
    fun digestProblem(manifest: ApkManifest, size: Long, sha256: String): String? {
        if (size != manifest.size) return "the download is " + size + " bytes, but the release says " + manifest.size
        if (sha256.isEmpty() || !sha256.equals(manifest.sha256, ignoreCase = true)) return "the download does not match the release's SHA-256 digest"
        return null
    }

    /** The APK's signer against the installed app's and the manifest's, each a set of certificate SHA-256 digests. */
    fun signerProblem(apkSigners: Set<String>, installedSigners: Set<String>, manifestSigner: String): String? {
        if (apkSigners.isEmpty()) return "the download carries no signature"
        if (installedSigners.isEmpty()) return "this app's own signature could not be read"
        if (apkSigners != installedSigners) return "the download is signed by a different key than this app"
        if (manifestSigner.lowercase() !in apkSigners) return "the download is not signed by the key the release names"
        return null
    }
}

/** How a release is read: the public HTTPS one, or a test's own, set by an instrumented test in the test process. */
interface ReleaseTransport {
    class Body(val stream: InputStream, val length: Long)

    fun text(url: String): String
    fun open(url: String): Body

    companion object {
        /** Set only by an instrumented test, in its own process; no intent, setting or page can reach it. */
        @Volatile
        var override: ReleaseTransport? = null

        fun current(): ReleaseTransport = override ?: Https
    }

    object Https : ReleaseTransport {
        private fun connect(url: String): HttpURLConnection {
            require(url.startsWith("https://")) { "only https is fetched" }
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = 15000
            connection.readTimeout = 30000
            connection.instanceFollowRedirects = true
            connection.useCaches = false
            val code = connection.responseCode
            if (code !in 200..299) {
                connection.disconnect()
                throw IllegalStateException("the release answered " + code)
            }
            return connection
        }

        override fun text(url: String): String {
            val connection = connect(url)
            return try {
                connection.inputStream.bufferedReader().use { it.readText() }
            } finally {
                connection.disconnect()
            }
        }

        override fun open(url: String): Body {
            val connection = connect(url)
            return Body(connection.inputStream, connection.contentLengthLong)
        }
    }
}

/**
 * Android's half of updating in the app (issue 192): download the release's signed APK, verify it, and hand it to the
 * system installer, which asks the person to confirm. Progress and every outcome go to the page as update.state
 * events, so the notice and About's button show them in core's words.
 */
class ApkUpdater(
    private val context: Context,
    private val emit: (JSONObject) -> Unit,
) {
    companion object {
        const val ACTION_STATUS = "com.azuretek.cuate.UPDATE_STATUS"
        private const val PROGRESS_MS = 250L

        /** The updater the install status reaches, set while the activity is alive. */
        @Volatile
        var live: ApkUpdater? = null
    }

    @Volatile private var busy = false
    @Volatile private var ready: File? = null
    @Volatile private var readyVersion: String? = null
    @Volatile private var installAfterPermission = false
    private val main = Handler(Looper.getMainLooper())

    private fun state(state: String, version: String?): JSONObject {
        val json = JSONObject().put("state", state).put("canInstall", true).put("via", "apk")
        if (version != null) json.put("version", version)
        return json
    }

    private fun fail(version: String?, why: String) {
        emit(state("error", version).put("detail", why))
    }

    /** Starts fetching the named release; answers whether it was taken. A second press while one runs is the same one. */
    fun download(version: String): Boolean {
        if (!Releases.VERSION.matches(version)) return false
        if (busy) return true
        busy = true
        Thread {
            try {
                fetch(version)
            } catch (e: Exception) {
                fail(version, "the download stopped: " + (e.message ?: e.javaClass.simpleName))
            } finally {
                busy = false
            }
        }.apply { name = "apk-update" }.start()
        return true
    }

    private fun fetch(version: String) {
        val assets = Releases.assets(Releases.specText(context.assets), Naming.repo(context.assets), slug(), version)
            ?: return fail(version, "the release's address could not be formed")
        val transport = ReleaseTransport.current()
        emit(state("downloading", version).put("percent", 0))
        val manifest = ApkManifest.parse(transport.text(assets.manifestUrl))
        ApkVerify.manifestProblem(manifest, version, slug())?.let { return fail(version, it) }
        manifest!!
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val part = File(dir, assets.apkName + ".part")
        val digest = MessageDigest.getInstance("SHA-256")
        var transferred = 0L
        var last = 0L
        transport.open(assets.apkUrl).stream.use { input ->
            part.outputStream().use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    transferred += n
                    if (transferred > manifest.size) return fail(version, "the download is larger than the release says")
                    digest.update(buffer, 0, n)
                    output.write(buffer, 0, n)
                    val now = System.currentTimeMillis()
                    if (now - last >= PROGRESS_MS) {
                        last = now
                        emit(state("downloading", version).put("percent", transferred.toDouble() / manifest.size).put("transferred", transferred).put("total", manifest.size))
                    }
                }
            }
        }
        emit(state("downloading", version).put("percent", 1).put("transferred", transferred).put("total", manifest.size))
        ApkVerify.digestProblem(manifest, transferred, ApkVerify.hex(digest.digest()))?.let { part.delete(); return fail(version, it) }
        val apk = File(dir, assets.apkName)
        if (!part.renameTo(apk)) return fail(version, "the download could not be kept")
        val archive = archiveInfo(apk)
        if (archive == null || archive.packageName != context.packageName) {
            apk.delete()
            return fail(version, "the download is not an update to this app")
        }
        ApkVerify.signerProblem(signers(archive), signers(installedInfo()), manifest.signer)?.let { apk.delete(); return fail(version, it) }
        ready = apk
        readyVersion = version
        emit(state("ready", version))
    }

    private fun slug(): String = try {
        JSONObject(BundledSpec.text(context.assets, "spec/naming.json")).optString("slug")
    } catch (e: Exception) {
        ""
    }

    private val signingFlags: Int
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES

    private fun archiveInfo(apk: File): PackageInfo? = context.packageManager.getPackageArchiveInfo(apk.path, signingFlags)

    private fun installedInfo(): PackageInfo? = try {
        context.packageManager.getPackageInfo(context.packageName, signingFlags)
    } catch (e: Exception) {
        null
    }

    private fun signers(info: PackageInfo?): Set<String> {
        if (info == null) return emptySet()
        val certificates = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signing = info.signingInfo ?: return emptySet()
            if (signing.hasMultipleSigners()) signing.apkContentsSigners else signing.signingCertificateHistory
        } else {
            @Suppress("DEPRECATION") info.signatures
        }
        return certificates?.map { ApkVerify.sha256(it.toByteArray()) }?.toSet() ?: emptySet()
    }

    /**
     * Hands the verified APK to the system installer. Android asks once whether this app may install apps; when it
     * may not yet, the person is told why in the app's own words first, and the install continues when they return
     * from the setting.
     */
    fun install(): Boolean {
        val apk = ready ?: return false
        if (!apk.exists()) return false
        if (!context.packageManager.canRequestPackageInstalls()) {
            main.post { explain() }
            return true
        }
        main.post { commit(apk) }
        return true
    }

    /** The activity came back to the front: an install waiting on the permission continues if it was granted. */
    fun resumed() {
        if (!installAfterPermission) return
        installAfterPermission = false
        if (context.packageManager.canRequestPackageInstalls()) install()
    }

    private fun explain() {
        val product = Naming.product(context.assets)
        AlertDialog.Builder(context)
            .setTitle("Allow " + product + " to install its updates")
            .setMessage(
                product + " downloads its newer version from its release, checks it is signed by the same key as this app, " +
                    "and hands it to Android, which asks you to confirm. Android needs your permission once: allow " + product +
                    " on the next screen, then come back.",
            )
            .setPositiveButton("Continue") { _, _ ->
                installAfterPermission = true
                try {
                    context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName)))
                } catch (e: Exception) {
                    installAfterPermission = false
                    fail(readyVersion, "the setting that allows installs could not be opened")
                }
            }
            .setNegativeButton("Not now", null)
            .show()
    }

    private fun commit(apk: File) {
        try {
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(context.packageName)
            val id = installer.createSession(params)
            installer.openSession(id).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("update.apk", 0, apk.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                val status = Intent(context, InstallStatusReceiver::class.java).setAction(ACTION_STATUS)
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                session.commit(PendingIntent.getBroadcast(context, id, status, flags).intentSender)
            }
        } catch (e: Exception) {
            fail(readyVersion, "Android's installer did not take the update: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    /** What the installer reported: it needs the person's confirmation, it failed, or it is done. */
    fun status(intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            else -> fail(readyVersion, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Android did not install the update")
        }
    }
}

/**
 * The installer's answer. Not exported: only the PendingIntent this app made can reach it, so nothing outside the app
 * can hand it an intent to start.
 */
class InstallStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ApkUpdater.ACTION_STATUS) ApkUpdater.live?.status(intent)
    }
}
