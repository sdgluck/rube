// Turning what somebody typed into a server address, and deciding whether the
// server at it is one this app can talk to. A port of
// `packages/native-client/src/server-url.ts`; its tests are the golden vectors
// in `ServerAddressTests`.
//
// People type `192.168.1.10:3000`, `tinkerbell.example.com/` or paste a URL
// with a path from their address bar. The probe tries each candidate until one
// answers `auth.server`. Without a scheme, HTTPS goes first — a name that
// serves both should use the encrypted one — and plain HTTP second, because a
// LAN address with a port is usually exactly that.

import Foundation

public enum ServerProduct: String, Sendable, Hashable, Codable {
    case portal = "tinkerbell-portal"
    case admin = "tinkerbell-admin"

    /// How the person knows it: the two halves of the app.
    public var label: String { self == .portal ? "Portal" : "Admin" }
}

public enum ServerAddress {
    public static func candidates(_ input: String) -> [String] {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        let hasScheme = trimmed.range(of: #"^[a-z][a-z0-9+.-]*://"#, options: [.regularExpression, .caseInsensitive]) != nil
        let attempts = hasScheme ? [trimmed] : ["https://\(trimmed)", "http://\(trimmed)"]
        var out: [String] = []
        for attempt in attempts {
            // Only the origin. A pasted `/settings/api` path is where the user
            // was, not where the API is — and Tinkerbell under a reverse-proxy
            // sub-path isn't something the server supports either.
            guard let origin = origin(of: attempt), !out.contains(origin) else { continue }
            out.append(origin)
        }
        return out
    }

    /// `scheme://host[:port]`, lowercased, default port dropped — the same
    /// string a browser's `URL.origin` gives, so the two ends compare equal.
    public static func origin(of raw: String) -> String? {
        guard let c = URLComponents(string: raw),
              let scheme = c.scheme?.lowercased(), scheme == "http" || scheme == "https",
              var host = c.host?.lowercased(), !host.isEmpty
        else { return nil }
        if host.contains(":"), !host.hasPrefix("[") { host = "[\(host)]" }
        let defaultPort = scheme == "https" ? 443 : 80
        let port = c.port.flatMap { $0 == defaultPort ? nil : ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(port)"
    }

    /// Numeric compare of `x.y.z`; anything after a `-` is ignored.
    public static func compareVersions(_ a: String, _ b: String) -> Int {
        func parse(_ v: String) -> [Int] {
            (v.split(separator: "-", maxSplits: 1).first ?? "").split(separator: ".", omittingEmptySubsequences: false)
                .map { Int($0.prefix { $0.isNumber }) ?? 0 }
        }
        let (pa, pb) = (parse(a), parse(b))
        for i in 0..<max(pa.count, pb.count) {
            let diff = (i < pa.count ? pa[i] : 0) - (i < pb.count ? pb[i] : 0)
            if diff != 0 { return diff > 0 ? 1 : -1 }
        }
        return 0
    }

    /// The oldest server this build can drive. `auth.server` arrived with the
    /// first native apps, so any server that answers it is at least this; the
    /// capability check below is what actually gates sign-in.
    public static let minimumServerVersion = "0.35.0"

    /// Judge one candidate's `auth.server` answer — the raw body, so a server
    /// that isn't Tinkerbell at all is judged rather than failing to decode.
    public static func judge(origin: String, body: Data, want: ServerProduct) -> ServerCheck {
        guard let json = try? JSONSerialization.jsonObject(with: body) else { return .failed(.notTinkerbell) }
        return judge(origin: origin, json: json, want: want)
    }

    public static func judge(origin: String, json: Any, want: ServerProduct) -> ServerCheck {
        guard let result = (json as? [String: Any])?["result"] as? [String: Any],
              let data = result["data"] as? [String: Any],
              let productRaw = data["product"] as? String,
              let version = data["version"] as? String
        else { return .failed(.notTinkerbell) }
        guard let product = ServerProduct(rawValue: productRaw) else { return .failed(.notTinkerbell) }
        if product != want { return .failed(.wrongApp(found: product)) }
        if compareVersions(version, minimumServerVersion) < 0 { return .failed(.tooOld(version: version)) }
        let capabilities = data["capabilities"] as? [String] ?? []
        // Asked, not inferred from the version: a server says what it can do.
        guard capabilities.contains("exchange") else { return .failed(.needsUpdate(version: version)) }
        return .ok(ServerInfo(
            origin: origin,
            product: product,
            version: version,
            capabilities: capabilities,
            authRequired: data["authRequired"] as? Bool,
            portalURL: (data["portalUrl"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        ))
    }

    // MARK: Where an address points

    /// This device's own address. A phone given `localhost` reaches itself,
    /// not the server — the commonest copy-paste from a desktop browser.
    public static func isLoopback(_ address: String) -> Bool {
        guard let host = host(of: address) else { return false }
        return host == "localhost" || host.hasSuffix(".localhost") || host == "::1"
            || host.hasPrefix("127.") || host == "0.0.0.0"
    }

    /// On the local network (or loopback), where plain HTTP is the norm and
    /// not worth a warning. Tailscale's `100.64/10` and `*.ts.net` count: that
    /// traffic is already inside WireGuard.
    public static func isLocalNetwork(_ address: String) -> Bool {
        if isLoopback(address) { return true }
        guard let host = host(of: address) else { return false }
        if !host.contains(".") && !host.contains(":") { return true }
        for suffix in [".local", ".lan", ".home", ".home.arpa", ".internal", ".localdomain", ".ts.net"] where host.hasSuffix(suffix) {
            return true
        }
        if host.contains(":") {
            return host.hasPrefix("fc") || host.hasPrefix("fd") || host.hasPrefix("fe80")
        }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4 else { return false }
        switch (parts[0], parts[1]) {
        case (10, _), (192, 168), (169, 254): return true
        case (172, 16...31): return true
        case (100, 64...127): return true
        default: return false
        }
    }

    /// Plain HTTP somewhere other than the LAN: the session and, at sign-in,
    /// the Plex token cross the internet readable.
    public static func isUnencryptedRemote(_ address: String) -> Bool {
        guard let c = URLComponents(string: address), c.scheme?.lowercased() == "http" else { return false }
        return !isLocalNetwork(address)
    }

    static func host(of address: String) -> String? {
        guard let host = URLComponents(string: address)?.host?.lowercased() else { return nil }
        return host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
    }
}

/// What a server said about itself, once it has passed.
public struct ServerInfo: Sendable, Hashable {
    public let origin: String
    public let product: ServerProduct
    public let version: String
    public let capabilities: [String]
    /// Admin only: false when admin sign-in is switched off on the server.
    public let authRequired: Bool?
    /// Admin only: the portal's public address, when the admin has set one —
    /// offered for the portal slot so nobody types it twice.
    public let portalURL: String?

    public init(origin: String, product: ServerProduct, version: String, capabilities: [String], authRequired: Bool? = nil, portalURL: String? = nil) {
        self.origin = origin
        self.product = product
        self.version = version
        self.capabilities = capabilities
        self.authRequired = authRequired
        self.portalURL = portalURL
    }
}

public enum ServerCheck: Sendable, Hashable {
    case ok(ServerInfo)
    case failed(ProbeFailure)

    public var info: ServerInfo? {
        if case .ok(let info) = self { return info }
        return nil
    }
}

public enum ProbeFailure: Sendable, Hashable {
    case notAnAddress
    case unreachable(detail: String?)
    case notTinkerbell
    case wrongApp(found: ServerProduct)
    case tooOld(version: String)
    case needsUpdate(version: String)

    /// Said for the slot the address was typed into, because "wrong app" only
    /// makes sense knowing which one was wanted.
    public func message(want: ServerProduct) -> String {
        switch self {
        case .notAnAddress:
            return "That isn't a web address."
        case .unreachable(let detail):
            return ["Nothing answered at that address.", detail].compactMap { $0 }.joined(separator: " ")
        case .notTinkerbell:
            return "Something answered, but it isn't Tinkerbell."
        case .wrongApp(let found):
            return found == .admin
                ? "That's the admin address. Add it as the Admin server instead — the Portal has its own address (Settings → Portal → Address)."
                : "That's the portal address. Add it as the Portal server — the Admin server has its own address (Settings → Mobile app)."
        case .tooOld(let version):
            return "This server is running Tinkerbell \(version), which is too old for the app. Update the server and try again."
        case .needsUpdate(let version):
            return "This server (Tinkerbell \(version)) needs updating before the app can sign in to it."
        }
    }

    /// The probe keeps the most useful failure across candidates: "that's the
    /// portal" beats the https attempt's "unreachable" on an http-only server.
    var rank: Int {
        switch self {
        case .notAnAddress: 0
        case .unreachable: 1
        default: 2
        }
    }
}
