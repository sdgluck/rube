// Jobs and rules: run one, watch it, read its log, cancel it.
//
// The active-run lists are polled every two seconds while on screen, as the
// web sidebar does, so a run started here shows its progress without a
// refresh. Logs are fetched by offset — only what was appended since the last
// poll — because the whole log once rode along with every poll and a chatty
// job turned that into megabytes a second (`useRunLog.ts`).

#if os(iOS)
import SwiftUI
import TinkerbellAPI
import TinkerbellCore
import TinkerbellModels

struct JobsAndRulesView: View {
    enum Pane: Hashable { case jobs, rules }
    @State private var pane: Pane = .jobs

    var body: some View {
        Group {
            switch pane {
            case .jobs: JobsList()
            case .rules: RulesList()
            }
        }
        .safeAreaInset(edge: .top) {
            Picker("Show", selection: $pane) {
                Text("Jobs").tag(Pane.jobs)
                Text("Rules").tag(Pane.rules)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.bottom, 6)
        }
        .navigationTitle(pane == .jobs ? "Jobs" : "Rules")
    }
}

// MARK: Jobs

struct JobsList: View {
    @Environment(AdminModel.self) private var model
    @State private var jobs: LoadState<Admin.JobsListOutput> = .loading
    @State private var active: Admin.JobsActiveRunsOutput = []
    @State private var recent: Admin.JobsRecentRunsOutput = []
    @State private var search = ""
    @State private var error: APIError?
    @State private var started = 0

    var body: some View {
        LoadStateView(jobs, retry: load) { list in
            List {
                if !active.isEmpty {
                    Section("Running") {
                        ForEach(active, id: \.id) { run in
                            NavigationLink(value: AdminRoute.jobRun(id: run.id)) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(run.jobName).font(.headline)
                                    ProgressView(value: min(1, max(0, run.progress))) { Text(run.message).font(.caption).lineLimit(1) }
                                }
                            }
                            .swipeActions { Button("Cancel", systemImage: "stop.circle", role: .destructive) { cancel(run.id) } }
                        }
                    }
                }
                Section("Jobs") {
                    ForEach(list.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }, id: \.id) { job in
                        NavigationLink(value: AdminRoute.job(id: job.id, name: job.name)) {
                            HStack {
                                RunStatusIcon(status: active.contains { $0.jobId == job.id } ? "running" : job.lastRunStatus)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(job.name).foregroundStyle(job.enabled == 0 ? .secondary : .primary)
                                    Text([job.schedule, job.lastRunStartedAt.map { RelativeTime.string(ms: $0) }].compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption.monospaced()).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .swipeActions(edge: .leading) {
                            Button("Run", systemImage: "play.fill") { start(job.id) }.tint(.accentColor)
                        }
                        .contextMenu { Button("Run Now", systemImage: "play.fill") { start(job.id) } }
                    }
                }
                if !recent.isEmpty {
                    Section("Recent runs") {
                        ForEach(recent.prefix(15), id: \.id) { run in
                            NavigationLink(value: AdminRoute.jobRun(id: run.id)) {
                                HStack {
                                    RunStatusIcon(status: run.status)
                                    VStack(alignment: .leading) {
                                        Text(run.jobName)
                                        Text(run.startedAt.asDate, style: .relative).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
                Section { WebAdminLink(path: "/jobs/schedule", title: "Schedules in Web Admin") }
            }
        }
        .searchable(text: $search, prompt: "Search jobs")
        .refreshable { await load() }
        .task { await load() }
        .task {
            while !Task.isCancelled {
                active = (try? await model.client.call(AdminAPI.jobsActiveRuns)) ?? active
                try? await Task.sleep(for: .seconds(2))
            }
        }
        .errorAlert($error)
        .sensoryFeedback(.success, trigger: started)
    }

    func load() async {
        jobs = await LoadState.run(jobs) { try await model.client.call(AdminAPI.jobsList) }
        recent = (try? await model.client.call(AdminAPI.jobsRecentRuns, .init(limit: 20))) ?? recent
    }

    func start(_ id: String) {
        Task {
            do {
                _ = try await model.client.call(AdminAPI.jobsStart, .init(jobId: id))
                started += 1
                active = (try? await model.client.call(AdminAPI.jobsActiveRuns)) ?? active
            } catch {
                self.error = APIError.from(error)
            }
        }
    }

    func cancel(_ runID: String) {
        Task {
            do { _ = try await model.client.call(AdminAPI.jobsCancel, .init(runId: runID)) } catch { self.error = APIError.from(error) }
        }
    }
}

struct JobDetailView: View {
    @Environment(AdminModel.self) private var model
    let jobID: String
    let name: String
    @State private var runs: LoadState<Admin.JobsRunsOutput> = .loading
    @State private var error: APIError?
    @State private var startedRun: String?

    var body: some View {
        LoadStateView(runs, retry: load) { list in
            List {
                Section {
                    Button { start() } label: { Label("Run Now", systemImage: "play.fill") }
                    WebAdminLink(path: "/jobs/\(jobID)")
                }
                Section("Runs") {
                    if list.isEmpty { Text("Never run.").foregroundStyle(.secondary) }
                    ForEach(list, id: \.id) { run in
                        NavigationLink(value: AdminRoute.jobRun(id: run.id)) {
                            HStack {
                                RunStatusIcon(status: run.status)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(run.startedAt.asDate, format: .dateTime.day().month().hour().minute())
                                    Text(run.message.isEmpty ? run.status : run.message).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(name)
        .navigationDestination(item: $startedRun) { JobRunView(runID: $0) }
        .refreshable { await load() }
        .task { await load() }
        .errorAlert($error)
    }

    func load() async {
        runs = await LoadState.run(runs) { try await model.client.call(AdminAPI.jobsRuns, .init(jobId: jobID, limit: 30)) }
    }

    func start() {
        Task {
            do {
                startedRun = try await model.client.call(AdminAPI.jobsStart, .init(jobId: jobID)).runId
            } catch {
                self.error = APIError.from(error)
            }
        }
    }
}

struct JobRunView: View {
    @Environment(AdminModel.self) private var model
    let runID: String
    @State private var run: LoadState<Admin.JobsRunOutput> = .loading
    @State private var ruleRuns: [RuleRunSummary] = []
    @State private var confirmCancel = false
    @State private var error: APIError?

    var body: some View {
        LoadStateView(run, retry: load) { r in
            List {
                Section {
                    LabeledContent("Status") { HStack { RunStatusIcon(status: r.status); Text(r.status.capitalized) } }
                    if isRunActive(r.status) { ProgressView(value: min(1, max(0, r.progress))) }
                    if !r.message.isEmpty { Text(r.message).font(.subheadline) }
                    LabeledContent("Started", value: r.startedAt.asDate.formatted(date: .abbreviated, time: .shortened))
                    if let f = r.finishedAt {
                        LabeledContent("Took", value: Duration.milliseconds(f - r.startedAt).formatted(.units(allowed: [.hours, .minutes, .seconds], width: .abbreviated)))
                    }
                    if let kind = r.failureKind { LabeledContent("Failure", value: kind) }
                    if let variant = r.variant { LabeledContent("Variant", value: variant) }
                }
                if isRunActive(r.status) {
                    Section { Button("Cancel Run", systemImage: "stop.circle", role: .destructive) { confirmCancel = true } }
                }
                if !ruleRuns.isEmpty {
                    Section("Rules in this run") {
                        ForEach(ruleRuns, id: \.id) { rr in
                            NavigationLink(value: AdminRoute.ruleRun(id: rr.id)) {
                                HStack { RunStatusIcon(status: rr.status); Text(rr.ruleName) }
                            }
                        }
                    }
                }
                Section("Log") {
                    LogView(runID: runID, active: isRunActive(r.status), fetch: { id, offset in
                        let out = try await model.client.call(AdminAPI.jobsRunLog, .init(runId: id, offset: offset))
                        return (out.chunk, Int(out.nextOffset), Int(out.size))
                    }, full: { id in try await model.client.call(AdminAPI.jobsFullLog, .init(runId: id)).log })
                }
            }
            .navigationTitle(r.jobName ?? "Run")
            .confirmationDialog("Cancel this run?", isPresented: $confirmCancel, titleVisibility: .visible) {
                Button("Cancel Run", role: .destructive) {
                    Task {
                        do { _ = try await model.client.call(AdminAPI.jobsCancel, .init(runId: runID)) } catch { self.error = APIError.from(error) }
                    }
                }
                Button("Keep Running", role: .cancel) {}
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task {
            while !Task.isCancelled {
                await load()
                if let r = run.value, !isRunActive(r.status) { break }
                try? await Task.sleep(for: .seconds(1))
            }
        }
        .errorAlert($error)
    }

    func load() async {
        run = await LoadState.run(run) { try await model.client.call(AdminAPI.jobsRun, .init(runId: runID)) }
        ruleRuns = (try? await model.client.call(AdminAPI.rulesRunsForJobRun, .init(jobRunId: runID))) ?? ruleRuns
    }
}

/// A run's log, appended by offset while the run is live.
struct LogView: View {
    let runID: String
    let active: Bool
    let fetch: (String, Int) async throws -> (chunk: String, next: Int, size: Int)
    let full: (String) async throws -> String
    @State private var text = ""
    @State private var offset = 0

    var body: some View {
        Group {
            if text.isEmpty {
                Text(active ? "Waiting for output…" : "No log.").foregroundStyle(.secondary)
            } else {
                ScrollView(.horizontal) {
                    Text(text.suffix(60_000))
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if !text.isEmpty {
                ShareLink(item: text, subject: Text("Run log")) {
                    Label("Share Log", systemImage: "square.and.arrow.up")
                }
            }
        }
        .task(id: active) {
            repeat {
                await poll()
                if !active { break }
                try? await Task.sleep(for: .seconds(1))
            } while !Task.isCancelled
        }
    }

    func poll() async {
        // A finished run's log in one request, not a slice loop.
        if !active, offset == 0, let whole = try? await full(runID) {
            text = whole
            offset = whole.utf8.count
            return
        }
        guard let slice = try? await fetch(runID, offset) else { return }
        if slice.size < offset {
            // The stored log shrank — a rewrite, not an append. Take it whole.
            if let whole = try? await fetch(runID, 0) {
                text = whole.chunk
                offset = whole.next
            }
            return
        }
        if !slice.chunk.isEmpty {
            text += slice.chunk
            offset = slice.next
        }
    }
}

// MARK: Rules

struct RulesList: View {
    @Environment(AdminModel.self) private var model
    @State private var rules: LoadState<Admin.RulesListOutput> = .loading
    @State private var active: Admin.RulesActiveRunsOutput = []
    @State private var recent: Admin.RulesRecentRunsOutput = []
    @State private var search = ""
    @State private var error: APIError?
    @State private var started = 0

    var body: some View {
        LoadStateView(rules, retry: load) { list in
            List {
                if !active.isEmpty {
                    Section("Running") {
                        ForEach(active, id: \.id) { run in
                            NavigationLink(value: AdminRoute.ruleRun(id: run.id)) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(run.ruleName).font(.headline)
                                    ProgressView(value: min(1, max(0, run.progress))) { Text(run.message).font(.caption).lineLimit(1) }
                                }
                            }
                            .swipeActions { Button("Cancel", systemImage: "stop.circle", role: .destructive) { cancel(run.id) } }
                        }
                    }
                }
                Section("Rules") {
                    ForEach(list.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }.sorted { $0.position < $1.position }, id: \.id) { rule in
                        NavigationLink(value: AdminRoute.rule(id: rule.id)) {
                            HStack {
                                RunStatusIcon(status: active.contains { $0.ruleId == rule.id } ? "running" : rule.lastRunStatus)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(rule.name).foregroundStyle(rule.enabled == 0 ? .secondary : .primary)
                                    Text(Self.summary(rule)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .swipeActions(edge: .leading) {
                            Button("Run", systemImage: "play.fill") { run(rule.id) }.tint(.accentColor)
                        }
                        .contextMenu {
                            Button("Run Now", systemImage: "play.fill") { run(rule.id) }
                            WebAdminLink(path: "/rules?q=\(rule.name.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? rule.name)", title: "Edit in Web Admin")
                        }
                    }
                }
                if !recent.isEmpty {
                    Section("Recent runs") {
                        ForEach(recent.prefix(15), id: \.id) { run in
                            NavigationLink(value: AdminRoute.ruleRun(id: run.id)) {
                                HStack {
                                    RunStatusIcon(status: run.status)
                                    VStack(alignment: .leading) {
                                        Text(run.ruleName)
                                        Text(run.startedAt.asDate, style: .relative).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .searchable(text: $search, prompt: "Search rules")
        .refreshable { await load() }
        .task { await load() }
        .task {
            while !Task.isCancelled {
                active = (try? await model.client.call(AdminAPI.rulesActiveRuns)) ?? active
                try? await Task.sleep(for: .seconds(2))
            }
        }
        .errorAlert($error)
        .sensoryFeedback(.success, trigger: started)
    }

    static func summary(_ rule: Admin.RulesListItem) -> String {
        var parts = [rule.type]
        if let items = rule.lastRunItemCount { parts.append("\(items) items") }
        if let at = rule.lastRunAt { parts.append(RelativeTime.string(ms: at)) }
        if rule.enabled == 0 { parts.append("Off") }
        return parts.joined(separator: " · ")
    }

    func load() async {
        rules = await LoadState.run(rules) { try await model.client.call(AdminAPI.rulesList) }
        recent = (try? await model.client.call(AdminAPI.rulesRecentRuns, .init(limit: 20))) ?? recent
    }

    func run(_ id: String) {
        Task {
            do {
                _ = try await model.client.call(AdminAPI.rulesRun, .init(id: id))
                started += 1
                active = (try? await model.client.call(AdminAPI.rulesActiveRuns)) ?? active
            } catch {
                self.error = APIError.from(error)
            }
        }
    }

    func cancel(_ runID: String) {
        Task {
            do { _ = try await model.client.call(AdminAPI.rulesCancelRun, .init(runId: runID)) } catch { self.error = APIError.from(error) }
        }
    }
}

struct RuleDetailView: View {
    @Environment(AdminModel.self) private var model
    let ruleID: String
    @State private var rule: Admin.RulesListItem?
    @State private var runs: LoadState<Admin.RulesRunsOutput> = .loading
    @State private var error: APIError?
    @State private var startedRun: String?

    var body: some View {
        LoadStateView(runs, retry: load) { list in
            List {
                if let rule {
                    Section {
                        LabeledContent("Type", value: rule.type)
                        LabeledContent("Enabled", value: rule.enabled == 0 ? "No" : "Yes")
                        if let at = rule.lastRunAt { LabeledContent("Last run", value: RelativeTime.string(ms: at)) }
                        if let items = rule.lastRunItemCount { LabeledContent("Items", value: items.formatted()) }
                        if let collections = rule.lastRunCollectionCount { LabeledContent("Collections", value: collections.formatted()) }
                        if let error = rule.lastRunError { Text(error).font(.footnote).foregroundStyle(.red) }
                    }
                    Section {
                        Button { run() } label: { Label("Run Now", systemImage: "play.fill") }
                        WebAdminLink(path: "/rules?q=\(rule.name.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? rule.name)", title: "Edit in Web Admin")
                        WebAdminLink(path: "/rules/\(ruleID)/runs", title: "Run History in Web Admin")
                    }
                }
                Section("Runs") {
                    if list.isEmpty { Text("Never run.").foregroundStyle(.secondary) }
                    ForEach(list, id: \.id) { r in
                        NavigationLink(value: AdminRoute.ruleRun(id: r.id)) {
                            HStack {
                                RunStatusIcon(status: r.status)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.startedAt.asDate, format: .dateTime.day().month().hour().minute())
                                    Text("\(r.trigger.rawValue) · +\(Int(r.changes.added)) −\(Int(r.changes.removed))\(r.phase == .test ? " · test" : "")")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(rule?.name ?? "Rule")
        .navigationDestination(item: $startedRun) { RuleRunView(runID: $0) }
        .refreshable { await load() }
        .task { await load() }
        .errorAlert($error)
    }

    func load() async {
        rule = (try? await model.client.call(AdminAPI.rulesList))?.first { $0.id == ruleID } ?? rule
        runs = await LoadState.run(runs) { try await model.client.call(AdminAPI.rulesRuns, .init(ruleId: ruleID, limit: 30)) }
    }

    func run() {
        Task {
            do { startedRun = try await model.client.call(AdminAPI.rulesRun, .init(id: ruleID)).runId } catch { self.error = APIError.from(error) }
        }
    }
}

struct RuleRunView: View {
    @Environment(AdminModel.self) private var model
    let runID: String
    @State private var run: LoadState<Admin.RulesRunDetailOutput> = .loading
    @State private var error: APIError?

    var body: some View {
        LoadStateView(run, retry: load) { detail in
            if let r = detail {
                List {
                    Section {
                        LabeledContent("Status") { HStack { RunStatusIcon(status: r.status); Text(r.status.capitalized) } }
                        if isRunActive(r.status) { ProgressView(value: min(1, max(0, r.progress))) }
                        if !r.message.isEmpty { Text(r.message).font(.subheadline) }
                        LabeledContent("Trigger", value: r.trigger.rawValue)
                        LabeledContent("Started", value: r.startedAt.asDate.formatted(date: .abbreviated, time: .shortened))
                        if let items = r.itemCount { LabeledContent("Items", value: items.formatted()) }
                        if let collections = r.collectionCount { LabeledContent("Collections", value: collections.formatted()) }
                        if let e = r.error { Text(e).font(.footnote).foregroundStyle(.red) }
                    }
                    if isRunActive(r.status) {
                        Section {
                            Button("Cancel Run", systemImage: "stop.circle", role: .destructive) {
                                Task {
                                    do { _ = try await model.client.call(AdminAPI.rulesCancelRun, .init(runId: runID)) } catch { self.error = APIError.from(error) }
                                }
                            }
                        }
                    }
                    Section {
                        NavigationLink("Rule", value: AdminRoute.rule(id: r.ruleId))
                        if let job = r.jobRunId { NavigationLink("Job run", value: AdminRoute.jobRun(id: job)) }
                    }
                    Section("Log") {
                        LogView(runID: runID, active: isRunActive(r.status), fetch: { id, offset in
                            let out = try await model.client.call(AdminAPI.rulesRunLog, .init(runId: id, offset: offset))
                            return (out.chunk, Int(out.nextOffset), Int(out.size))
                        }, full: { id in
                            // Rule runs have no full-log endpoint; the slice from 0 is all of it.
                            try await model.client.call(AdminAPI.rulesRunLog, .init(runId: id, offset: 0)).chunk
                        })
                    }
                }
            } else {
                ContentUnavailableView("Run not found", systemImage: "questionmark.folder")
            }
        }
        .navigationTitle("Rule Run")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            while !Task.isCancelled {
                await load()
                if let r = run.value ?? nil, !isRunActive(r.status) { break }
                try? await Task.sleep(for: .seconds(1))
            }
        }
        .errorAlert($error)
    }

    func load() async {
        run = await LoadState.run(run) { try await model.client.call(AdminAPI.rulesRunDetail, .init(runId: runID)) }
    }
}
#endif
