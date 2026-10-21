// What can go wrong talking to a Rube server, sorted by what the app
// does about it rather than by HTTP status.
//
// tRPC puts its own code in `error.data.code`; that string is the contract,
// not the status line. Every screen switches on these cases, so a new server
// code lands in `.server` and shows its message instead of crashing a switch.

import Foundation

public enum APIError: Error, Sendable, Hashable {
    /// The session is gone or was never there. The connection goes back to
    /// sign-in; retrying with the same token can't succeed.
    case unauthorized(String)
    /// 412: the server answered, but something it needs (Plex, an *Arr) isn't
    /// set up. Not the user's fault and not a network fault.
    case notConfigured(String)
    /// Not allowed — also what the portal says when the admin has switched a
    /// component off, which screens treat as "hide this", not as an error.
    case forbidden(String)
    case notFound(String)
    case badRequest(String)
    case tooManyRequests(String)
    /// Any other tRPC error, kept with its code so it can still be shown.
    case server(code: String, status: Int, message: String)
    /// Never reached a server that answered: offline, DNS, TLS, timeout.
    case transport(String)
    /// The server answered something this build can't read — usually a server
    /// much newer or older than the app.
    case decoding(String)
    /// The task asking was cancelled (a screen went away). Never shown.
    case cancelled

    /// Text for a person. The server's own message where it has one, because
    /// it is written for exactly that ("Sign in with Plex first.").
    public var message: String {
        switch self {
        case .unauthorized(let m): m.isEmpty ? "Your session has ended. Sign in again." : m
        case .notConfigured(let m): m.isEmpty ? "This server isn't set up for that yet." : m
        case .forbidden(let m): m.isEmpty ? "You aren't allowed to do that here." : m
        case .notFound(let m): m.isEmpty ? "That isn't there any more." : m
        case .badRequest(let m): m.isEmpty ? "The server didn't accept that." : m
        case .tooManyRequests(let m): m.isEmpty ? "Too many attempts. Wait a minute and try again." : m
        case .server(_, _, let m): m.isEmpty ? "Something went wrong on the server." : m
        case .transport(let m): m
        case .decoding: "This server sent something the app couldn't read. Make sure the app and the server are both up to date."
        case .cancelled: "Cancelled."
        }
    }

    /// A short headline to go above `message`.
    public var title: String {
        switch self {
        case .unauthorized: "Signed out"
        case .notConfigured: "Not set up yet"
        case .forbidden: "Not allowed"
        case .notFound: "Not found"
        case .badRequest: "Couldn't do that"
        case .tooManyRequests: "Slow down"
        case .server: "Server error"
        case .transport: "Can't reach the server"
        case .decoding: "Unexpected answer"
        case .cancelled: "Cancelled"
        }
    }

    /// Map tRPC's `error.data.code`. The status is the fallback for a proxy in
    /// front of the server answering with its own body.
    public static func fromTRPC(code: String?, status: Int, message: String) -> APIError {
        switch code {
        case "UNAUTHORIZED": return .unauthorized(message)
        case "PRECONDITION_FAILED": return .notConfigured(message)
        case "FORBIDDEN": return .forbidden(message)
        case "NOT_FOUND": return .notFound(message)
        case "BAD_REQUEST", "PARSE_ERROR", "UNPROCESSABLE_CONTENT": return .badRequest(message)
        case "TOO_MANY_REQUESTS": return .tooManyRequests(message)
        case .some(let other): return .server(code: other, status: status, message: message)
        case .none:
            switch status {
            case 401: return .unauthorized(message)
            case 403: return .forbidden(message)
            case 404: return .notFound(message)
            case 412: return .notConfigured(message)
            case 429: return .tooManyRequests(message)
            default: return .server(code: "HTTP_\(status)", status: status, message: message)
            }
        }
    }

    /// URLSession's failures, in words. A timeout and "no route" read
    /// differently to somebody on hotel Wi-Fi.
    public static func fromTransport(_ error: any Error) -> APIError {
        if error is CancellationError { return .cancelled }
        guard let url = error as? URLError else { return .transport(error.localizedDescription) }
        switch url.code {
        case .cancelled: return .cancelled
        case .timedOut: return .transport("The server took too long to answer.")
        case .cannotFindHost, .dnsLookupFailed: return .transport("That address doesn't resolve to anything.")
        case .cannotConnectToHost: return .transport("Nothing is answering at that address.")
        case .notConnectedToInternet, .networkConnectionLost: return .transport("You're offline.")
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
             .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot, .clientCertificateRejected:
            return .transport("The server's certificate couldn't be verified.")
        case .appTransportSecurityRequiresSecureConnection:
            return .transport("This build only allows encrypted connections to that address.")
        default: return .transport(url.localizedDescription)
        }
    }
}
