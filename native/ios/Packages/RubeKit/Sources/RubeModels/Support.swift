// The hand-written half of RubeModels: what the generated `API.swift`
// refers to but can't describe itself. Kept beside it, and kept small, so the
// generated file stays a pure function of the server's schemas.

import Foundation

/// One tRPC procedure: where it lives, whether it is a GET (query) or POST
/// (mutation), and the types it takes and answers with. The generated
/// `PortalAPI` / `AdminAPI` enums hold one of these per procedure the app
/// calls; the client in `RubeAPI` is what sends them.
public struct Endpoint<Input: Encodable & Sendable, Output: Decodable & Sendable>: Sendable {
    public enum Kind: Sendable { case query, mutation }

    public let path: String
    public let kind: Kind

    public init(path: String, kind: Kind) {
        self.path = path
        self.kind = kind
    }
}

/// A procedure that takes no input. Encodes to nothing — the client leaves
/// `?input=` off a query and sends no body with a mutation.
public struct NoInput: Codable, Sendable, Hashable {
    public init() {}
}

/// A procedure that answers nothing. tRPC sends `{"result":{}}` with no
/// `data`; the client returns this instead of failing to decode a missing key.
public struct NoOutput: Codable, Sendable, Hashable {
    public init() {}
}

/// A value with no fixed shape — a rule's config, an event's metadata. Shown,
/// not interpreted.
public enum JSONValue: Codable, Sendable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

/// A coding key made from any string — how a union reads its discriminator
/// before it knows which variant it is decoding.
public struct AnyCodingKey: CodingKey, Hashable, Sendable {
    public var stringValue: String
    public var intValue: Int? { nil }
    public init(_ string: String) { stringValue = string }
    public init?(stringValue: String) { self.stringValue = stringValue }
    public init?(intValue: Int) { nil }
}
