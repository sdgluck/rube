// One server the app talks to, and the URLs built from it.
//
// The portal and the admin are separate HTTP servers — often different ports,
// sometimes different hosts — with separate sessions, so the app holds up to
// two of these and never lets one's token near the other's address.

import Foundation

public struct ServerConnection: Sendable, Hashable, Codable {
    public var role: ServerProduct
    /// The origin, no trailing slash.
    public var baseURL: URL
    /// Nil until signed in — and stays nil for an admin server with sign-in
    /// switched off (`open`), where there is nothing to present.
    public var sessionToken: String?
    /// The admin answered `open` at sign-in: no session, anyone who can reach
    /// it can administer it. Remembered so the warning outlives the launch.
    public var openAuth: Bool

    public init(role: ServerProduct, baseURL: URL, sessionToken: String? = nil, openAuth: Bool = false) {
        self.role = role
        self.baseURL = baseURL
        self.sessionToken = sessionToken
        self.openAuth = openAuth
    }

    public var isSignedIn: Bool { sessionToken != nil || openAuth }

    public var credential: TRPCClient.Credential {
        sessionToken.map(TRPCClient.Credential.bearer) ?? .none
    }

    public var displayHost: String {
        URLComponents(url: baseURL, resolvingAgainstBaseURL: false).map { c in
            [c.host, c.port.map { String($0) }].compactMap { $0 }.joined(separator: ":")
        } ?? baseURL.absoluteString
    }

    /// Plain HTTP across the internet: worth a quiet warning on its row.
    public var isUnencryptedRemote: Bool { ServerAddress.isUnencryptedRemote(baseURL.absoluteString) }
}

public enum AdminURLs {
    /// The admin's image proxy. It authenticates like any other admin route,
    /// so the loader sends the bearer header with it.
    public static func plexImage(base: URL, path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        var components = URLComponents(url: base.appending(path: "api/plex-image"), resolvingAgainstBaseURL: false)!
        components.percentEncodedQuery = "path=\(path.addingPercentEncoding(withAllowedCharacters: TRPCRequest.queryValueAllowed) ?? path)"
        return components.url
    }

    /// A screen of the web admin, for everything the app leaves to it. `path`
    /// is the SPA route (`/rules?q=…`), appended to the origin as-is.
    public static func web(base: URL, path: String) -> URL? {
        URL(string: base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + (path.hasPrefix("/") ? path : "/\(path)"))
    }
}

public enum PortalURLs {
    /// Match posters are paths the server signed; they work from any client
    /// with no header, so they're plain GETs on the portal origin.
    public static func poster(base: URL, path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        return URL(string: base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + (path.hasPrefix("/") ? path : "/\(path)"))
    }
}
