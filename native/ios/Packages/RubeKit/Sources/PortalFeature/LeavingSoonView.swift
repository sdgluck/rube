// What a cleanup rule is about to remove, and the way to say you'd rather it
// didn't. From `apps/portal/src/tabs/LeavingSoon.tsx`.
//
// "Keep" records a vote, not a hold: a shared user must not be able to
// silently overrule the owner's rule, only turn a removal into a decision the
// owner makes. The vote shows at once and is rolled back if it didn't land.

#if os(iOS)
import SwiftUI
import RubeAPI
import RubeCore
import RubeModels

struct LeavingSoonView: View {
    @Environment(PortalModel.self) private var model
    @State private var state: LoadState<Portal.LeavingSoonOutput> = .loading
    @State private var optimistic: [String: Bool] = [:]
    @State private var kept = 0

    var canVote: Bool { model.components?.actionKeep ?? false }

    var body: some View {
        LoadStateView(state, retry: load) { items in
            if items.isEmpty {
                ContentUnavailableView("Nothing is going anywhere", systemImage: "checkmark.circle")
            } else {
                List {
                    Section {
                        ForEach(items, id: \.ratingKey) { item in row(item) }
                    } footer: {
                        Text(canVote ? "Queued for removal. The server owner sees who asks to keep one." : "Queued for removal.")
                    }
                }
            }
        }
        .navigationTitle("Leaving Soon")
        .refreshable { await load() }
        .task { if state.value == nil { await load() } }
        .sensoryFeedback(.success, trigger: kept)
    }

    func row(_ item: Portal.LeavingSoonItem) -> some View {
        let voted = optimistic[item.ratingKey] ?? item.voted
        return HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.headline)
                Text(item.runsRemaining == 0 ? "Goes on the next run" : "In ^[\(item.runsRemaining) more run](inflect: true)")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            if canVote {
                Button {
                    vote(item.ratingKey, keep: !voted)
                } label: {
                    Label(voted ? "Asked to Keep" : "Keep", systemImage: voted ? "checkmark.circle.fill" : "hand.raised")
                }
                .buttonStyle(.bordered)
                .tint(voted ? .accentColor : .secondary)
                .controlSize(.small)
                .accessibilityIdentifier("keep-\(item.ratingKey)")
            }
        }
        .swipeActions(edge: .leading) {
            if canVote {
                Button(voted ? "Undo Keep" : "Keep", systemImage: voted ? "arrow.uturn.backward" : "hand.raised") {
                    vote(item.ratingKey, keep: !voted)
                }
                .tint(.accentColor)
            }
        }
    }

    func vote(_ ratingKey: String, keep: Bool) {
        if keep { kept += 1 }
        optimistic[ratingKey] = keep
        Task {
            do {
                _ = try await model.client.call(PortalAPI.voteKeep, .init(ratingKey: ratingKey, keep: keep))
            } catch APIError.forbidden {
                optimistic[ratingKey] = nil
                await model.componentWentAway()
            } catch {
                optimistic[ratingKey] = nil
            }
        }
    }

    func load() async {
        state = await LoadState.run(state) { try await model.client.call(PortalAPI.leavingSoon) }
        if state.value != nil { optimistic = [:] }
        if case .forbidden = state.error { await model.componentWentAway() }
    }
}

struct AccountView: View {
    @Environment(PortalModel.self) private var model
    @Environment(\.appSettingsSections) private var appSettings
    @State private var summary: Portal.MyWatchSummaryOutput?

    var body: some View {
        Form {
            Section("Plex account") {
                LabeledContent("Signed in as", value: model.me?.username ?? "—")
                LabeledContent("Server", value: ServerConnection(role: .portal, baseURL: model.baseURL).displayHost)
            }
            if let summary {
                Section("Your watching") {
                    LabeledContent("Plays", value: summary.plays.formatted())
                    LabeledContent("Time watched", value: Durations.short(ms: summary.watchedMs))
                }
            }
            appSettings
        }
        .navigationTitle("Account")
        .task { summary = try? await model.client.call(PortalAPI.myWatchSummary) }
        .refreshable { summary = try? await model.client.call(PortalAPI.myWatchSummary) }
    }
}
#endif
