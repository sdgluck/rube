// The copy ported from the web, against the web's own outputs. From
// `FormattingTests.swift`.
package fyi.rube.api

import fyi.rube.model.MatchFilters
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FormattingTest {
    @Test
    fun roomFiltersReadLikeTheWeb() {
        assertEquals(emptyList<String>(), MatchText.pills(MatchFilters()))
        assertEquals(
            listOf("Comedy, Drama +1", "Under 2h", "2015 on"),
            MatchText.pills(MatchFilters(genres = listOf("Comedy", "Drama", "Horror"), maxMinutes = 120.0, minYear = 2015.0)),
        )
        assertEquals(listOf("Under 1h 30m", "Before 2000"), MatchText.pills(MatchFilters(maxMinutes = 90.0, maxYear = 1999.0)))
        assertEquals(listOf("1990–1999", "Rated 7+"), MatchText.pills(MatchFilters(minYear = 1990.0, maxYear = 1999.0, minRating = 7.0)))
        assertEquals(listOf("Rated 6.5+"), MatchText.pills(MatchFilters(minRating = 6.5)))
    }

    @Test
    fun aFilmsMetaSkipsWhatIsUnknown() {
        assertEquals("1999 · 7.8 · 2h 16m · R", MatchText.filmMeta(1999, 7.8, 8_160_000.0, "R"))
        assertEquals("45m", MatchText.filmMeta(null, null, 2_700_000.0, null))
    }

    @Test
    fun thePlexLinkEncodesTheKey() {
        assertEquals("https://app.plex.tv/desktop/#!/server/abc/details?key=%2Flibrary%2Fmetadata%2F42", MatchText.plexLink("abc", "42"))
    }

    @Test
    fun dataUrlsDecode() {
        assertArrayEquals("hi".toByteArray(), DataUrl.decode("data:text/plain;base64,aGk="))
        assertArrayEquals("a b".toByteArray(), DataUrl.decode("data:text/plain,a%20b"))
        assertNull(DataUrl.decode("https://x/y.png"))
    }

    @Test
    fun adminImagesGoThroughTheProxy() {
        assertEquals(
            "http://tb.lan:3000/api/plex-image?path=%2Flibrary%2Fmetadata%2F5%2Fthumb%2F1%3Fx%3D1",
            AdminUrls.plexImage("http://tb.lan:3000", "/library/metadata/5/thumb/1?x=1"),
        )
        assertNull(AdminUrls.plexImage("http://tb.lan", null))
        assertEquals("http://tb.lan:3000/rules?q=x", AdminUrls.web("http://tb.lan:3000", "/rules?q=x"))
    }

    @Test
    fun postersAreSignedPathsOnThePortal() {
        assertEquals("http://tb.lan:3100/api/match/poster/1?sig=x", PortalUrls.poster("http://tb.lan:3100", "/api/match/poster/1?sig=x"))
        assertEquals("https://img/x.jpg", PortalUrls.poster("http://tb.lan:3100", "https://img/x.jpg"))
    }

    @Test
    fun durationsAreShort() {
        assertEquals("45m", Durations.short(45 * 60_000.0))
        assertEquals("3h 20m", Durations.short(200 * 60_000.0))
        assertEquals("2d 4h", Durations.short(52 * 3_600_000.0))
    }

    @Test
    fun aConnectionShowsItsHostAndPort() {
        assertEquals("10.0.2.2:39312", ServerConnection(ServerProduct.PORTAL, "http://10.0.2.2:39312").displayHost)
        assertEquals("tb.example.com", ServerConnection(ServerProduct.PORTAL, "https://tb.example.com").displayHost)
    }
}
