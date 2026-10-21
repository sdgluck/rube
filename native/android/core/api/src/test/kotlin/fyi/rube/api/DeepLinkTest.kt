// Links come from any app and any QR code, so the parser is tested for what
// it refuses as much as for what it reads. From `DeepLinkTests.swift`.
package fyi.rube.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepLinkTest {
    private fun parse(raw: String, debug: Boolean = false) = DeepLink.parse(raw, allowPlexTvOverride = debug)

    @Test
    fun connectCarriesBothAddresses() {
        assertEquals(
            DeepLink.Connect(ConnectLink(admin = "http://192.168.1.10:3000", portal = "http://192.168.1.10:3100")),
            parse("rube://connect?admin=http%3A%2F%2F192.168.1.10%3A3000&portal=http%3A%2F%2F192.168.1.10%3A3100"),
        )
    }

    @Test
    fun connectWithOnlyThePortal() {
        assertEquals(DeepLink.Connect(ConnectLink(portal = "https://tb.example.com")), parse("rube://connect?portal=https://tb.example.com/"))
    }

    @Test
    fun connectNeedsAtLeastOneUsableAddress() {
        assertNull(parse("rube://connect"))
        assertNull(parse("rube://connect?admin=javascript:alert(1)"))
        assertNull(parse("rube://connect?portal=ftp://x"))
    }

    @Test
    fun otherSpellingsOfTheRoute() {
        val want = DeepLink.Connect(ConnectLink(portal = "http://tb.lan:3100"))
        assertEquals(want, parse("rube:connect?portal=http://tb.lan:3100"))
        assertEquals(want, parse("rube:///connect?portal=http://tb.lan:3100"))
        assertEquals(want, parse("RUBE://Connect?portal=http://tb.lan:3100"))
    }

    @Test
    fun theDevelopmentPlexTvOnlySurvivesInADebugBuild() {
        val raw = "rube://connect?admin=http%3A%2F%2F127.0.0.1%3A39311&portal=http%3A%2F%2F127.0.0.1%3A39312&plexTv=http%3A%2F%2F127.0.0.1%3A39313"
        val debug = (parse(raw, debug = true) as DeepLink.Connect).link
        assertEquals("http://127.0.0.1:39313", debug.plexTv)
        val release = (parse(raw, debug = false) as DeepLink.Connect).link
        assertNull(release.plexTv)
        assertEquals("http://127.0.0.1:39311", release.admin)
    }

    @Test
    fun anotherSchemeIsIgnored() {
        assertNull(parse("rube-portal://connect?server=http://x"))
        assertNull(parse("rube://open/rules"))
        assertNull(parse("not a url at all"))
    }

    @Test
    fun aMalformedEscapeIsRefusedWhole() {
        assertNull(parse("rube://connect?portal=http%3A%2F%2Ftb.lan%G1"))
    }

    @Test
    fun aMatchLinkNamesTheRoomAndItsSecret() {
        assertEquals(
            DeepLink.Match(MatchLink(server = "http://tb.lan:3100", code = "ABCD", invite = "s3cret")),
            parse("rube://match?server=http%3A%2F%2Ftb.lan%3A3100&code=abcd&invite=s3cret"),
        )
        assertEquals(DeepLink.Match(MatchLink(server = "http://tb.lan:3100", code = "ABCD", invite = null)), parse("rube://match?server=http://tb.lan:3100&code=ABCD"))
    }

    @Test
    fun aMatchLinkWithABadCodeIsRefused() {
        // 0 and O are not in the alphabet; codes are read aloud.
        assertNull(parse("rube://match?server=http://tb.lan&code=AB0D"))
        assertNull(parse("rube://match?server=http://tb.lan&code=ABCDE"))
        assertNull(parse("rube://match?code=ABCD"))
    }

    @Test
    fun theWebInviteMeansTheSame() {
        assertEquals(MatchLink("https://portal.example.com", "WXYZ", "abc123"), DeepLink.parseWebInvite("https://portal.example.com/#match/WXYZ/abc123"))
        assertEquals(MatchLink("http://192.168.1.2:3100", "WXYZ", null), DeepLink.parseWebInvite("http://192.168.1.2:3100/#match/wxyz"))
        assertEquals(
            DeepLink.Match(MatchLink("https://portal.example.com", "WXYZ", "abc123")),
            parse("https://portal.example.com/#match/WXYZ/abc123"),
        )
        assertNull(DeepLink.parseWebInvite("https://portal.example.com/#collections"))
        assertNull(DeepLink.parseWebInvite("https://portal.example.com/"))
    }

    @Test
    fun typingACodeKeepsOnlyTheAlphabet() {
        assertEquals("ABCD", MatchCode.filterTyping("ab-0c1dz"))
        assertEquals("WXYZ", MatchCode.normalise("wxyz"))
    }

    @Test
    fun theSettingsCodeRoundTrips() {
        val url = DeepLink.connectUrl(admin = "http://192.168.1.10:3000", portal = null)
        assertEquals(DeepLink.Connect(ConnectLink(admin = "http://192.168.1.10:3000")), parse(url))
    }

    @Test
    fun theAppsOwnMatchLinkRoundTrips() {
        val link = MatchLink("http://10.0.2.2:39312", "WXYZ", "a+b/c")
        assertEquals(DeepLink.Match(link), parse(DeepLink.matchUrl(link)))
    }
}
