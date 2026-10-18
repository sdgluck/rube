// What Tinkerbell built for this person, and the one-gesture way to say it
// was wrong. From `apps/portal/src/tabs/MyCollections.tsx`.
//
// "Not for me" is optimistic and undoable: the row turns into an undo row at
// once and the request goes a few seconds later, because the server has no
// "un-not-for-me" to call afterwards — the undo window is the only one there is.

#if os(iOS)
import SwiftUI
import TinkerbellAPI
import TinkerbellCore
import TinkerbellModels

struct CollectionsView: View {
    @Environment(PortalModel.self) private var model
    @State private var state: LoadState<Portal.MyCollectionsOutput> = .loading
    /// Titles whose undo window is open, with the task that will send them.
    @State private var pending: [String: Task<Void, Never>] = [:]
    @State private var excluded: Set<String> = []
    @State private var feedback = 0

    static let undoWindow: Duration = .seconds(4)

    var canExclude: Bool { model.components?.actionNotForMe ?? false }

    var body: some View {
        LoadStateView(state, retry: load) { collections in
            List {
                PersonalizationBanner(status: model.personalization)
                if collections.isEmpty {
                    ContentUnavailableView {
                        Label("Nothing yet", systemImage: "square.grid.2x2")
                    } description: {
                        Text("They arrive after the next nightly run.")
                    } actions: {
                        if model.components?.tabTastes == true {
                            Button("Set Your Tastes") { model.tab = .tastes }.buttonStyle(.borderedProminent)
                        }
                    }
                    .listRowBackground(Color.clear)
                }
                ForEach(collections, id: \.ratingKey) { collection in
                    if pending[collection.title] != nil {
                        undoRow(collection.title)
                    } else {
                        row(collection)
                    }
                }
            }
            .animation(.default, value: pending.keys.sorted())
        }
        .navigationTitle("Your Collections")
        .refreshable { await load() }
        .task { if state.value == nil { await load() } }
        .sensoryFeedback(.impact(weight: .light), trigger: feedback)
        .onDisappear {
            // Leaving the tab sends what's pending rather than dropping it.
            for (title, task) in pending { task.cancel(); send(title) }
            pending = [:]
        }
    }

    func row(_ collection: Portal.MyCollectionsItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(collection.title).font(.headline)
                Spacer()
                Text("^[\(collection.itemCount) item](inflect: true)").font(.subheadline).foregroundStyle(.secondary)
            }
            if !collection.summary.isEmpty {
                Text(collection.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
            }
            if excluded.contains(collection.title) {
                Label("Won't show this again", systemImage: "hand.thumbsdown").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .swipeActions(edge: .trailing) {
            if canExclude && !excluded.contains(collection.title) {
                Button("Not for Me", systemImage: "hand.thumbsdown", role: .destructive) { exclude(collection.title) }
            }
        }
        .contextMenu {
            if canExclude && !excluded.contains(collection.title) {
                Button("Not for Me", systemImage: "hand.thumbsdown", role: .destructive) { exclude(collection.title) }
            }
        }
    }

    func undoRow(_ title: String) -> some View {
        HStack {
            Text("You won't see “\(title)” again.").foregroundStyle(.secondary)
            Spacer()
            Button("Undo") { undo(title) }.buttonStyle(.bordered)
        }
    }

    func exclude(_ title: String) {
        feedback += 1
        pending[title] = Task {
            try? await Task.sleep(for: Self.undoWindow)
            guard !Task.isCancelled else { return }
            pending[title] = nil
            send(title)
        }
    }

    func send(_ title: String) {
        excluded.insert(title)
        Task {
            do {
                _ = try await model.client.call(PortalAPI.notInterested, .init(title: title))
            } catch APIError.forbidden {
                excluded.remove(title)
                await model.componentWentAway()
            } catch {
                excluded.remove(title)
            }
        }
    }

    func undo(_ title: String) {
        pending[title]?.cancel()
        pending[title] = nil
    }

    func load() async {
        state = await LoadState.run(state) { try await model.client.call(PortalAPI.myCollections) }
        if case .forbidden = state.error { await model.componentWentAway() }
    }
}

/// Said when personalization isn't live, so an empty list reads as "not yet"
/// rather than "you have no taste".
struct PersonalizationBanner: View {
    let status: Portal.PersonalizationStatusOutput?

    var body: some View {
        switch status {
        case .disabled?:
            NoticeRow("Personalized collections are switched off on this server.", systemImage: "pause.circle", tone: .warning)
        case .enabling?:
            NoticeRow("Personalization is being set up. Your collections will appear soon.", systemImage: "hourglass")
        case .disabling?:
            NoticeRow("Personalization is being switched off on this server.", systemImage: "hourglass", tone: .warning)
        default:
            EmptyView()
        }
    }
}
#endif
