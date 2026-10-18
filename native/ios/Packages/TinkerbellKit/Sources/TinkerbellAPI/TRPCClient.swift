// The app's half of the tRPC wire protocol: plain JSON, no transformer, no
// batching — so a query is `GET /api/trpc/<path>?input=<json>` and a mutation
// is `POST` with the JSON as its body.
//
// Hand-rolled rather than a generic HTTP layer because the envelope is the
// whole contract: `{"result":{"data":…}}` or `{"error":{…,"data":{"code"}}}`,
// and a void procedure answers `{"result":{}}` with no `data` at all. Getting
// that last one wrong turns every "dismiss" into a decode failure.

import Foundation
import TinkerbellModels

public struct TRPCClient: Sendable {
    /// What a request presents. A movie-match guest has no session, only a
    /// token for one room, and the server reads it from its own header.
    public enum Credential: Sendable, Hashable {
        case none
        case bearer(String)
        case matchGuest(String)
    }

    public let baseURL: URL
    public var credential: Credential
    public var timeout: TimeInterval
    let session: URLSession
    /// Called when the server says the session is gone, before the error is
    /// thrown, so the owner can drop the token and return to sign-in once —
    /// rather than every screen that happened to be loading deciding to.
    let onUnauthorized: (@Sendable () async -> Void)?

    public init(
        baseURL: URL,
        credential: Credential = .none,
        timeout: TimeInterval = 20,
        session: URLSession = .tinkerbell,
        onUnauthorized: (@Sendable () async -> Void)? = nil
    ) {
        self.baseURL = baseURL
        self.credential = credential
        self.timeout = timeout
        self.session = session
        self.onUnauthorized = onUnauthorized
    }

    public func with(credential: Credential) -> TRPCClient {
        var copy = self
        copy.credential = credential
        return copy
    }

    public func call<Output>(_ endpoint: Endpoint<NoInput, Output>) async throws(APIError) -> Output {
        try await call(endpoint, NoInput())
    }

    public func call<Input, Output>(_ endpoint: Endpoint<Input, Output>, _ input: Input) async throws(APIError) -> Output {
        let request: URLRequest
        do {
            request = try TRPCRequest.make(baseURL: baseURL, endpoint: endpoint, input: input, credential: credential, timeout: timeout)
        } catch {
            throw .badRequest("The app couldn't encode that request.")
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.fromTransport(error)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        do {
            return try TRPCEnvelope.decode(Output.self, data: data, status: status)
        } catch {
            if case .unauthorized = error, let onUnauthorized { await onUnauthorized() }
            throw error
        }
    }
}

extension URLSession {
    /// No cookie jar. Sessions travel as a bearer header; a cookie a server set
    /// along the way would otherwise ride along on every later request,
    /// including to the other server.
    public static let tinkerbell: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()
}

/// Building the request, separate from sending it so tests can read it.
public enum TRPCRequest {
    /// RFC 3986 unreserved characters only. The server reads `?input=` with
    /// URLSearchParams, which turns a bare `+` into a space — so a search for
    /// "C++" would arrive as "C  " if `+` went through as-is.
    static let queryValueAllowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    public static func make<Input, Output>(
        baseURL: URL,
        endpoint: Endpoint<Input, Output>,
        input: Input,
        credential: TRPCClient.Credential,
        timeout: TimeInterval
    ) throws -> URLRequest {
        let hasInput = !(Input.self == NoInput.self)
        let body = hasInput ? try encoder.encode(input) : nil
        var url = baseURL.appending(path: "api/trpc/\(endpoint.path)")
        if endpoint.kind == .query, let body {
            let json = String(decoding: body, as: UTF8.self)
            let encoded = json.addingPercentEncoding(withAllowedCharacters: queryValueAllowed) ?? json
            // Set as a percent-encoded query so URL doesn't re-encode the `%`.
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
            components.percentEncodedQuery = "input=\(encoded)"
            url = components.url!
        }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = endpoint.kind == .query ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if endpoint.kind == .mutation, let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        switch credential {
        case .none: break
        case .bearer(let token): request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        case .matchGuest(let token): request.setValue(token, forHTTPHeaderField: "X-Match-Guest")
        }
        return request
    }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        // Stable output, so a GET for the same input is the same URL.
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return e
    }()
}

/// Reading the envelope. Pure, so every shape the server sends is a test.
public enum TRPCEnvelope {
    struct ErrorBody: Decodable {
        struct Inner: Decodable {
            struct Data: Decodable {
                let code: String?
                let httpStatus: Int?
            }
            let message: String?
            let data: Data?
        }
        let error: Inner
    }

    struct Success<T: Decodable>: Decodable {
        struct Result: Decodable {
            let data: T
        }
        let result: Result
    }

    public static func decode<Output: Decodable>(_ type: Output.Type, data: Data, status: Int) throws(APIError) -> Output {
        let decoder = JSONDecoder()
        if let failure = try? decoder.decode(ErrorBody.self, from: data) {
            throw APIError.fromTRPC(
                code: failure.error.data?.code,
                status: failure.error.data?.httpStatus ?? status,
                message: failure.error.message ?? ""
            )
        }
        guard (200..<300).contains(status) else {
            // A proxy's error page, or a server too old to have the route.
            throw APIError.fromTRPC(code: nil, status: status, message: "")
        }
        if Output.self == NoOutput.self { return NoOutput() as! Output }
        do {
            return try decoder.decode(Success<Output>.self, from: data).result.data
        } catch DecodingError.keyNotFound(let key, _) where key.stringValue == "data" {
            // `{"result":{}}`: tRPC's spelling of a procedure that returned
            // nothing. For an optional output that is nil, not a failure.
            if let none = (Output.self as? any OptionalMarker.Type)?.nilValue as? Output { return none }
            throw .decoding("result.data is missing")
        } catch {
            throw .decoding(describe(error))
        }
    }

    static func describe(_ error: any Error) -> String {
        switch error as? DecodingError {
        case .keyNotFound(let key, let ctx)?: return "missing \(path(ctx.codingPath + [key]))"
        case .typeMismatch(let type, let ctx)?: return "\(path(ctx.codingPath)) is not \(type)"
        case .valueNotFound(let type, let ctx)?: return "\(path(ctx.codingPath)) is null, expected \(type)"
        case .dataCorrupted(let ctx)?: return "\(path(ctx.codingPath)): \(ctx.debugDescription)"
        default: return String(describing: error)
        }
    }

    static func path(_ keys: [any CodingKey]) -> String {
        keys.map { $0.intValue.map { "[\($0)]" } ?? $0.stringValue }.joined(separator: ".")
    }
}

/// Lets the envelope reader produce `nil` for an `Optional` output without
/// knowing the wrapped type.
protocol OptionalMarker {
    static var nilValue: Self { get }
}

extension Optional: OptionalMarker {
    static var nilValue: Self { nil }
}
