// Sign in with Plex, run by the app itself.
//
// The app creates a plex.tv PIN, shows plex.tv's approval page in a browser
// sheet, and polls the PIN until plex.tv attaches a token to it. That token is
// then handed to each server's `auth.exchange`, which checks it with plex.tv
// independently and answers with a session of its own. The Plex token is never
// stored: it exists between the poll and the last exchange, and then it is
// dropped.
//
// Mirrors `clients/plex/src/auth.ts` (headers, the auth URL without a
// `forwardUrl`) so the server and the app ask plex.tv the same way.

import Foundation
import Synchronization

public struct PlexPin: Sendable, Hashable, Decodable {
    public let id: Int
    public let code: String
}

public enum PlexSignInError: Error, Sendable, Hashable {
    /// The person closed the sheet without approving, or the screen went away.
    case cancelled
    /// Fifteen minutes passed, or plex.tv forgot the PIN.
    case expired
    /// plex.tv itself couldn't be reached or answered nonsense.
    case plexUnavailable(String)

    public var message: String {
        switch self {
        case .cancelled: "Sign-in was cancelled."
        case .expired: "The sign-in expired. Try again."
        case .plexUnavailable(let detail): "Couldn't reach plex.tv. \(detail)"
        }
    }
}

public struct PlexTV: Sendable {
    public static let product = "Tinkerbell"

    public let clientID: String
    /// A development stand-in for plex.tv (the dev server's mock). Only a
    /// DEBUG build ever sets it — see `DeepLink.parse(allowPlexTvOverride:)`.
    public let override: URL?
    let session: URLSession

    public init(clientID: String, override: URL? = nil, session: URLSession = .tinkerbell) {
        self.clientID = clientID
        self.override = override
        self.session = session
    }

    var apiBase: URL {
        (override ?? URL(string: "https://plex.tv")!).appending(path: "api/v2")
    }

    func request(_ url: URL, method: String) -> URLRequest {
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = method
        request.setValue(clientID, forHTTPHeaderField: "X-Plex-Client-Identifier")
        request.setValue(Self.product, forHTTPHeaderField: "X-Plex-Product")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    /// `strong=true`: a long code that only this client id can redeem, rather
    /// than the four-character one meant for typing on a TV.
    public func createPin() async throws(PlexSignInError) -> PlexPin {
        var components = URLComponents(url: apiBase.appending(path: "pins"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "strong", value: "true")]
        let (data, status) = try await send(request(components.url!, method: "POST"))
        guard (200..<300).contains(status), let pin = try? JSONDecoder().decode(PlexPin.self, from: data) else {
            throw .plexUnavailable("It answered \(status).")
        }
        return pin
    }

    /// The PIN's token once approved, nil while it is still waiting.
    public func checkPin(_ id: Int) async throws(PlexSignInError) -> String? {
        struct Body: Decodable { let authToken: String? }
        let (data, status) = try await send(request(apiBase.appending(path: "pins/\(id)"), method: "GET"))
        // plex.tv forgets a PIN when it expires; a 404 is that, not an outage.
        if status == 404 { throw .expired }
        guard (200..<300).contains(status), let body = try? JSONDecoder().decode(Body.self, from: data) else {
            throw .plexUnavailable("It answered \(status).")
        }
        return body.authToken.flatMap { $0.isEmpty ? nil : $0 }
    }

    /// The approval page. No `forwardUrl`: the sheet is closed by the app once
    /// the poll succeeds, so there is nowhere to return to.
    public func authURL(code: String) -> URL {
        if let override {
            var components = URLComponents(url: override.appending(path: "auth"), resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "code", value: code)]
            return components.url!
        }
        let params = [
            ("clientID", clientID),
            ("code", code),
            ("context[device][product]", Self.product),
        ]
        let query = params.map { "\(Self.formEncode($0.0))=\(Self.formEncode($0.1))" }.joined(separator: "&")
        return URL(string: "https://app.plex.tv/auth#?\(query)")!
    }

    /// For UI tests against the dev server's mock: approve the PIN as a given
    /// account without a browser. The mock's `/auth?as=` does exactly what
    /// tapping a name on its page does. Never reaches the real plex.tv — it
    /// needs an override to have anywhere to go.
    public func approveHeadlessly(code: String, as accountID: String) async throws(PlexSignInError) {
        guard let override else { throw .plexUnavailable("No development plex.tv is set.") }
        var components = URLComponents(url: override.appending(path: "auth"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "code", value: code), URLQueryItem(name: "as", value: accountID)]
        let (_, status) = try await send(URLRequest(url: components.url!, timeoutInterval: 15))
        guard (200..<300).contains(status) else { throw .plexUnavailable("The mock answered \(status).") }
    }

    func send(_ request: URLRequest) async throws(PlexSignInError) -> (Data, Int) {
        do {
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch {
            if Task.isCancelled || (error as? URLError)?.code == .cancelled { throw .cancelled }
            throw .plexUnavailable(APIError.fromTransport(error).message)
        }
    }

    /// `application/x-www-form-urlencoded`, as URLSearchParams writes it — what
    /// the server's `buildPlexAuthUrl` produces, so both open the same page.
    static func formEncode(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._*")
        return (s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s).replacingOccurrences(of: "%20", with: "+")
    }
}

/// Whether the sign-in sheet has been closed. Shared between the sheet's
/// completion handler (main thread) and the poll (a task), hence the mutex.
public final class SignInSheetState: Sendable {
    let closed = Mutex(false)
    public init() {}
    public func markClosed() { closed.withLock { $0 = true } }
    public var isClosed: Bool { closed.withLock { $0 } }
}

public struct PlexPinPoller: Sendable {
    public var interval: Duration = .seconds(2)
    /// plex.tv keeps a PIN for fifteen minutes.
    public var limit: Duration = .seconds(15 * 60)
    /// Polls after the sheet closes. Tapping "Allow" and closing the sheet in
    /// one motion is common, and the approval can land a beat after the close.
    public var checksAfterClose = 2
    /// A blip on a phone's network shouldn't throw away a sign-in that is
    /// half done; this many failures in a row should.
    public var toleratedFailures = 5

    public init() {}

    public func waitForToken(_ pin: PlexPin, plex: PlexTV, sheet: SignInSheetState) async throws(PlexSignInError) -> String {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: limit)
        var afterClose = 0
        var failures = 0
        while clock.now < deadline {
            do {
                try await Task.sleep(for: interval)
            } catch {
                throw .cancelled
            }
            let closed = sheet.isClosed
            do {
                if let token = try await plex.checkPin(pin.id) { return token }
                failures = 0
            } catch .plexUnavailable(let detail) {
                failures += 1
                if failures > toleratedFailures { throw .plexUnavailable(detail) }
            } catch {
                throw error
            }
            if closed {
                afterClose += 1
                if afterClose >= checksAfterClose { throw .cancelled }
            }
        }
        throw .expired
    }
}
