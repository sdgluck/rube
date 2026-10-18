// The admin's first screen: what's playing, whether anything is broken, and
// how the library and the jobs are doing — the questions you open an admin
// app on your phone to answer. Now playing polls; the rest refreshes on pull.

#if os(iOS)
import SwiftUI
import TinkerbellAPI
import TinkerbellCore
import TinkerbellModels

struct OverviewView: View {
    @Environment(AdminModel.self) private var model
    @State private var sessions: [PlexSession] = []
    @State private var overview: LoadState<Admin.StatsOverviewOutput> = .loading
    @State private var activity: Admin.StatsActivityOutput?
    @State private var ops: Admin.StatsOpsOutput?
    @State private var problems: Admin.ProblemsListOutput?
    @State private var health: Admin.HealthStatusOutput = []
    @State private var recent: Admin.StatsRecentlyAddedOutput?
    @State private var selectedSession: PlexSession?

    var body: some View {
        List {
            if model.openAuth {
                Section {
                    NoticeRow("Admin sign-in is off on this server — anyone who can reach it can administer it.",
                              systemImage: "lock.open.trianglebadge.exclamationmark", tone: .danger)
                }
            }

            Section("Now playing") {
                if sessions.isEmpty {
                    Text("Nothing is playing.").foregroundStyle(.secondary)
                }
                ForEach(sessions, id: \.self) { session in
                    Button { selectedSession = session } label: { SessionRow(session: session) }
                        .foregroundStyle(.primary)
                }
            }

            attention

            if let error = overview.error {
                Section { ErrorStateView(error: error) { await load() } }
            }

            if let recent, !recent.items.isEmpty {
                Section("Recently added") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(spacing: 12) {
                            ForEach(recent.items, id: \.ratingKey) { item in
                                NavigationLink(value: AdminRoute.media(ratingKey: item.ratingKey, title: item.title)) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        RemoteImage(model.image(item.thumb))
                                            .frame(width: 96, height: 144)
                                            .clipShape(.rect(cornerRadius: 8))
                                        Text(item.grandparentTitle ?? item.title).font(.caption).lineLimit(1)
                                        Text(item.addedAt.asDate, style: .relative).font(.caption2).foregroundStyle(.secondary)
                                    }
                                    .frame(width: 96)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }
            }

            if let o = overview.value {
                Section("Library") {
                    LabeledContent("Items", value: o.totalItems.formatted())
                    LabeledContent("Movies", value: o.movieCount.formatted())
                    LabeledContent("Shows", value: "\(o.showCount.formatted()) · \(o.episodeCount.formatted()) episodes")
                    LabeledContent("4K", value: Int(o.count4k).formatted())
                    LabeledContent("Added this week", value: Int(o.addedThisWeek).formatted())
                    LabeledContent("Users", value: o.userCount.formatted())
                }
            }

            if let a = activity {
                Section("Activity") {
                    LabeledContent("Plays today", value: Int(a.playsToday).formatted())
                    LabeledContent("Plays this week", value: Int(a.playsWeek).formatted())
                    LabeledContent("Active users this week", value: Int(a.activeUsersWeek).formatted())
                    if let top = a.topUserToday {
                        LabeledContent("Top today", value: "\(top.name) · \(top.plays)")
                    }
                }
            }

            if let ops {
                Section("Operations") {
                    LabeledContent("Failed jobs (24h)", value: Int(ops.failedJobs24h).formatted())
                    if let failure = ops.lastFailure {
                        NavigationLink(value: AdminRoute.jobRun(id: failure.runId)) {
                            LabeledContent("Last failure", value: failure.name)
                        }
                    }
                    LabeledContent("Last sync", value: RelativeTime.string(ms: ops.lastSyncAt))
                    LabeledContent("Up for", value: Durations.short(ms: ops.uptimeSec * 1000))
                }
            }

            Section {
                NavigationLink("Events", value: AdminRoute.events)
                WebAdminLink(path: "/")
            }
        }
        .navigationTitle("Overview")
        .refreshable { await load() }
        .task { await load() }
        .task {
            // Now playing moves; the web dashboard polls it every few seconds too.
            while !Task.isCancelled {
                if let fresh = try? await model.client.call(AdminAPI.statsSessions) { sessions = fresh }
                try? await Task.sleep(for: .seconds(10))
            }
        }
        .sheet(item: $selectedSession) { session in
            SessionSheet(session: session) {
                sessions.removeAll { $0.sessionId == session.sessionId }
            }
            .presentationDetents([.medium])
        }
    }

    @ViewBuilder var attention: some View {
        let open = problems?.problems.filter { !$0.dismissed } ?? []
        let unhealthy = health.filter { $0.configured && $0.status == "error" }
        Section("Attention") {
            NavigationLink(value: AdminRoute.problems) {
                LabeledContent {
                    Text(open.isEmpty ? "None" : "\(open.count)")
                } label: {
                    Label("Problems", systemImage: open.isEmpty ? "checkmark.seal" : "exclamationmark.triangle.fill")
                        .foregroundStyle(open.isEmpty ? Color.primary : .orange)
                }
            }
            NavigationLink(value: AdminRoute.health) {
                LabeledContent {
                    Text(unhealthy.isEmpty ? "All good" : unhealthy.map(\.service).joined(separator: ", "))
                } label: {
                    Label("Health", systemImage: unhealthy.isEmpty ? "heart" : "heart.slash.fill")
                        .foregroundStyle(unhealthy.isEmpty ? Color.primary : .red)
                }
            }
        }
    }

    func load() async {
        let c = model.client
        overview = await LoadState.run(overview) { try await c.call(AdminAPI.statsOverview) }
        async let a = c.call(AdminAPI.statsActivity)
        async let o = c.call(AdminAPI.statsOps)
        async let p = c.call(AdminAPI.problemsList)
        async let h = c.call(AdminAPI.healthStatus)
        async let r = c.call(AdminAPI.statsRecentlyAdded)
        activity = try? await a
        ops = try? await o
        problems = try? await p
        health = (try? await h) ?? health
        recent = try? await r
        await model.refreshMetrics()
    }
}

extension PlexSession: Identifiable {
    public var id: String { sessionId ?? sessionKey ?? "\(user)-\(title)" }
}

struct SessionRow: View {
    @Environment(AdminModel.self) private var model
    let session: PlexSession

    var progress: Double? {
        guard let d = session.duration, d > 0, let o = session.viewOffset else { return nil }
        return min(1, o / d)
    }

    var body: some View {
        HStack(spacing: 12) {
            RemoteImage(model.image(session.parentThumb ?? session.thumb))
                .frame(width: 44, height: 66)
                .clipShape(.rect(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 3) {
                Text(session.grandparentTitle ?? session.title).font(.headline).lineLimit(1)
                if session.grandparentTitle != nil {
                    Text(session.title).font(.subheadline).lineLimit(1)
                }
                HStack(spacing: 4) {
                    Image(systemName: session.state == "paused" ? "pause.fill" : "play.fill")
                    Text("\(session.user) · \(session.player)")
                    if session.decision == "transcode" { Text("· Transcode").foregroundStyle(.orange) }
                }
                .font(.caption).foregroundStyle(.secondary)
                if let progress { ProgressView(value: progress).tint(.accentColor) }
            }
        }
    }
}

struct SessionSheet: View {
    @Environment(AdminModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let session: PlexSession
    let terminated: () -> Void
    @State private var confirm = false
    @State private var error: APIError?

    var body: some View {
        NavigationStack {
            List {
                SessionRow(session: session)
                Section {
                    LabeledContent("Player", value: [session.player, session.platform].compactMap { $0 }.joined(separator: " · "))
                    LabeledContent("Stream", value: session.decision.capitalized)
                    if let res = session.videoResolution { LabeledContent("Resolution", value: res) }
                    if let address = session.address { LabeledContent("Address", value: address + (session.local == true ? " (local)" : "")) }
                }
                if let userID = session.userId {
                    NavigationLink("About \(session.user)", value: AdminRoute.user(id: userID, name: session.user))
                }
                if session.sessionId != nil {
                    Section {
                        Button("Stop Playback", systemImage: "stop.circle", role: .destructive) { confirm = true }
                    }
                }
            }
            .navigationTitle("Now Playing")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: AdminRoute.self) { AdminRouteView(route: $0) }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .confirmationDialog("Stop \(session.user)'s playback?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Stop Playback", role: .destructive) { terminate() }
            } message: {
                Text("Plex ends the stream on their device.")
            }
            .errorAlert($error)
        }
    }

    func terminate() {
        guard let id = session.sessionId else { return }
        Task {
            do {
                _ = try await model.client.call(AdminAPI.usersTerminateSession, .init(sessionId: id, reason: nil))
                terminated()
                dismiss()
            } catch {
                self.error = APIError.from(error)
            }
        }
    }
}

// MARK: Problems

struct ProblemsView: View {
    @Environment(AdminModel.self) private var model
    @State private var state: LoadState<Admin.ProblemsListOutput> = .loading
    @State private var showDismissed = false
    @State private var error: APIError?
    @State private var notice: String?
    @State private var done = 0

    typealias Problem = Admin.ProblemsListOutput.Problem

    var body: some View {
        LoadStateView(state, retry: load) { list in
            let shown = list.problems.filter { showDismissed || !$0.dismissed }
            List {
                if let notice { Section { Text(notice).font(.subheadline) } }
                if shown.isEmpty {
                    ContentUnavailableView("No problems", systemImage: "checkmark.seal",
                                           description: Text(list.lastScannedAt.map { "Last checked \(RelativeTime.string(ms: $0))." } ?? "Not checked yet."))
                        .listRowBackground(Color.clear)
                }
                ForEach(Dictionary(grouping: shown, by: \.kind.rawValue).sorted { $0.key < $1.key }, id: \.key) { kind, problems in
                    Section {
                        ForEach(problems, id: \.fingerprint) { problem in row(problem) }
                    } header: {
                        HStack {
                            Text(Self.kindTitle(kind))
                            Spacer()
                            if problems.filter(\.fixable).count > 1 {
                                Button("Fix All") { fixAll(kind, problems) }.font(.caption)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Problems")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Toggle("Show Dismissed", isOn: $showDismissed)
                    Button("Check Again", systemImage: "arrow.clockwise") { rescan() }
                    WebAdminLink(path: "/problems")
                } label: { Label("More", systemImage: "ellipsis") }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .errorAlert($error)
        .sensoryFeedback(.success, trigger: done)
    }

    func row(_ p: Problem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(p.title).font(.headline)
            Text(p.detail).font(.subheadline).foregroundStyle(.secondary)
            if p.fixPending == true { Label("Fix in progress", systemImage: "hourglass").font(.caption).foregroundStyle(.secondary) }
            if p.dismissed { Label("Dismissed", systemImage: "eye.slash").font(.caption).foregroundStyle(.secondary) }
        }
        .swipeActions(edge: .trailing) {
            if p.dismissed {
                Button("Restore", systemImage: "eye") { act { _ = try await model.client.call(AdminAPI.problemsUndismiss, .init(kind: p.kind, subject: p.subject)) } }
            } else {
                Button("Dismiss", systemImage: "eye.slash") { act { _ = try await model.client.call(AdminAPI.problemsDismiss, .init(kind: p.kind, subject: p.subject)) } }
                    .tint(.gray)
            }
        }
        .swipeActions(edge: .leading) {
            if p.fixable && p.fixPending != true {
                Button(p.fixLabel ?? "Fix", systemImage: "wrench.and.screwdriver") { fix(p) }.tint(.accentColor)
            }
        }
        .contextMenu {
            if p.fixable { Button(p.fixLabel ?? "Fix", systemImage: "wrench.and.screwdriver") { fix(p) } }
            Button("Check Again", systemImage: "arrow.clockwise") { rescan(p.subject) }
        }
    }

    func fix(_ p: Problem) {
        act {
            let result = try await model.client.call(AdminAPI.problemsFix, .init(kind: p.kind, subject: p.subject))
            notice = result.message
        }
    }

    func fixAll(_ kind: String, _ problems: [Problem]) {
        act {
            let result = try await model.client.call(AdminAPI.problemsFixAll, .init(kind: .init(rawValue: kind), subjects: problems.filter(\.fixable).map(\.subject)))
            notice = "Fixed \(Int(result.fixed))." + (result.failed.isEmpty ? "" : " \(result.failed.count) failed: " + result.failed.map { "\($0.title) (\($0.error))" }.joined(separator: "; "))
        }
    }

    func rescan(_ subject: String? = nil) {
        act {
            switch try await model.client.call(AdminAPI.problemsRescan, .init(subject: subject)) {
            case .okTrue: notice = "Checking again — this takes a moment."
            case .okFalse(let refused): notice = refused.reason == .alreadyRunning ? "A check is already running." : "Couldn't start a check (\(refused.reason.rawValue))."
            }
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
        state = await LoadState.run(state) { try await model.client.call(AdminAPI.problemsList) }
    }

    static func kindTitle(_ raw: String) -> String {
        switch raw {
        case "episodeOrdering": "Episode ordering"
        case "missingEpisodes": "Missing episodes"
        case "inArrNotInPlex": "In *Arr, not in Plex"
        case "inPlexNotInArr": "In Plex, not in *Arr"
        case "failedImport": "Failed imports"
        case "unknownSize": "Unknown size"
        case "ruleFailing": "Failing rules"
        case "ruleEmpty": "Empty rules"
        case "ruleConflict": "Rule conflicts"
        case "legacyAgent": "Legacy agents"
        case "unmatched": "Unmatched"
        case "duplicateAcrossInstances": "Duplicates across instances"
        default: raw
        }
    }
}

// MARK: Health and events

struct HealthView: View {
    @Environment(AdminModel.self) private var model
    @State private var state: LoadState<Admin.HealthStatusOutput> = .loading
    @State private var checking: Set<String> = []

    var body: some View {
        LoadStateView(state, retry: load) { items in
            List(items, id: \.service) { item in
                HStack(alignment: .top) {
                    Image(systemName: Self.symbol(item)).foregroundStyle(Self.color(item))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.service).font(.headline)
                        Text(item.configured ? (item.message ?? "Not checked yet") : "Not configured")
                            .font(.subheadline).foregroundStyle(.secondary)
                        if let ts = item.timestamp {
                            Text(ts.asDate, style: .relative).font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                    Spacer()
                    if checking.contains(item.service) { ProgressView() }
                }
                .swipeActions {
                    if item.configured {
                        Button("Check", systemImage: "stethoscope") { check(item.service) }.tint(.accentColor)
                    }
                }
            }
        }
        .navigationTitle("Health")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { WebAdminLink(path: "/settings/health", title: "Settings") } }
        .refreshable { await load() }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    static func symbol(_ i: Admin.HealthStatusItem) -> String {
        guard i.configured else { return "minus.circle" }
        switch i.status {
        case "ok": return "checkmark.circle.fill"
        case "error": return "xmark.octagon.fill"
        default: return "questionmark.circle"
        }
    }

    static func color(_ i: Admin.HealthStatusItem) -> Color {
        guard i.configured else { return .secondary }
        return i.status == "ok" ? .green : i.status == "error" ? .red : .secondary
    }

    func check(_ service: String) {
        checking.insert(service)
        Task {
            _ = try? await model.client.call(AdminAPI.healthCheck, .init(service: service))
            checking.remove(service)
            await load()
        }
    }

    func load() async {
        state = await LoadState.run(state) { try await model.client.call(AdminAPI.healthStatus) }
    }
}

struct EventsView: View {
    @Environment(AdminModel.self) private var model
    @State private var items: [Admin.EventsListOutput.Item] = []
    @State private var total = 0
    @State private var search = ""
    @State private var error: APIError?
    @State private var loading = false

    static let page = 50

    var body: some View {
        List {
            if let error { ErrorStateView(error: error) { await reload() } }
            ForEach(items, id: \.id) { event in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(event.type).font(.caption.monospaced()).foregroundStyle(event.type.contains("error") || event.type.contains("fail") ? .red : .secondary)
                        Spacer()
                        Text(event.timestamp.asDate, style: .relative).font(.caption).foregroundStyle(.tertiary)
                    }
                    Text(event.message).font(.subheadline)
                    if event.count > 1 { Text("×\(event.count)").font(.caption).foregroundStyle(.secondary) }
                }
                .onAppear { if event.id == items.last?.id { Task { await more() } } }
            }
            if loading { ProgressView().frame(maxWidth: .infinity) }
        }
        .navigationTitle("Events")
        .searchable(text: $search, prompt: "Search events")
        .task(id: search) {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await reload()
        }
        .refreshable { await reload() }
    }

    func reload() async {
        items = []
        await more()
    }

    func more() async {
        guard !loading, items.isEmpty || items.count < total else { return }
        loading = true
        defer { loading = false }
        do {
            let q = search.trimmingCharacters(in: .whitespaces)
            let page = try await model.client.call(AdminAPI.eventsList, .init(offset: items.count, limit: Self.page, search: q.isEmpty ? nil : q))
            items += page.items
            total = page.total
            error = nil
        } catch APIError.cancelled {
        } catch {
            self.error = APIError.from(error)
        }
    }
}
#endif
