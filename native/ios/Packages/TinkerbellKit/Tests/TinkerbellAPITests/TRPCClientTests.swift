// The client against the wire format as the server actually sends it: GET vs
// POST, how `?input=` is encoded, the envelope, void and nullable outputs, and
// which tRPC code becomes which error.

import Foundation
import Synchronization
import Testing
import TinkerbellModels
@testable import TinkerbellAPI

private func client(_ host: String, credential: TRPCClient.Credential = .bearer("tok"), onUnauthorized: (@Sendable () async -> Void)? = nil) -> TRPCClient {
    TRPCClient(baseURL: URL(string: "http://\(host):3000")!, credential: credential, session: StubProtocol.session, onUnauthorized: onUnauthorized)
}

@Test func aQueryWithNoInputIsABareGetWithTheBearer() async throws {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(json: #"{"result":{"data":{"userId":1,"username":"sam"}}}"#) }
    let me = try await client(host).call(PortalAPI.me)
    #expect(me.username == "sam")
    let req = try #require(StubProtocol.requests(host: host).first)
    #expect(req.method == "GET")
    #expect(req.url.path == "/api/trpc/me")
    #expect(req.url.query == nil)
    #expect(req.headers["Authorization"] == "Bearer tok")
    // The server refuses sign-in from anything that looks like a browser.
    #expect(req.headers["Origin"] == nil)
    #expect(req.headers["Sec-Fetch-Site"] == nil)
}

@Test func aQueryInputIsPercentEncodedJSONThatSurvivesURLSearchParams() async throws {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(json: #"{"result":{"data":["C++ Primer"]}}"#) }
    _ = try await client(host).call(PortalAPI.searchTitles, .init(q: "C++ & co/x=1"))
    let req = try #require(StubProtocol.requests(host: host).first)
    let raw = try #require(req.url.query)
    #expect(raw.hasPrefix("input="))
    // `+` must not go through bare: URLSearchParams reads it as a space.
    #expect(!raw.dropFirst(6).contains("+"))
    #expect(!raw.dropFirst(6).contains("&"))
    let decoded = try #require(String(raw.dropFirst(6)).removingPercentEncoding)
    #expect(decoded == #"{"q":"C++ & co/x=1"}"#)
}

@Test func aMutationPostsItsInputAsTheBody() async throws {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(json: #"{"result":{"data":{"ok":true}}}"#) }
    let out = try await client(host).call(PortalAPI.voteKeep, .init(ratingKey: "42", keep: true))
    #expect(out.ok)
    let req = try #require(StubProtocol.requests(host: host).first)
    #expect(req.method == "POST")
    #expect(req.url.path == "/api/trpc/voteKeep")
    #expect(req.url.query == nil)
    #expect(req.headers["Content-Type"] == "application/json")
    let body = try JSONSerialization.jsonObject(with: try #require(req.body)) as? [String: Any]
    #expect(body?["ratingKey"] as? String == "42")
    #expect(body?["keep"] as? Bool == true)
}

@Test func aMutationWithNoInputSendsNoBody() async throws {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(json: #"{"result":{"data":{"synced":1,"removed":0,"invites":0}}}"#) }
    _ = try await client(host).call(AdminAPI.usersSync)
    let req = try #require(StubProtocol.requests(host: host).first)
    #expect(req.method == "POST")
    #expect(req.body == nil || req.body?.isEmpty == true)
}

@Test func aVoidProcedureAnswersWithNoData() async throws {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(json: #"{"result":{}}"#) }
    let out = try await client(host).call(PortalAPI.matchLeave, .init(code: "ABCD"))
    #expect(out == NoOutput())
}

@Test func aNullableOutputDecodesNullAndMissingAsNil() async throws {
    let host = uniqueHost()
    let answers = Mutex([#"{"result":{"data":null}}"#, #"{"result":{}}"#, #"{"result":{"data":{"runId":"r","jobId":"j","name":"Sync","startedAt":5}}}"#])
    StubProtocol.register(host: host) { _ in StubResponse(json: answers.withLock { $0.removeFirst() }) }
    let c = client(host)
    #expect(try await c.call(AdminAPI.jobsLastFailure) == nil)
    #expect(try await c.call(AdminAPI.jobsLastFailure) == nil)
    #expect(try await c.call(AdminAPI.jobsLastFailure)?.name == "Sync")
}

@Test func aMatchGuestSendsItsTokenInsteadOfABearer() async throws {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(json: #"{"result":{}}"#) }
    _ = try await client(host, credential: .matchGuest("g-1")).call(PortalAPI.matchLeave, .init(code: "ABCD"))
    let req = try #require(StubProtocol.requests(host: host).first)
    #expect(req.headers["X-Match-Guest"] == "g-1")
    #expect(req.headers["Authorization"] == nil)
}

private func errorBody(_ code: String, _ status: Int, _ message: String = "nope") -> String {
    #"{"error":{"message":"\#(message)","code":-32001,"data":{"code":"\#(code)","httpStatus":\#(status),"path":"me"}}}"#
}

@Test(arguments: [
    ("UNAUTHORIZED", 401, APIError.unauthorized("nope")),
    ("PRECONDITION_FAILED", 412, .notConfigured("nope")),
    ("FORBIDDEN", 403, .forbidden("nope")),
    ("NOT_FOUND", 404, .notFound("nope")),
    ("BAD_REQUEST", 400, .badRequest("nope")),
    ("TOO_MANY_REQUESTS", 429, .tooManyRequests("nope")),
    ("INTERNAL_SERVER_ERROR", 500, .server(code: "INTERNAL_SERVER_ERROR", status: 500, message: "nope")),
])
func tRPCErrorCodesMapToErrors(code: String, status: Int, expected: APIError) async {
    let host = uniqueHost("err\(code)")
    StubProtocol.register(host: host) { _ in StubResponse(status: status, json: errorBody(code, status)) }
    await #expect(throws: expected) { try await client(host).call(PortalAPI.me) }
}

@Test func unauthorizedTellsTheOwnerBeforeThrowing() async {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(status: 401, json: errorBody("UNAUTHORIZED", 401)) }
    let told = Mutex(0)
    let c = client(host) { told.withLock { $0 += 1 } }
    await #expect(throws: APIError.unauthorized("nope")) { try await c.call(PortalAPI.me) }
    #expect(told.withLock { $0 } == 1)
}

@Test func anyOtherErrorDoesNotSignOut() async {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(status: 403, json: errorBody("FORBIDDEN", 403)) }
    let told = Mutex(0)
    let c = client(host) { told.withLock { $0 += 1 } }
    await #expect(throws: APIError.forbidden("nope")) { try await c.call(PortalAPI.me) }
    #expect(told.withLock { $0 } == 0)
}

@Test func aProxyErrorPageFallsBackToTheStatus() async {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(status: 502, json: "<html>Bad gateway</html>") }
    await #expect(throws: APIError.server(code: "HTTP_502", status: 502, message: "")) { try await client(host).call(PortalAPI.me) }
}

@Test func aShapeTheAppDoesNotKnowIsADecodingError() async throws {
    let host = uniqueHost()
    StubProtocol.register(host: host) { _ in StubResponse(json: #"{"result":{"data":{"userId":"one"}}}"#) }
    do {
        _ = try await client(host).call(PortalAPI.me)
        Issue.record("expected a decoding error")
    } catch {
        guard case .decoding(let detail) = error else { Issue.record("got \(error)"); return }
        #expect(detail.contains("userId"))
    }
}

@Test func nothingAnsweringIsATransportError() async {
    let host = uniqueHost()  // never registered: the stub fails with cannotFindHost
    do {
        _ = try await client(host).call(PortalAPI.me)
        Issue.record("expected a transport error")
    } catch {
        guard case .transport = error else { Issue.record("got \(error)"); return }
    }
}
