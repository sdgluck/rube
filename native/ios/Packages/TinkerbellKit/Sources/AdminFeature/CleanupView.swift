// The cleanup queue: what rules are about to remove, and the decisions on it.
//
// Keeping (a hold) and protecting are safe and one swipe away. Approving a
// removal and lifting a protection are what let something be deleted, so they
// go through a confirmation dialog. Holding several at once can be undone:
// `holdMany` answers with each item's previous hold, and `restoreHolds` puts
// exactly that back.

#if os(iOS)
import SwiftUI
import TinkerbellAPI
import TinkerbellCore
import TinkerbellModels

struct CleanupView: View {
    @Environment(AdminModel.self) private var model
    @State private var queue: LoadState<Admin.CleanupQueueOutput> = .loading
    @State private var counts: Admin.CleanupCountsOutput = [:]
    @State private var segment: Segment = .due
    @State private var selection: Set<String> = []
    @State private var editMode: EditMode = .inactive
    @State private var toApprove: Admin.CleanupQueueItem?
    @State private var undo: [Admin.CleanupHoldManyOutput.Previou]?
    @State private var error: APIError?
    @State private var done = 0

    enum Segment: Hashable { case due, held }
    typealias Item = Admin.CleanupQueueItem

    static func key(_ i: Item) -> String { "\(i.ruleId)|\(i.ratingKey)" }

    var body: some View {
        LoadStateView(queue, retry: load) { items in
            let shown = items.filter { segment == .held ? $0.held : !$0.held }.sorted { $0.runsRemaining < $1.runsRemaining }
            List(selection: $selection) {
                Section {
                    Picker("Show", selection: $segment) {
                        Text("Due (\(items.filter { !$0.held }.count))").tag(Segment.due)
                        Text("Kept (\(items.filter(\.held).count))").tag(Segment.held)
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    let queued = counts.values.reduce(0) { $0 + $1.queued }
                    Text("\(Int(queued)) queued across \(counts.count) rule\(counts.count == 1 ? "" : "s").")
                }
                if let undo {
                    Section {
                        HStack {
                            Text("Kept \(undo.count).")
                            Spacer()
                            Button("Undo") { restore(undo) }.buttonStyle(.bordered)
                        }
                    }
                }
                if shown.isEmpty {
                    ContentUnavailableView(segment == .due ? "Nothing queued" : "Nothing kept", systemImage: "trash.slash")
                        .listRowBackground(Color.clear)
                }
                ForEach(shown, id: \.self) { item in
                    row(item).tag(Self.key(item))
                }
                Section {
                    NavigationLink("Protections", value: AdminRoute.protections)
                    WebAdminLink(path: "/cleanup/rules", title: "Cleanup Rules in Web Admin")
                }
            }
            .environment(\.editMode, $editMode)
        }
        .navigationTitle("Cleanup")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(editMode.isEditing ? "Done" : "Select") {
                    withAnimation { editMode = editMode.isEditing ? .inactive : .active }
                    selection = []
                }
            }
            if editMode.isEditing {
                ToolbarItem(placement: .bottomBar) {
                    Button("Keep \(selection.count) for 30 Days", systemImage: "hand.raised") { holdSelected() }
                        .disabled(selection.isEmpty)
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog(
            "Approve removing “\(toApprove?.title ?? "")”?",
            isPresented: Binding(get: { toApprove != nil }, set: { if !$0 { toApprove = nil } }),
            titleVisibility: .visible,
            presenting: toApprove
        ) { item in
            Button("Approve Removal", role: .destructive) {
                act { _ = try await model.client.call(AdminAPI.cleanupApprove, .init(ruleId: item.ruleId, ratingKey: item.ratingKey, approved: true)) }
            }
        } message: { item in
            Text("“\(item.ruleName)” will delete it \(item.runsRemaining == 0 ? "on its next run" : "in \(item.runsRemaining) runs").")
        }
        .errorAlert($error)
        .sensoryFeedback(.success, trigger: done)
    }

    func row(_ item: Item) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(item.title).font(.headline)
                if item.isProtected { Image(systemName: "lock.shield").foregroundStyle(.green).accessibilityLabel("Protected") }
            }
            Text(Self.when(item)).font(.subheadline).foregroundStyle(item.runsRemaining == 0 && !item.held ? .red : .secondary)
            Text([item.ruleName, item.fileSize.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary)
            if !item.keepVotes.isEmpty {
                Label("\(item.keepVotes.joined(separator: ", ")) asked to keep", systemImage: "hand.raised.fill").font(.caption).foregroundStyle(.orange)
            }
            if item.requiresApproval {
                Label(item.approved ? "Approved" : "Waiting for your approval", systemImage: item.approved ? "checkmark.seal" : "exclamationmark.bubble")
                    .font(.caption).foregroundStyle(item.approved ? Color.secondary : .orange)
            }
        }
        .swipeActions(edge: .leading) {
            if !item.held {
                Button("Keep", systemImage: "hand.raised") {
                    act { _ = try await model.client.call(AdminAPI.cleanupHold, .init(ruleId: item.ruleId, ratingKey: item.ratingKey, days: 30)) }
                }
                .tint(.accentColor)
            }
            if !item.isProtected {
                Button("Protect", systemImage: "lock.shield") {
                    act { _ = try await model.client.call(AdminAPI.cleanupProtect, .init(kind: .item, value: item.ratingKey, label: item.title)) }
                }
                .tint(.green)
            }
        }
        .swipeActions(edge: .trailing) {
            if item.requiresApproval && !item.approved {
                Button("Approve", systemImage: "checkmark.seal") { toApprove = item }.tint(.red)
            }
            if item.held {
                Button("Stop Keeping", systemImage: "hand.raised.slash") {
                    act { _ = try await model.client.call(AdminAPI.cleanupRestoreHolds, .init(items: [.init(ruleId: item.ruleId, ratingKey: item.ratingKey, heldUntil: nil)])) }
                }
            }
        }
        .contextMenu {
            NavigationLink(value: AdminRoute.media(ratingKey: item.ratingKey, title: item.title)) { Label("Details", systemImage: "info.circle") }
            if item.requiresApproval && !item.approved {
                Button("Approve Removal", systemImage: "checkmark.seal", role: .destructive) { toApprove = item }
            }
        }
    }

    static func when(_ item: Item) -> String {
        if item.held, let until = item.heldUntil {
            return "Kept until \(Date(timeIntervalSince1970: until / 1000).formatted(date: .abbreviated, time: .omitted))"
        }
        if item.held { return "Kept" }
        return item.runsRemaining == 0 ? "Goes on the next run" : "In \(item.runsRemaining) more run\(item.runsRemaining == 1 ? "" : "s")"
    }

    func holdSelected() {
        let items = (queue.value ?? []).filter { selection.contains(Self.key($0)) }.map { Admin.CleanupHoldManyInput.Item(ruleId: $0.ruleId, ratingKey: $0.ratingKey) }
        act {
            let result = try await model.client.call(AdminAPI.cleanupHoldMany, .init(items: items, days: 30))
            undo = result.previous
            selection = []
            editMode = .inactive
        }
    }

    func restore(_ previous: [Admin.CleanupHoldManyOutput.Previou]) {
        act {
            _ = try await model.client.call(AdminAPI.cleanupRestoreHolds, .init(items: previous.map { .init(ruleId: $0.ruleId, ratingKey: $0.ratingKey, heldUntil: $0.heldUntil) }))
            undo = nil
        }
    }

    func act(_ work: @escaping () async throws -> Void) {
        Task {
            do {
                try await work()
                done += 1
                await load()
                await model.refreshMetrics()
            } catch let e as APIError {
                error = e
            } catch {}
        }
    }

    func load() async {
        queue = await LoadState.run(queue) { try await model.client.call(AdminAPI.cleanupQueue, .init()) }
        counts = (try? await model.client.call(AdminAPI.cleanupCounts)) ?? counts
    }
}

struct ProtectionsView: View {
    @Environment(AdminModel.self) private var model
    @State private var state: LoadState<Admin.CleanupProtectionsOutput> = .loading
    @State private var toRemove: Admin.CleanupProtectionsItem?
    @State private var error: APIError?

    var body: some View {
        LoadStateView(state, retry: load) { items in
            List {
                if items.isEmpty {
                    ContentUnavailableView("Nothing protected", systemImage: "lock.shield",
                                           description: Text("Swipe an item in the queue to protect it from every cleanup rule."))
                        .listRowBackground(Color.clear)
                }
                ForEach(items, id: \.id) { p in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.label.isEmpty ? p.value : p.label).font(.headline)
                        Text(p.kind.capitalized + (p.note.isEmpty ? "" : " · \(p.note)")).font(.caption).foregroundStyle(.secondary)
                    }
                    .swipeActions {
                        Button("Unprotect", systemImage: "lock.open", role: .destructive) { toRemove = p }
                    }
                }
            }
        }
        .navigationTitle("Protections")
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog(
            "Stop protecting “\(toRemove?.label ?? "")”?",
            isPresented: Binding(get: { toRemove != nil }, set: { if !$0 { toRemove = nil } }),
            titleVisibility: .visible,
            presenting: toRemove
        ) { p in
            Button("Unprotect", role: .destructive) {
                Task {
                    do {
                        _ = try await model.client.call(AdminAPI.cleanupUnprotect, .init(id: p.id))
                        await load()
                    } catch {
                        self.error = APIError.from(error)
                    }
                }
            }
        } message: { _ in
            Text("Cleanup rules will be able to remove it again.")
        }
        .errorAlert($error)
    }

    func load() async {
        state = await LoadState.run(state) { try await model.client.call(AdminAPI.cleanupProtections) }
    }
}
#endif
