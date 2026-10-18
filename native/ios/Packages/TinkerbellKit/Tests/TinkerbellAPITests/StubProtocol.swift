// A URLProtocol that answers from a closure, per host.
//
// Keyed by host rather than one global handler because Swift Testing runs
// tests in parallel: each test invents its own `*.test` host and can't see
// another's answers or requests.

import Foundation
import Synchronization

struct StubResponse: Sendable {
    var status: Int = 200
    var body: Data
    init(status: Int = 200, json: String) {
        self.status = status
        self.body = Data(json.utf8)
    }
}

struct Recorded: Sendable {
    let method: String
    let url: URL
    let headers: [String: String]
    let body: Data?
}

final class StubProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (Recorded) throws -> StubResponse
    static let handlers = Mutex<[String: Handler]>([:])
    static let journal = Mutex<[String: [Recorded]]>([:])

    /// A session that only ever reaches the stub.
    static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return URLSession(configuration: config)
    }()

    static func register(host: String, _ handler: @escaping Handler) {
        handlers.withLock { $0[host] = handler }
        journal.withLock { $0[host] = [] }
    }

    static func requests(host: String) -> [Recorded] {
        journal.withLock { $0[host] ?? [] }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let url = request.url!
        let host = url.host ?? ""
        let recorded = Recorded(
            method: request.httpMethod ?? "GET",
            url: url,
            headers: request.allHTTPHeaderFields ?? [:],
            body: request.httpBody ?? request.httpBodyStream.map(Self.read)
        )
        Self.journal.withLock { $0[host, default: []].append(recorded) }
        guard let handler = Self.handlers.withLock({ $0[host] }) else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
            return
        }
        do {
            let stub = try handler(recorded)
            let response = HTTPURLResponse(url: url, statusCode: stub.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: stub.body)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}

func uniqueHost(_ name: String = #function) -> String {
    let safe = name.lowercased().filter { $0.isLetter || $0.isNumber }
    return "\(safe.prefix(40))-\(UUID().uuidString.prefix(8).lowercased()).test"
}
