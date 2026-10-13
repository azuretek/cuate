package com.azuretek.cuate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Push notifications (issue 347): the phone opens exactly what the server seals. The sealed text below was made by the
// server's own seal() (server/src/push.js) with a synthetic key of 32 bytes of 7, so a change to either side's layout
// fails here.
class PushTest {
    private val key = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"
    private val sealed = "rIMeuPzOgxkccgiR6wEeU3s9DNfYTPjpJRVr0I7yf1nxQvdFK8JffzxaB0D8zy93JbvK2sLLvIquUf7k9-Cx0k11Hm9qDV10RJ2_KNVrgyogN6nWJPDMXkxACAfMnMb48lS-8gAkMtGmeuGsdi5YkRZGgik"

    @Test
    fun opensWhatTheServerSealed() {
        val notice = Push.open(sealed, key)!!
        assertEquals("7", notice.chatId)
        assertEquals("m1", notice.messageId)
        assertEquals("Avery Quinn", notice.title)
        assertEquals("Synthetic push text", notice.body)
    }

    @Test
    fun aWrongKeyOrATamperedNotificationOpensNothing() {
        assertNull(Push.open(sealed, "A".repeat(43)))
        val flipped = sealed.substring(0, 20) + (if (sealed[20] == 'A') 'B' else 'A') + sealed.substring(21)
        assertNull(Push.open(flipped, key))
        assertNull(Push.open("", key))
        assertNull(Push.open(sealed, null))
    }
}
