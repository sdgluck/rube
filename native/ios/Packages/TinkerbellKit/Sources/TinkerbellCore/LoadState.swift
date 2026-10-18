// The four states every screen that fetches is in, and the stock views for
// them. One place, because the web learned the hard way that "the request
// failed" and "you have nothing" must never be the same screen — an
// unreachable server used to render as an empty list.

import Foundation
import SwiftUI
import TinkerbellAPI

public enum LoadState<Value: Sendable>: Sendable {
    case loading
    case loaded(Value)
    case failed(APIError)

    public var value: Value? {
        if case .loaded(let v) = self { return v }
        return nil
    }

    public var error: APIError? {
        if case .failed(let e) = self { return e }
        return nil
    }
}

extension LoadState {
    /// Run a fetch into this state. A refresh that fails keeps what's already
    /// on screen — pulling to refresh on a train shouldn't blank the list —
    /// and a cancelled one (the screen went away) changes nothing.
    @MainActor
    public static func run(_ current: LoadState<Value>, _ fetch: () async throws -> Value) async -> LoadState<Value> {
        do {
            return .loaded(try await fetch())
        } catch {
            let apiError = error as? APIError ?? .transport(error.localizedDescription)
            if case .cancelled = apiError { return current }
            if current.value != nil, case .transport = apiError { return current }
            return .failed(apiError)
        }
    }
}

/// The loading / error / content switch, with retry wired to the same fetch.
public struct LoadStateView<Value: Sendable, Content: View>: View {
    let state: LoadState<Value>
    let retry: () async -> Void
    let content: (Value) -> Content

    public init(_ state: LoadState<Value>, retry: @escaping () async -> Void, @ViewBuilder content: @escaping (Value) -> Content) {
        self.state = state
        self.retry = retry
        self.content = content
    }

    public var body: some View {
        switch state {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let error):
            ErrorStateView(error: error, retry: retry)
        case .loaded(let value):
            content(value)
        }
    }
}

public struct ErrorStateView: View {
    let error: APIError
    let retry: (() async -> Void)?

    public init(error: APIError, retry: (() async -> Void)? = nil) {
        self.error = error
        self.retry = retry
    }

    var symbol: String {
        switch error {
        case .transport: "wifi.exclamationmark"
        case .notConfigured: "wrench.and.screwdriver"
        case .forbidden, .unauthorized: "lock"
        case .notFound: "questionmark.folder"
        default: "exclamationmark.triangle"
        }
    }

    public var body: some View {
        ContentUnavailableView {
            Label(error.title, systemImage: symbol)
        } description: {
            Text(error.message)
        } actions: {
            if let retry {
                Button("Try Again") { Task { await retry() } }
                    .buttonStyle(.bordered)
            }
        }
    }
}

/// A one-line notice above a list: "Admin sign-in is off", "Not encrypted".
public struct NoticeRow: View {
    public enum Tone: Sendable { case info, warning, danger }
    let text: String
    let systemImage: String
    let tone: Tone

    public init(_ text: String, systemImage: String, tone: Tone = .info) {
        self.text = text
        self.systemImage = systemImage
        self.tone = tone
    }

    public var body: some View {
        Label {
            Text(text).font(.subheadline)
        } icon: {
            Image(systemName: systemImage).foregroundStyle(color)
        }
    }

    var color: Color {
        switch tone {
        case .info: .accentColor
        case .warning: .orange
        case .danger: .red
        }
    }
}

extension View {
    /// Present an error from an action (not a load) as a stock alert.
    public func errorAlert(_ error: Binding<APIError?>) -> some View {
        alert(
            error.wrappedValue?.title ?? "",
            isPresented: Binding(get: { error.wrappedValue != nil }, set: { if !$0 { error.wrappedValue = nil } }),
            presenting: error.wrappedValue
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { e in
            Text(e.message)
        }
    }
}

extension APIError {
    /// Any error as an APIError — what a `catch` gets is `any Error` unless
    /// the compiler could infer the typed throw.
    public static func from(_ error: any Error) -> APIError {
        error as? APIError ?? .transport(error.localizedDescription)
    }
}

extension Error {
    /// What to say about any error, typed or not.
    public var userMessage: String { (self as? APIError)?.message ?? localizedDescription }
}

public enum RelativeTime {
    /// "5 min. ago" from a server timestamp in milliseconds.
    public static func string(ms: Int?) -> String {
        guard let ms else { return "Never" }
        let date = Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
        return date.formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
    }

    public static func date(ms: Int) -> Date { Date(timeIntervalSince1970: TimeInterval(ms) / 1000) }
}
