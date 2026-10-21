// The app's links, parsed into what they ask for — and nothing more.
//
// - `rube://connect?admin=<url>&portal=<url>` — what a Settings QR code
//   holds. Either half may be missing: the portal's own page only shares the
//   portal address.
// - `rube://match?server=<portal>&code=<CODE>&invite=<SECRET>` — a movie
//   match room. The web's invite, `<portal>/#match/CODE/SECRET`, means the same
//   and is accepted when pasted.
//
// Any app on the phone can open these, and anyone can print a QR code, so a
// link is only ever a suggestion: connect fills in a confirm screen that
// probes each address, and never replaces a connection by itself.

import Foundation

public enum DeepLink: Sendable, Hashable {
    case connect(ConnectLink)
    case match(MatchLink)
}

public struct ConnectLink: Sendable, Hashable {
    public var admin: String?
    public var portal: String?
    /// A development plex.tv. Only survives parsing in a DEBUG build.
    public var plexTv: URL?

    public init(admin: String? = nil, portal: String? = nil, plexTv: URL? = nil) {
        self.admin = admin
        self.portal = portal
        self.plexTv = plexTv
    }
}

public struct MatchLink: Sendable, Hashable {
    /// The portal's origin.
    public var server: String
    public var code: String
    public var invite: String?

    public init(server: String, code: String, invite: String?) {
        self.server = server
        self.code = code
        self.invite = invite
    }
}

public enum MatchCode {
    /// No 0/O or 1/I: codes are read aloud across a sofa.
    public static let alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    public static let length = 4

    /// Uppercased and checked; nil for anything that can't be a room.
    public static func normalise(_ raw: String) -> String? {
        let upper = raw.uppercased()
        guard upper.count == length, upper.allSatisfy({ alphabet.contains($0) }) else { return nil }
        return upper
    }

    /// What a code field keeps of a keystroke: the alphabet, uppercased, capped.
    public static func filterTyping(_ raw: String) -> String {
        String(raw.uppercased().filter { alphabet.contains($0) }.prefix(length))
    }
}

extension DeepLink {
    public static let scheme = "rube"

    /// `allowPlexTvOverride` is the build's DEBUG flag, passed in rather than
    /// read here so both sides of it are tested. In a release build a link
    /// naming its own plex.tv would be a way to steer sign-in to a fake one.
    public static func parse(_ raw: String, allowPlexTvOverride: Bool) -> DeepLink? {
        guard let components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = components.scheme?.lowercased()
        else { return nil }
        if scheme == "http" || scheme == "https" { return parseWebInvite(raw).map(DeepLink.match) }
        guard scheme == Self.scheme else { return nil }

        // `rube://connect?…` parses with `connect` as the host; tolerate
        // `rube:connect?…` and `rube:///connect` too.
        let route = ((components.host ?? "") + components.path).trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
        let query = Dictionary(
            (components.queryItems ?? []).compactMap { item in item.value.map { (item.name, $0) } },
            uniquingKeysWith: { first, _ in first }
        )

        switch route {
        case "connect":
            let admin = query["admin"].flatMap(ServerAddress.origin(of:))
            let portal = query["portal"].flatMap(ServerAddress.origin(of:))
            guard admin != nil || portal != nil else { return nil }
            let plexTv = allowPlexTvOverride ? query["plexTv"].flatMap(ServerAddress.origin(of:)).flatMap(URL.init(string:)) : nil
            return .connect(ConnectLink(admin: admin, portal: portal, plexTv: plexTv))
        case "match":
            guard let server = query["server"].flatMap(ServerAddress.origin(of:)),
                  let code = query["code"].flatMap(MatchCode.normalise)
            else { return nil }
            let invite = query["invite"].flatMap { $0.isEmpty ? nil : $0 }
            return .match(MatchLink(server: server, code: code, invite: invite))
        default:
            return nil
        }
    }

    /// `https://portal.example/#match/CODE/SECRET`, the link the web portal's
    /// share sheet sends. The secret rides in the fragment there because a
    /// fragment never reaches a server log; here it is just data.
    public static func parseWebInvite(_ raw: String) -> MatchLink? {
        guard let components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let server = ServerAddress.origin(of: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let fragment = components.fragment
        else { return nil }
        let parts = fragment.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard parts.first == "match", parts.count >= 2, let code = MatchCode.normalise(parts[1]) else { return nil }
        let invite = parts.count >= 3 && !parts[2].isEmpty ? parts[2] : nil
        return MatchLink(server: server, code: code, invite: invite)
    }

    /// The link a connect QR code holds, for the Settings screen's own code.
    public static func connectURL(admin: String?, portal: String?) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = "connect"
        components.queryItems = [
            admin.map { URLQueryItem(name: "admin", value: $0) },
            portal.map { URLQueryItem(name: "portal", value: $0) },
        ].compactMap { $0 }
        return components.url
    }
}
