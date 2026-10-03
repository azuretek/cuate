package com.azuretek.cuate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Issue 192: the checks between a downloaded APK and the system installer, on the JVM with no device. The manifest
 * cases are the ones core/test/phone-updates.test.js holds apkManifestProblem to, so the two rules cannot drift.
 */
class ApkVerifyTest {
    private val dev = "0.0.1-dev.98.7699911abc"
    private val sha = "a".repeat(64)
    private val signer = "b".repeat(64)
    private val good = ApkManifest(dev, "7699911abc" + "0".repeat(30), "cuate-android-$dev.apk", 1024, sha, signer)

    @Test
    fun aSoundManifestPasses() {
        assertNull(ApkVerify.manifestProblem(good, dev, "cuate"))
        val stable = good.copy(version = "1.0.0", file = "cuate-android-1.0.0.apk", commit = "f".repeat(40))
        assertNull("a stable version names no commit to compare", ApkVerify.manifestProblem(stable, "1.0.0", "cuate"))
    }

    @Test
    fun aManifestThatDoesNotDescribeTheReleaseIsRefused() {
        assertTrue(ApkVerify.manifestProblem(good.copy(version = "0.0.1-dev.97.370d8cc7a0"), dev, "cuate")!!.contains("version"))
        assertTrue(ApkVerify.manifestProblem(good.copy(file = "../evil.apk"), dev, "cuate")!!.contains("file"))
        assertTrue(ApkVerify.manifestProblem(good.copy(sha256 = "xyz"), dev, "cuate")!!.contains("digest"))
        assertTrue(ApkVerify.manifestProblem(good.copy(signer = ""), dev, "cuate")!!.contains("signer"))
        assertTrue(ApkVerify.manifestProblem(good.copy(size = 0), dev, "cuate")!!.contains("size"))
        assertTrue(ApkVerify.manifestProblem(good.copy(commit = "nope"), dev, "cuate")!!.contains("commit"))
        assertTrue(ApkVerify.manifestProblem(good.copy(commit = "f".repeat(40)), dev, "cuate")!!.contains("commit"))
        assertTrue(ApkVerify.manifestProblem(null, dev, "cuate")!!.contains("manifest"))
    }

    @Test
    fun theManifestIsReadFromTheReleasesJson() {
        val text = """{"version":"$dev","commit":"${"7699911abc" + "0".repeat(30)}","file":"cuate-android-$dev.apk","size":1024,"sha256":"$sha","signer":"$signer"}"""
        assertEquals(good, ApkManifest.parse(text))
        assertNull(ApkManifest.parse("not json"))
    }

    @Test
    fun theDownloadedBytesMustBeTheOnesTheReleaseDescribes() {
        val bytes = "an apk, for the test".toByteArray()
        val digest = ApkVerify.sha256(bytes)
        assertEquals("the digest is lower-case hex", 64, digest.length)
        val manifest = good.copy(size = bytes.size.toLong(), sha256 = digest)
        assertNull(ApkVerify.digestProblem(manifest, bytes.size.toLong(), digest))
        assertNull("case does not matter", ApkVerify.digestProblem(manifest, bytes.size.toLong(), digest.uppercase()))
        assertNotNull("a short download is refused", ApkVerify.digestProblem(manifest, bytes.size - 1L, digest))
        assertNotNull("a changed byte is refused", ApkVerify.digestProblem(manifest, bytes.size.toLong(), ApkVerify.sha256("An apk, for the test".toByteArray())))
        assertNotNull("a missing digest never passes", ApkVerify.digestProblem(manifest, bytes.size.toLong(), ""))
    }

    @Test
    fun theApkMustBeSignedByThisAppsKeyAndTheOneTheReleaseNames() {
        val mine = setOf(signer)
        assertNull(ApkVerify.signerProblem(mine, mine, signer))
        assertNull("case does not matter", ApkVerify.signerProblem(mine, mine, signer.uppercase()))
        assertTrue(ApkVerify.signerProblem(setOf("c".repeat(64)), mine, signer)!!.contains("different key"))
        assertTrue(ApkVerify.signerProblem(mine, mine, "d".repeat(64))!!.contains("release names"))
        assertTrue(ApkVerify.signerProblem(emptySet(), mine, signer)!!.contains("no signature"))
        assertNotNull(ApkVerify.signerProblem(mine, emptySet(), signer))
    }

    @Test
    fun theReleaseAddressesAreTheSpecsTemplatesFilledIn() {
        val spec = File("../../core/spec/releases.json").readText()
        val assets = Releases.assets(spec, "owner/app", "app", dev)!!
        assertEquals("https://github.com/owner/app/releases.atom", assets.feed)
        assertEquals("app-android-$dev.apk", assets.apkName)
        assertEquals("https://github.com/owner/app/releases/download/v$dev/app-android-$dev.apk", assets.apkUrl)
        assertEquals("https://github.com/owner/app/releases/download/v$dev/app-android-$dev.manifest.json", assets.manifestUrl)
        assertNull("a version that is not one never becomes a path", Releases.assets(spec, "owner/app", "app", "../../etc"))
        assertNull("a half-filled address is never fetched", Releases.fill("{repo}/{missing}", mapOf("repo" to "a/b")))
        assertEquals("dev", Releases.channelOf(dev))
        assertEquals("stable", Releases.channelOf("1.0.0"))
    }
}
