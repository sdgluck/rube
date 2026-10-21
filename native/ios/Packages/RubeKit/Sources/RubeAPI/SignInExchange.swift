// Trading a Plex token for a Rube session, on each server separately.
//
// The portal and admin servers each ask plex.tv who the token belongs to and
// decide for themselves; neither trusts the other's answer, so a session from
// one is worthless to the other. The outcomes are kept apart too: being a
// portal user and not an admin is the ordinary case, not a failed sign-in.

import Foundation
import RubeModels

public enum ExchangeOutcome: Sendable, Hashable {
    case signedIn(username: String, token: String)
    /// Admin only: sign-in is switched off on that server, so there is no
    /// session to hold — every request is already allowed.
    case open
    /// The server knows who this is and won't let them in. Its message says why.
    case refused(String)
    case failed(APIError)
}

public enum SignInExchange {
    public static func portal(_ client: TRPCClient, plexToken: String) async -> ExchangeOutcome {
        do {
            let out = try await client.with(credential: .none).call(PortalAPI.authExchange, .init(plexToken: plexToken))
            return .signedIn(username: out.username, token: out.token)
        } catch {
            return outcome(for: error)
        }
    }

    public static func admin(_ client: TRPCClient, plexToken: String) async -> ExchangeOutcome {
        do {
            switch try await client.with(credential: .none).call(AdminAPI.authExchange, .init(plexToken: plexToken)) {
            case .ok(let signedIn): return .signedIn(username: signedIn.username, token: signedIn.token)
            case .open: return .open
            }
        } catch {
            return outcome(for: error)
        }
    }

    static func outcome(for error: APIError) -> ExchangeOutcome {
        if case .forbidden(let message) = error { return .refused(message) }
        return .failed(error)
    }

    /// Best effort: the session is dropped locally whatever the server says,
    /// because a sign-out that fails offline must still sign out.
    public static func logoutPortal(_ client: TRPCClient) async {
        _ = try? await client.call(PortalAPI.authLogout)
    }

    public static func logoutAdmin(_ client: TRPCClient) async {
        _ = try? await client.call(AdminAPI.authLogout)
    }
}
