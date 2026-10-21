// The app's (up to) two servers, and everything that lives with them.
//
// One observable object so the root view can switch on it: no portal and no
// admin is the connect screen, an address without a session is sign-in, and
// a session that the server rejects is cleared here — once, by the client's
// `onUnauthorized` — which puts that half of the app back to sign-in without
// every screen having to decide to.

import Foundation
import Observation
import RubeAPI

@Observable
@MainActor
public final class ConnectionStore {
    public private(set) var portal: ServerConnection?
    public private(set) var admin: ServerConnection?
    /// DEBUG builds only: a development plex.tv from a connect link.
    public private(set) var plexTvOverride: URL?

    let secrets: any SecretStore
    let defaults: UserDefaults

    enum Key {
        static let portalURL = "tb.portal.url"
        static let adminURL = "tb.admin.url"
        static let adminOpen = "tb.admin.open"
        static let plexTv = "tb.debug.plexTv"
        static func session(_ role: ServerProduct) -> String { "session.\(role.rawValue)" }
        static let plexClientID = "plex.clientId"
        static func guest(server: String, code: String) -> String { "guest.\(server).\(code)" }
    }

    public init(secrets: any SecretStore = KeychainStore(), defaults: UserDefaults = .standard) {
        self.secrets = secrets
        self.defaults = defaults
        portal = load(.portal)
        admin = load(.admin)
        #if DEBUG
        plexTvOverride = defaults.string(forKey: Key.plexTv).flatMap(URL.init(string:))
        #endif
    }

    func load(_ role: ServerProduct) -> ServerConnection? {
        guard let raw = defaults.string(forKey: role == .portal ? Key.portalURL : Key.adminURL),
              let url = URL(string: raw)
        else { return nil }
        return ServerConnection(
            role: role,
            baseURL: url,
            sessionToken: secrets.string(for: Key.session(role)),
            openAuth: role == .admin && defaults.bool(forKey: Key.adminOpen)
        )
    }

    public subscript(role: ServerProduct) -> ServerConnection? {
        role == .portal ? portal : admin
    }

    public var isEmpty: Bool { portal == nil && admin == nil }

    /// Point a slot at a server. A different address drops that slot's
    /// session: a token is only meaningful to the server that issued it, and
    /// presenting it to another hands that server a live token for the first.
    public func setServer(_ role: ServerProduct, origin: String) {
        guard let url = URL(string: origin) else { return }
        if self[role]?.baseURL == url { return }
        secrets.set(nil, for: Key.session(role))
        if role == .admin { defaults.set(false, forKey: Key.adminOpen) }
        defaults.set(origin, forKey: role == .portal ? Key.portalURL : Key.adminURL)
        assign(role, ServerConnection(role: role, baseURL: url))
    }

    public func setSession(_ role: ServerProduct, token: String?, openAuth: Bool = false) {
        guard var connection = self[role] else { return }
        secrets.set(token, for: Key.session(role))
        connection.sessionToken = token
        connection.openAuth = role == .admin && openAuth
        if role == .admin { defaults.set(connection.openAuth, forKey: Key.adminOpen) }
        assign(role, connection)
    }

    /// Only if it is still the token that failed. A sign-in that finished
    /// while an old request was in flight must not be undone by its 401.
    public func clearSession(_ role: ServerProduct, ifToken token: String?) {
        guard let connection = self[role], connection.sessionToken == token else { return }
        if token == nil && connection.openAuth {
            // An `open` admin that now says UNAUTHORIZED has had sign-in
            // switched on: back to sign-in, like any other expired session.
            setSession(role, token: nil, openAuth: false)
            return
        }
        setSession(role, token: nil)
    }

    public func remove(_ role: ServerProduct) {
        secrets.set(nil, for: Key.session(role))
        defaults.removeObject(forKey: role == .portal ? Key.portalURL : Key.adminURL)
        if role == .admin { defaults.removeObject(forKey: Key.adminOpen) }
        assign(role, nil)
    }

    public func setPlexTvOverride(_ url: URL?) {
        #if DEBUG
        plexTvOverride = url
        defaults.set(url?.absoluteString, forKey: Key.plexTv)
        #endif
    }

    func assign(_ role: ServerProduct, _ connection: ServerConnection?) {
        if role == .portal { portal = connection } else { admin = connection }
    }

    /// A client for that slot, wired so a rejected session clears itself.
    public func client(_ role: ServerProduct, timeout: TimeInterval = 20) -> TRPCClient? {
        guard let connection = self[role] else { return nil }
        let token = connection.sessionToken
        return TRPCClient(baseURL: connection.baseURL, credential: connection.credential, timeout: timeout) { [weak self] in
            await self?.clearSession(role, ifToken: token)
        }
    }

    // MARK: Per-install and per-room secrets

    /// Plex identifies a device by this, and only redeems a PIN for the id
    /// that created it. Made once per install; never leaves the device.
    public var plexClientID: String {
        if let existing = secrets.string(for: Key.plexClientID) { return existing }
        let fresh = UUID().uuidString.lowercased()
        secrets.set(fresh, for: Key.plexClientID)
        return fresh
    }

    /// A movie-match guest's token for one room, which is all a guest has.
    public func guestToken(server: String, code: String) -> String? {
        secrets.string(for: Key.guest(server: server, code: code))
    }

    public func setGuestToken(_ token: String?, server: String, code: String) {
        secrets.set(token, for: Key.guest(server: server, code: code))
    }
}
