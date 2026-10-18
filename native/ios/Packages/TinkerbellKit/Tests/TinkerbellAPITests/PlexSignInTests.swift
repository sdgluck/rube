// The PIN flow against a stub plex.tv: the headers plex.tv requires, the auth
// URL the server would also build, and the poll's three ways out — a token,
// the sheet being closed, and the task being cancelled.

import Foundation
import Synchronization
import Testing
@testable import TinkerbellAPI

private func plex(_ host: String) -> PlexTV {
    PlexTV(clientID: "client-1", override: URL(string: "http://\(host)")!, session: StubProtocol.session)
}

private let fast: PlexPinPoller = {
    var p = PlexPinPoller()
    p.interval = .milliseconds(5)
    p.limit = .seconds(5)
    return p
}()

@Test func creatingAPinSendsTheHeadersPlexWants() async throws {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(status: 201, json: #"{"id":1001,"code":"abcd1234"}"#) }
    let pin = try await plex(host).createPin()
    #expect(pin == PlexPin(id: 1001, code: "abcd1234"))
    let req = try #require(StubProtocol.requests(host: host).first)
    #expect(req.method == "POST")
    #expect(req.url.path == "/api/v2/pins")
    #expect(req.url.query == "strong=true")
    #expect(req.headers["X-Plex-Client-Identifier"] == "client-1")
    #expect(req.headers["X-Plex-Product"] == "Tinkerbell")
    #expect(req.headers["Accept"] == "application/json")
}

@Test func theRealAuthURLMatchesTheServers() {
    let url = PlexTV(clientID: "c id", override: nil).authURL(code: "xy z")
    #expect(url.absoluteString == "https://app.plex.tv/auth#?clientID=c+id&code=xy+z&context%5Bdevice%5D%5Bproduct%5D=Tinkerbell")
    #expect(!url.absoluteString.contains("forwardUrl"))
}

@Test func aDevelopmentPlexTvHasItsOwnAuthPage() {
    let url = PlexTV(clientID: "c", override: URL(string: "http://127.0.0.1:39313")!).authURL(code: "abc")
    #expect(url.absoluteString == "http://127.0.0.1:39313/auth?code=abc")
}

@Test func pollingReturnsTheTokenOnceApproved() async throws {
    let host = uniqueHost()
    let polls = Mutex(0)
    StubProtocol.register(host: host) { req in
        #expect(req.url.path == "/api/v2/pins/7")
        #expect(req.headers["X-Plex-Client-Identifier"] == "client-1")
        let n = polls.withLock { $0 += 1; return $0 }
        return StubResponse(json: n < 3 ? #"{"id":7,"authToken":null}"# : #"{"id":7,"authToken":"plex-tok"}"#)
    }
    let token = try await fast.waitForToken(PlexPin(id: 7, code: "c"), plex: plex(host), sheet: SignInSheetState())
    #expect(token == "plex-tok")
    #expect(polls.withLock { $0 } == 3)
}

@Test func closingTheSheetStopsThePollAfterAGraceCheck() async {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(json: #"{"id":7,"authToken":null}"#) }
    let sheet = SignInSheetState()
    sheet.markClosed()
    await #expect(throws: PlexSignInError.cancelled) {
        try await fast.waitForToken(PlexPin(id: 7, code: "c"), plex: plex(host), sheet: sheet)
    }
    #expect(StubProtocol.requests(host: host).count == fast.checksAfterClose)
}

@Test func anApprovalThatLandsAsTheSheetClosesStillCounts() async throws {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(json: #"{"id":7,"authToken":"late"}"#) }
    let sheet = SignInSheetState()
    sheet.markClosed()
    #expect(try await fast.waitForToken(PlexPin(id: 7, code: "c"), plex: plex(host), sheet: sheet) == "late")
}

@Test func cancellingTheTaskCancelsThePoll() async {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(json: #"{"id":7,"authToken":null}"#) }
    var slow = PlexPinPoller()
    slow.interval = .milliseconds(50)
    let task = Task { try await slow.waitForToken(PlexPin(id: 7, code: "c"), plex: plex(host), sheet: SignInSheetState()) }
    try? await Task.sleep(for: .milliseconds(120))
    task.cancel()
    await #expect(throws: PlexSignInError.cancelled) { try await task.value }
}

@Test func aForgottenPinHasExpired() async {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(status: 404, json: #"{"errors":[]}"#) }
    await #expect(throws: PlexSignInError.expired) {
        try await fast.waitForToken(PlexPin(id: 7, code: "c"), plex: plex(host), sheet: SignInSheetState())
    }
}

@Test func aBlipIsToleratedButAnOutageIsNot() async throws {
    let host = uniqueHost()
    let polls = Mutex(0)
    StubProtocol.register(host: host) { _ in
        let n = polls.withLock { $0 += 1; return $0 }
        return n == 1 ? StubResponse(status: 503, json: "{}") : StubResponse(json: #"{"id":7,"authToken":"ok"}"#)
    }
    #expect(try await fast.waitForToken(PlexPin(id: 7, code: "c"), plex: plex(host), sheet: SignInSheetState()) == "ok")

    let down = uniqueHost()
    StubProtocol.register(host: down) { _ in StubResponse(status: 503, json: "{}") }
    await #expect(throws: PlexSignInError.self) {
        try await fast.waitForToken(PlexPin(id: 7, code: "c"), plex: plex(down), sheet: SignInSheetState())
    }
    #expect(StubProtocol.requests(host: down).count == fast.toleratedFailures + 1)
}

@Test func runningOutOfTimeIsExpiry() async {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(json: #"{"id":7,"authToken":null}"#) }
    var short = fast
    short.limit = .milliseconds(30)
    await #expect(throws: PlexSignInError.expired) {
        try await short.waitForToken(PlexPin(id: 7, code: "c"), plex: plex(host), sheet: SignInSheetState())
    }
}

@Test func headlessApprovalAsksTheMockAsThatAccount() async throws {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(json: "ok") }
    try await plex(host).approveHeadlessly(code: "abc", as: "101")
    let req = try #require(StubProtocol.requests(host: host).first)
    #expect(req.url.path == "/auth")
    #expect(req.url.query == "code=abc&as=101")
}

@Test func headlessApprovalNeedsADevelopmentPlexTv() async {
    await #expect(throws: PlexSignInError.self) {
        try await PlexTV(clientID: "c").approveHeadlessly(code: "abc", as: "1")
    }
}

// MARK: Exchange

@Test func theAdminExchangeReadsOkOpenAndRefused() async {
    let ok = uniqueHost(), open = uniqueHost(), refused = uniqueHost()
    StubProtocol.register(host: ok) { _ in StubResponse(json: #"{"result":{"data":{"status":"ok","username":"sam","token":"t"}}}"#) }
    StubProtocol.register(host: open) { _ in StubResponse(json: #"{"result":{"data":{"status":"open"}}}"#) }
    StubProtocol.register(host: refused) { _ in
        StubResponse(status: 403, json: #"{"error":{"message":"ava isn't an admin here.","code":-32003,"data":{"code":"FORBIDDEN","httpStatus":403}}}"#)
    }
    func c(_ h: String) -> TRPCClient { TRPCClient(baseURL: URL(string: "http://\(h)")!, credential: .bearer("stale"), session: StubProtocol.session) }
    #expect(await SignInExchange.admin(c(ok), plexToken: "p") == .signedIn(username: "sam", token: "t"))
    #expect(await SignInExchange.admin(c(open), plexToken: "p") == .open)
    #expect(await SignInExchange.admin(c(refused), plexToken: "p") == .refused("ava isn't an admin here."))
    // An exchange never presents an old session alongside the Plex token.
    #expect(StubProtocol.requests(host: ok).first?.headers["Authorization"] == nil)
    let body = StubProtocol.requests(host: ok).first?.body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }
    #expect(body == ["plexToken": "p"])
}
