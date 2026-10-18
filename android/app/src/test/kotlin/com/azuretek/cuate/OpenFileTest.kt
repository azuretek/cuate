package com.azuretek.cuate

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

// Open in (issue 374): the copy the Open with chooser is offered is written under the file's own name, in a folder of
// its own under the shared cache folder, and a name or bytes that could do harm write nothing.
class OpenFileTest {
    @get:Rule
    val cache = TemporaryFolder()

    @Test
    fun aCopyIsWrittenUnderItsOwnNameInAFolderOfItsOwn() {
        val bytes = "%PDF-1.4".toByteArray()
        val a = OpenFile.stage(cache.root, "booking.pdf", bytes)!!
        val b = OpenFile.stage(cache.root, "booking.pdf", bytes)!!
        assertEquals("booking.pdf", a.name)
        assertArrayEquals(bytes, a.readBytes())
        assertNotEquals("two files with one name never meet", a.parentFile, b.parentFile)
        assertEquals("every copy lives in the folder the provider shares", java.io.File(cache.root, OpenFile.FOLDER), a.parentFile!!.parentFile)
        assertTrue(OpenFile.clear(cache.root))
        assertFalse(a.exists())
    }

    @Test
    fun aNameCannotLeaveItsFolderAndIsNeverEmpty() {
        assertEquals("passwd", OpenFile.safeName("../../etc/passwd"))
        assertEquals("notes.txt", OpenFile.safeName("dir\\notes.txt"))
        assertEquals("a_b.txt", OpenFile.safeName("a:b.txt"))
        assertEquals("Attachment", OpenFile.safeName(""))
        assertEquals("Attachment", OpenFile.safeName(".."))
    }

    @Test
    fun noBytesWriteNothing() {
        assertNull(OpenFile.stage(cache.root, "x.pdf", ByteArray(0)))
        assertFalse(java.io.File(cache.root, OpenFile.FOLDER).exists())
    }
}

// Throwaway, for issue 468's proof: a deliberately red android leg, so the platforms status posts a failure. Removed with the pull request.
class DeliberatelyRedForIssue468Test {
    @org.junit.Test
    fun theAndroidLegIsRedOnPurpose() {
        org.junit.Assert.fail("deliberately red for issue 468's proof of the platforms status")
    }
}
