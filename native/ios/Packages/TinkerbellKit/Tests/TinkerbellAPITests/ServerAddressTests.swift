// Golden vectors for reading a typed address and judging the server behind
// it, first written for the retired Capacitor client and kept as the
// reference: candidates, product/version checks, the `exchange` capability,
// the admin's extra fields, and where an address points. The same cases as
// `ServerAddressTest.kt`; change both together.

import Foundation
import Testing
@testable import TinkerbellAPI

@Test func triesHttpsThenHttpWhenNoSchemeWasTyped() {
    #expect(ServerAddress.candidates(" 192.168.1.10:3000 ") == ["https://192.168.1.10:3000", "http://192.168.1.10:3000"])
}

@Test func keepsAnExplicitSchemeAndDropsThePath() {
    #expect(ServerAddress.candidates("http://tb.lan:3000/settings/api") == ["http://tb.lan:3000"])
}

@Test func refusesAnythingThatIsNotHttp() {
    #expect(ServerAddress.candidates("javascript:alert(1)") == [])
    #expect(ServerAddress.candidates("ftp://tb.lan") == [])
    #expect(ServerAddress.candidates("") == [])
}

@Test func anOriginIsWhatABrowserWouldCallIt() {
    #expect(ServerAddress.origin(of: "HTTPS://TB.Example.com:443/x?y#z") == "https://tb.example.com")
    #expect(ServerAddress.origin(of: "http://tb.example.com:80") == "http://tb.example.com")
    #expect(ServerAddress.origin(of: "http://[::1]:3000/") == "http://[::1]:3000")
}

private func info(_ product: String, _ version: String, capabilities: [String]? = ["exchange"], extra: String = "") -> Data {
    let caps = capabilities.map { ",\"capabilities\":[\($0.map { "\"\($0)\"" }.joined(separator: ","))]" } ?? ""
    return Data(#"{"result":{"data":{"product":"\#(product)","version":"\#(version)"\#(caps)\#(extra)}}}"#.utf8)
}

@Test func acceptsTheRightAppAtASupportedVersion() {
    let check = ServerAddress.judge(origin: "https://x", body: info("tinkerbell-admin", ServerAddress.minimumServerVersion), want: .admin)
    #expect(check.info?.origin == "https://x")
    #expect(check.info?.version == ServerAddress.minimumServerVersion)
}

@Test func saysWhenThePortalAddressWasGivenForTheAdmin() {
    #expect(ServerAddress.judge(origin: "https://x", body: info("tinkerbell-portal", "9.0.0"), want: .admin) == .failed(.wrongApp(found: .portal)))
    #expect(ServerAddress.judge(origin: "https://x", body: info("tinkerbell-admin", "9.0.0"), want: .portal) == .failed(.wrongApp(found: .admin)))
}

@Test func refusesAServerOlderThanTheAppSupports() {
    #expect(ServerAddress.judge(origin: "https://x", body: info("tinkerbell-admin", "0.1.0"), want: .admin) == .failed(.tooOld(version: "0.1.0")))
}

@Test func anythingElseIsNotTinkerbell() {
    #expect(ServerAddress.judge(origin: "https://x", body: Data(#"{"hello":"world"}"#.utf8), want: .admin) == .failed(.notTinkerbell))
    #expect(ServerAddress.judge(origin: "https://x", body: Data("<html>".utf8), want: .admin) == .failed(.notTinkerbell))
    #expect(ServerAddress.judge(origin: "https://x", body: info("plex-media-server", "1.0.0"), want: .admin) == .failed(.notTinkerbell))
}

@Test func aServerWithoutExchangeNeedsUpdating() {
    #expect(ServerAddress.judge(origin: "https://x", body: info("tinkerbell-portal", "0.40.0", capabilities: nil), want: .portal) == .failed(.needsUpdate(version: "0.40.0")))
    #expect(ServerAddress.judge(origin: "https://x", body: info("tinkerbell-portal", "0.40.0", capabilities: []), want: .portal) == .failed(.needsUpdate(version: "0.40.0")))
}

@Test func theAdminSaysWhetherSignInIsOnAndWhereThePortalIs() {
    let body = info("tinkerbell-admin", "0.43.0", extra: #","authRequired":false,"portalUrl":"http://192.168.1.2:3100""#)
    let server = ServerAddress.judge(origin: "http://x", body: body, want: .admin).info
    #expect(server?.authRequired == false)
    #expect(server?.portalURL == "http://192.168.1.2:3100")
    let none = ServerAddress.judge(origin: "http://x", body: info("tinkerbell-admin", "0.43.0", extra: #","authRequired":true,"portalUrl":null"#), want: .admin).info
    #expect(none?.portalURL == nil)
}

@Test func compareVersionsIsNumericNotLexical() {
    #expect(ServerAddress.compareVersions("0.10.0", "0.9.9") == 1)
    #expect(ServerAddress.compareVersions("1.0.0-beta", "1.0.0") == 0)
    #expect(ServerAddress.compareVersions("0.35.0", "0.36.0") == -1)
}

@Test func loopbackIsThePhoneItself() {
    for address in ["http://localhost:3000", "http://127.0.0.1:39311", "http://[::1]:3000", "http://app.localhost", "http://0.0.0.0:3000"] {
        #expect(ServerAddress.isLoopback(address), "\(address)")
    }
    #expect(!ServerAddress.isLoopback("http://192.168.1.10:3000"))
}

@Test func plainHttpIsOnlyWorthAWarningOffTheLAN() {
    for address in ["http://192.168.1.10:3000", "http://10.0.0.2", "http://172.20.1.1", "http://nas.local:3000", "http://tinkerbell:3000", "http://box.tail1234.ts.net", "http://100.100.1.1"] {
        #expect(!ServerAddress.isUnencryptedRemote(address), "\(address)")
    }
    #expect(ServerAddress.isUnencryptedRemote("http://tinkerbell.example.com"))
    #expect(ServerAddress.isUnencryptedRemote("http://203.0.113.9:3000"))
    #expect(!ServerAddress.isUnencryptedRemote("https://tinkerbell.example.com"))
}

// MARK: The probe over the wire

@Test func theProbeFallsBackToHttpAndJudgesTheAnswer() async {
    let host = uniqueHost()
    StubProtocol.register(host: host) { req in
        if req.url.scheme == "https" { throw URLError(.cannotConnectToHost) }
        return StubResponse(json: #"{"result":{"data":{"product":"tinkerbell-portal","version":"0.43.0","capabilities":["exchange"]}}}"#)
    }
    let check = await ServerProbe(session: StubProtocol.session).probe("\(host):3100", want: .portal)
    #expect(check.info?.origin == "http://\(host):3100")
    #expect(StubProtocol.requests(host: host).map(\.url.absoluteString) == [
        "https://\(host):3100/api/trpc/auth.server",
        "http://\(host):3100/api/trpc/auth.server",
    ])
}

@Test func theProbeKeepsTheMostUsefulFailure() async {
    let host = uniqueHost()
    StubProtocol.register(host: host) { req in
        if req.url.scheme == "https" { throw URLError(.cannotConnectToHost) }
        return StubResponse(json: #"{"result":{"data":{"product":"tinkerbell-admin","version":"0.43.0","capabilities":["exchange"]}}}"#)
    }
    let check = await ServerProbe(session: StubProtocol.session).probe(host, want: .portal)
    #expect(check == .failed(.wrongApp(found: .admin)))
}

@Test func theProbeSaysWhenNothingAnswered() async {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in throw URLError(.timedOut) }
    guard case .failed(.unreachable(let detail)) = await ServerProbe(session: StubProtocol.session).probe(host, want: .portal) else {
        Issue.record("expected unreachable"); return
    }
    #expect(detail == "The server took too long to answer.")
}
