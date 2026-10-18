// Links come from any app and any QR code, so the parser is tested for what
// it refuses as much as for what it reads.

import Foundation
import Testing
@testable import TinkerbellAPI

@Test func connectCarriesBothAddresses() {
    let link = DeepLink.parse("tinkerbell://connect?admin=http%3A%2F%2F192.168.1.10%3A3000&portal=http%3A%2F%2F192.168.1.10%3A3100", allowPlexTvOverride: false)
    #expect(link == .connect(ConnectLink(admin: "http://192.168.1.10:3000", portal: "http://192.168.1.10:3100")))
}

@Test func connectWithOnlyThePortal() {
    #expect(DeepLink.parse("tinkerbell://connect?portal=https://tb.example.com/", allowPlexTvOverride: false)
        == .connect(ConnectLink(portal: "https://tb.example.com")))
}

@Test func connectNeedsAtLeastOneUsableAddress() {
    #expect(DeepLink.parse("tinkerbell://connect", allowPlexTvOverride: false) == nil)
    #expect(DeepLink.parse("tinkerbell://connect?admin=javascript:alert(1)", allowPlexTvOverride: false) == nil)
    #expect(DeepLink.parse("tinkerbell://connect?portal=ftp://x", allowPlexTvOverride: false) == nil)
}

@Test func otherSpellingsOfTheRoute() {
    let want = DeepLink.connect(ConnectLink(portal: "http://tb.lan:3100"))
    #expect(DeepLink.parse("tinkerbell:connect?portal=http://tb.lan:3100", allowPlexTvOverride: false) == want)
    #expect(DeepLink.parse("tinkerbell:///connect?portal=http://tb.lan:3100", allowPlexTvOverride: false) == want)
    #expect(DeepLink.parse("TINKERBELL://Connect?portal=http://tb.lan:3100", allowPlexTvOverride: false) == want)
}

@Test func theDevelopmentPlexTvOnlySurvivesInADebugBuild() {
    let raw = "tinkerbell://connect?admin=http%3A%2F%2F127.0.0.1%3A39311&portal=http%3A%2F%2F127.0.0.1%3A39312&plexTv=http%3A%2F%2F127.0.0.1%3A39313"
    guard case .connect(let debug)? = DeepLink.parse(raw, allowPlexTvOverride: true) else { Issue.record("no link"); return }
    #expect(debug.plexTv == URL(string: "http://127.0.0.1:39313"))
    guard case .connect(let release)? = DeepLink.parse(raw, allowPlexTvOverride: false) else { Issue.record("no link"); return }
    #expect(release.plexTv == nil)
    #expect(release.admin == "http://127.0.0.1:39311")
}

@Test func anotherSchemeIsIgnored() {
    #expect(DeepLink.parse("tinkerbell-portal://connect?server=http://x", allowPlexTvOverride: false) == nil)
    #expect(DeepLink.parse("tinkerbell://open/rules", allowPlexTvOverride: false) == nil)
    #expect(DeepLink.parse("not a url at all", allowPlexTvOverride: false) == nil)
}

@Test func aMatchLinkNamesTheRoomAndItsSecret() {
    #expect(DeepLink.parse("tinkerbell://match?server=http%3A%2F%2Ftb.lan%3A3100&code=abcd&invite=s3cret", allowPlexTvOverride: false)
        == .match(MatchLink(server: "http://tb.lan:3100", code: "ABCD", invite: "s3cret")))
    #expect(DeepLink.parse("tinkerbell://match?server=http://tb.lan:3100&code=ABCD", allowPlexTvOverride: false)
        == .match(MatchLink(server: "http://tb.lan:3100", code: "ABCD", invite: nil)))
}

@Test func aMatchLinkWithABadCodeIsRefused() {
    // 0 and O are not in the alphabet; codes are read aloud.
    #expect(DeepLink.parse("tinkerbell://match?server=http://tb.lan&code=AB0D", allowPlexTvOverride: false) == nil)
    #expect(DeepLink.parse("tinkerbell://match?server=http://tb.lan&code=ABCDE", allowPlexTvOverride: false) == nil)
    #expect(DeepLink.parse("tinkerbell://match?code=ABCD", allowPlexTvOverride: false) == nil)
}

@Test func theWebInviteMeansTheSame() {
    #expect(DeepLink.parseWebInvite("https://portal.example.com/#match/WXYZ/abc123")
        == MatchLink(server: "https://portal.example.com", code: "WXYZ", invite: "abc123"))
    #expect(DeepLink.parseWebInvite("http://192.168.1.2:3100/#match/wxyz")
        == MatchLink(server: "http://192.168.1.2:3100", code: "WXYZ", invite: nil))
    #expect(DeepLink.parse("https://portal.example.com/#match/WXYZ/abc123", allowPlexTvOverride: false)
        == .match(MatchLink(server: "https://portal.example.com", code: "WXYZ", invite: "abc123")))
    #expect(DeepLink.parseWebInvite("https://portal.example.com/#collections") == nil)
    #expect(DeepLink.parseWebInvite("https://portal.example.com/") == nil)
}

@Test func typingACodeKeepsOnlyTheAlphabet() {
    #expect(MatchCode.filterTyping("ab-0c1dz") == "ABCD")
    #expect(MatchCode.normalise("wxyz") == "WXYZ")
}

@Test func theSettingsCodeRoundTrips() {
    let url = DeepLink.connectURL(admin: "http://192.168.1.10:3000", portal: nil)
    #expect(DeepLink.parse(url!.absoluteString, allowPlexTvOverride: false) == .connect(ConnectLink(admin: "http://192.168.1.10:3000")))
}
