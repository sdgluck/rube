// The Portal half: what a person this server shares with sees.
//
// Tabs follow `apps/portal/src/PortalApp.tsx` — Tastes first, because your
// collections are empty until you've said what you like — and each sits
// behind the admin's switch for it (`components`). A tab the admin turns off
// while you're looking at it disappears on the next refresh rather than
// showing an error: the server answers FORBIDDEN, the screen asks the model to
// re-read the switches, and the tab bar follows.
//
// Every file in the feature targets is iOS-only (`#if os(iOS)`) so that
// `swift test` on macOS can still build the whole package.

#if os(iOS)
import SwiftUI
import TinkerbellAPI
import TinkerbellCore
import TinkerbellModels

public enum PortalTab: String, Hashable, Sendable {
    case tastes, collections, match, leaving, account
}

@Observable
@MainActor
public final class PortalModel {
    public let client: TRPCClient
    public var me: Portal.MeOutput?
    public var components: Portal.ComponentsOutput?
    public var personalization: Portal.PersonalizationStatusOutput?
    public var error: APIError?
    public var tab: PortalTab = .tastes

    public init(client: TRPCClient) {
        self.client = client
    }

    var baseURL: URL { client.baseURL }

    func load() async {
        do {
            async let me = client.call(PortalAPI.me)
            async let components = client.call(PortalAPI.components)
            let (m, c) = try await (me, components)
            self.me = m
            self.components = c
            error = nil
            if !visibleTabs.contains(tab) { tab = visibleTabs.first ?? .account }
        } catch let e as APIError {
            if case .cancelled = e { return }
            if me == nil { error = e }
        } catch {}
        personalization = try? await client.call(PortalAPI.personalizationStatus)
    }

    /// A screen got FORBIDDEN: the admin probably just switched it off.
    func componentWentAway() async {
        if let fresh = try? await client.call(PortalAPI.components) {
            components = fresh
            if !visibleTabs.contains(tab) { tab = visibleTabs.first ?? .account }
        }
    }

    var visibleTabs: [PortalTab] {
        guard let c = components else { return [.account] }
        var tabs: [PortalTab] = []
        if c.tabTastes { tabs.append(.tastes) }
        if c.tabCollections { tabs.append(.collections) }
        if c.tabMatch { tabs.append(.match) }
        if c.tabLeaving { tabs.append(.leaving) }
        return tabs + [.account]
    }

    func poster(_ path: String?) -> ImageRequest? {
        PortalURLs.poster(base: baseURL, path: path).map { ImageRequest(url: $0) }
    }
}

public struct PortalRootView: View {
    @State private var model: PortalModel
    @Environment(ShellState.self) private var shell
    @Environment(\.scenePhase) private var scenePhase

    public init(client: TRPCClient) {
        _model = State(initialValue: PortalModel(client: client))
    }

    public var body: some View {
        Group {
            if model.components != nil {
                tabs
            } else if let error = model.error {
                ErrorStateView(error: error) { await model.load() }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .environment(model)
        .task { await model.load() }
        .onChange(of: scenePhase) { _, phase in
            // Back from the background: the admin may have changed the switches.
            if phase == .active { Task { await model.load() } }
        }
        .onChange(of: shell.pendingMatch, initial: true) { _, link in
            if link != nil, model.components?.tabMatch ?? true { model.tab = .match }
        }
    }

    var tabs: some View {
        TabView(selection: $model.tab) {
            ForEach(model.visibleTabs, id: \.self) { tab in
                Tab(value: tab) {
                    if tab == .match {
                        MatchLobbyView()
                    } else {
                        NavigationStack {
                            screen(tab)
                                .toolbar {
                                    ToolbarItem(placement: .topBarTrailing) { PartMenu() }
                                }
                        }
                    }
                } label: {
                    Label(Self.title(tab), systemImage: Self.symbol(tab))
                }
            }
        }
        .sensoryFeedback(.selection, trigger: model.tab)
    }

    @ViewBuilder func screen(_ tab: PortalTab) -> some View {
        switch tab {
        case .tastes: TastesView()
        case .collections: CollectionsView()
        case .match: EmptyView()
        case .leaving: LeavingSoonView()
        case .account: AccountView()
        }
    }

    static func title(_ tab: PortalTab) -> String {
        switch tab {
        case .tastes: "Tastes"
        case .collections: "Collections"
        case .match: "Match"
        case .leaving: "Leaving"
        case .account: "Account"
        }
    }

    static func symbol(_ tab: PortalTab) -> String {
        switch tab {
        case .tastes: "heart"
        case .collections: "square.grid.2x2"
        case .match: "popcorn"
        case .leaving: "clock"
        case .account: "person.crop.circle"
        }
    }
}
#endif
