// The copy ported from the web, against the web's own outputs.

import Foundation
import Testing
import RubeModels
@testable import RubeAPI

@Test func roomFiltersReadLikeTheWeb() {
    #expect(MatchText.pills(MatchFilters()) == [])
    #expect(MatchText.pills(MatchFilters(genres: ["Comedy", "Drama", "Horror"], maxMinutes: 120, minYear: 2015)) == ["Comedy, Drama +1", "Under 2h", "2015 on"])
    #expect(MatchText.pills(MatchFilters(maxMinutes: 90, maxYear: 1999)) == ["Under 1h 30m", "Before 2000"])
    #expect(MatchText.pills(MatchFilters(minYear: 1990, maxYear: 1999, minRating: 7)) == ["1990–1999", "Rated 7+"])
}

@Test func aFilmsMetaSkipsWhatIsUnknown() {
    #expect(MatchText.filmMeta(year: 1999, rating: 7.8, durationMs: 8_160_000, contentRating: "R") == "1999 · 7.8 · 2h 16m · R")
    #expect(MatchText.filmMeta(year: nil, rating: nil, durationMs: 2_700_000, contentRating: nil) == "45m")
}

@Test func thePlexLinkEncodesTheKey() {
    #expect(MatchText.plexLink(serverID: "abc", ratingKey: "42")?.absoluteString
        == "https://app.plex.tv/desktop/#!/server/abc/details?key=%2Flibrary%2Fmetadata%2F42")
}

@Test func dataURLsDecode() {
    #expect(DataURL.decode("data:text/plain;base64,aGk=") == Data("hi".utf8))
    #expect(DataURL.decode("data:text/plain,a%20b") == Data("a b".utf8))
    #expect(DataURL.decode("https://x/y.png") == nil)
}

@Test func adminImagesGoThroughTheProxy() {
    let url = AdminURLs.plexImage(base: URL(string: "http://tb.lan:3000")!, path: "/library/metadata/5/thumb/1?x=1")
    #expect(url?.absoluteString == "http://tb.lan:3000/api/plex-image?path=%2Flibrary%2Fmetadata%2F5%2Fthumb%2F1%3Fx%3D1")
    #expect(AdminURLs.plexImage(base: URL(string: "http://tb.lan")!, path: nil) == nil)
    #expect(AdminURLs.web(base: URL(string: "http://tb.lan:3000")!, path: "/rules?q=x")?.absoluteString == "http://tb.lan:3000/rules?q=x")
}

@Test func durationsAreShort() {
    #expect(Durations.short(ms: 45 * 60_000) == "45m")
    #expect(Durations.short(ms: 200 * 60_000) == "3h 20m")
    #expect(Durations.short(ms: 52 * 3_600_000) == "2d 4h")
}
