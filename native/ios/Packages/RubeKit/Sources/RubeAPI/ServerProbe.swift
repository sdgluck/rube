// Ask a typed-in address whether it is a Rube the app can use, before
// anything is saved and — more to the point — before it is handed a Plex token
// at sign-in. A connect link can come from anywhere; this is the check that
// the address on it is the kind of server it claims to be.
//
// A plain GET of `auth.server` rather than the tRPC client: the answer is
// judged from the raw body, so "a router's login page" is "not Rube"
// rather than a decode error.

import Foundation

public struct ServerProbe: Sendable {
    public static let timeout: TimeInterval = 8
    let session: URLSession

    public init(session: URLSession = .rube) {
        self.session = session
    }

    public func probe(_ input: String, want: ServerProduct) async -> ServerCheck {
        let candidates = ServerAddress.candidates(input)
        guard !candidates.isEmpty else { return .failed(.notAnAddress) }
        var best: ProbeFailure = .unreachable(detail: nil)
        for origin in candidates {
            guard let url = URL(string: "\(origin)/api/trpc/auth.server") else { continue }
            var request = URLRequest(url: url, timeoutInterval: Self.timeout)
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            let body: Data
            do {
                (body, _) = try await session.data(for: request)
            } catch {
                if Task.isCancelled { return .failed(.unreachable(detail: nil)) }
                if case .unreachable(nil) = best { best = .unreachable(detail: APIError.fromTransport(error).message) }
                continue
            }
            let check = ServerAddress.judge(origin: origin, body: body, want: want)
            switch check {
            case .ok: return check
            case .failed(let failure) where failure.rank >= best.rank: best = failure
            case .failed: break
            }
        }
        return .failed(best)
    }
}
