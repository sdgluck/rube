// The other people in a test's movie match room: plain tRPC calls from the
// test runner to the dev server, beside the app.
//
// A match needs a second member to like the same film, and an invite needs a
// room someone else made. Driving a second simulator for that would be slow
// and flaky; the server can't tell a guest swiping from here from one swiping
// in the app, so the test plays that part over HTTP.

import Foundation

@MainActor
enum DevServer {
    static let portal = URL(string: "http://127.0.0.1:39312")!
    static let plexTv = URL(string: "http://127.0.0.1:39313")!

    struct Failure: Error, CustomStringConvertible {
        let description: String
    }

    /// A portal session for a seeded Plex account, by the same PIN flow the
    /// app uses, approved on the mock plex.tv.
    static func portalSession(as account: String) async throws -> String {
        let client = "uitest-\(UUID().uuidString)"
        func plex(_ path: String, method: String = "GET") -> URLRequest {
            var r = URLRequest(url: URL(string: path, relativeTo: plexTv)!)
            r.httpMethod = method
            r.setValue(client, forHTTPHeaderField: "X-Plex-Client-Identifier")
            r.setValue("Rube", forHTTPHeaderField: "X-Plex-Product")
            r.setValue("application/json", forHTTPHeaderField: "Accept")
            return r
        }
        let pin = try await object(plex("/api/v2/pins?strong=true", method: "POST"))
        guard let id = pin["id"] as? Int, let code = pin["code"] as? String else { throw Failure(description: "no PIN: \(pin)") }
        _ = try await URLSession.shared.data(for: URLRequest(url: URL(string: "/auth?code=\(code)&as=\(account)", relativeTo: plexTv)!))
        guard let plexToken = try await object(plex("/api/v2/pins/\(id)"))["authToken"] as? String else {
            throw Failure(description: "PIN \(id) not approved")
        }
        let out = try await mutate("auth.exchange", ["plexToken": plexToken])
        guard let token = (out as? [String: Any])?["token"] as? String else { throw Failure(description: "no session: \(out)") }
        return token
    }

    enum Credential {
        case session(String)
        case guest(String)
    }

    static func query(_ path: String, _ input: [String: Any], as who: Credential? = nil) async throws -> Any {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: input), as: UTF8.self)
        let encoded = json.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        var r = URLRequest(url: URL(string: "/api/trpc/\(path)?input=\(encoded)", relativeTo: portal)!)
        authorise(&r, who)
        return try await data(r, path)
    }

    static func mutate(_ path: String, _ input: [String: Any], as who: Credential? = nil) async throws -> Any {
        var r = URLRequest(url: URL(string: "/api/trpc/\(path)", relativeTo: portal)!)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: input)
        authorise(&r, who)
        return try await data(r, path)
    }

    static func authorise(_ r: inout URLRequest, _ who: Credential?) {
        switch who {
        case .session(let t)?: r.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization")
        case .guest(let t)?: r.setValue(t, forHTTPHeaderField: "X-Match-Guest")
        case nil: break
        }
    }

    /// `result.data`, or the server's error — including "Output validation
    /// failed", which is a server bug to report, not to work around.
    static func data(_ r: URLRequest, _ path: String) async throws -> Any {
        let body = try await object(r)
        if let error = body["error"] { throw Failure(description: "\(path): \(error)") }
        return (body["result"] as? [String: Any])?["data"] ?? NSNull()
    }

    static func object(_ r: URLRequest) async throws -> [String: Any] {
        let (data, _) = try await URLSession.shared.data(for: r)
        guard let o = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw Failure(description: "not JSON: \(String(decoding: data, as: UTF8.self))")
        }
        return o
    }

    // MARK: Movie match

    static func state(_ code: String, as who: Credential) async throws -> [String: Any] {
        guard let s = try await query("match.state", ["code": code], as: who) as? [String: Any] else { throw Failure(description: "no state") }
        return s
    }

    /// Joins as a named guest and likes every film in the deck, so whatever
    /// the app's user likes next is a match.
    static func guestWhoLikesEverything(code: String, invite: String, name: String) async throws -> String {
        let joined = try await mutate("match.guest.join", ["code": code, "invite": invite, "name": name])
        guard let token = (joined as? [String: Any])?["token"] as? String else { throw Failure(description: "no guest token: \(joined)") }
        let deck = try await query("match.deck", ["code": code, "exclude": [String](), "limit": 50], as: .guest(token))
        let films = ((deck as? [String: Any])?["films"] as? [[String: Any]]) ?? []
        for film in films {
            guard let key = film["ratingKey"] as? String else { continue }
            _ = try await mutate("match.swipe", ["code": code, "ratingKey": key, "liked": true], as: .guest(token))
        }
        return token
    }
}
