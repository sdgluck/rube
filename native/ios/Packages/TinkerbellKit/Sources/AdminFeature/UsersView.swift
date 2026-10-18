// The people the server shares with: who watches most, what they've been
// watching, what they're watching right now — with the one action that can't
// wait for a laptop, stopping a stream.

#if os(iOS)
import SwiftUI
import TinkerbellAPI
import TinkerbellCore
import TinkerbellModels

struct UsersView: View {
    @Environment(AdminModel.self) private var model
    @State private var users: [UserSummary] = []
    @State private var total: Int?
    @State private var top: Admin.StatsTopUsersOutput = []
    @State private var playback: [Int: Admin.StatsAllUserPlaybackItem] = [:]
    @State private var search = ""
    @State private var error: APIError?
    @State private var loading = false
    @State private var syncNotice: String?

    static let page = 50

    var body: some View {
        List {
            if let error, users.isEmpty { ErrorStateView(error: error) { await reload() } }
            if let syncNotice { Section { Text(syncNotice).font(.subheadline) } }
            if search.isEmpty && !top.isEmpty {
                Section("Most watching · 30 days") {
                    ForEach(top.prefix(5), id: \.userId) { u in
                        NavigationLink(value: AdminRoute.user(id: u.userId, name: u.name)) {
                            LabeledContent(u.name, value: "\(u.plays) plays · \(Durations.short(ms: u.watchedMs))")
                        }
                    }
                }
            }
            Section(total.map { "\($0) users" } ?? "Users") {
                ForEach(users, id: \.userId) { user in
                    NavigationLink(value: AdminRoute.user(id: user.userId, name: user.username)) {
                        UserRow(user: user, playback: playback[user.userId])
                    }
                    .onAppear { if user.userId == users.last?.userId { Task { await more() } } }
                }
                if loading { ProgressView().frame(maxWidth: .infinity) }
            }
        }
        .navigationTitle("Users")
        .searchable(text: $search, prompt: "Search users")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Sync Users", systemImage: "arrow.triangle.2.circlepath") { sync() }
            }
        }
        .task(id: search) {
            if !search.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
            guard !Task.isCancelled else { return }
            await reload()
        }
        .task {
            top = (try? await model.client.call(AdminAPI.statsTopUsers, .init(periodDays: 30, limit: 5))) ?? []
            let all = (try? await model.client.call(AdminAPI.statsAllUserPlayback, .init(periodDays: 30))) ?? []
            playback = Dictionary(all.map { ($0.userId, $0) }, uniquingKeysWith: { a, _ in a })
        }
        .refreshable { await reload() }
    }

    func reload() async {
        users = []
        total = nil
        await more()
    }

    func more() async {
        guard !loading, total == nil || users.count < total! else { return }
        loading = true
        defer { loading = false }
        do {
            let q = search.trimmingCharacters(in: .whitespaces)
            let page = try await model.client.call(AdminAPI.usersList, .init(offset: users.count, limit: Self.page, search: q.isEmpty ? nil : q))
            users += page.items
            total = page.total
            error = nil
        } catch APIError.cancelled {
        } catch {
            self.error = APIError.from(error)
        }
    }

    func sync() {
        Task {
            do {
                let r = try await model.client.call(AdminAPI.usersSync)
                syncNotice = "Synced \(Int(r.synced)) users from Plex\(r.removed > 0 ? ", removed \(Int(r.removed))" : "")."
                await reload()
            } catch {
                self.error = APIError.from(error)
            }
        }
    }
}

struct UserRow: View {
    let user: UserSummary
    let playback: Admin.StatsAllUserPlaybackItem?

    var body: some View {
        HStack(spacing: 12) {
            Avatar(url: user.thumb, name: user.username)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(user.username).font(.headline)
                    if user.isOwner { Text("Owner").font(.caption2.weight(.semibold)).foregroundStyle(.secondary) }
                    if user.isProtected { Image(systemName: "lock.shield").font(.caption).foregroundStyle(.secondary) }
                }
                Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }

    var detail: String {
        var parts: [String] = []
        if let p = playback, p.plays > 0 { parts.append("\(p.plays) plays · \(Durations.short(ms: p.watchedMs))") }
        if let last = user.lastWatchedTitle { parts.append(last) }
        if !user.accepted { parts.append("Invite pending") }
        if parts.isEmpty { parts.append(user.optedIn ? "Personalized" : "Not personalized") }
        return parts.joined(separator: " · ")
    }
}

/// A Plex avatar is an absolute plex.tv URL, loaded without any header.
struct Avatar: View {
    let url: String?
    let name: String

    var body: some View {
        RemoteImage(url.flatMap(URL.init(string:)).map { ImageRequest(url: $0) }) {
            Circle().fill(.quaternary).overlay { Text(name.prefix(1).uppercased()).font(.headline).foregroundStyle(.secondary) }
        }
        .frame(width: 36, height: 36)
        .clipShape(.circle)
    }
}

struct UserDetailView: View {
    @Environment(AdminModel.self) private var model
    let userID: Int
    let name: String
    @State private var user: LoadState<Admin.UsersGetOutput> = .loading
    @State private var playback: Admin.StatsUserPlaybackOutput?
    @State private var sessions: Admin.UsersSessionsOutput = []
    @State private var history: Admin.UsersHistoryOutput = []
    @State private var stopping: PlexSession?
    @State private var error: APIError?

    var body: some View {
        LoadStateView(user, retry: load) { detail in
            List {
                Section {
                    HStack(spacing: 14) {
                        Avatar(url: detail.user.thumb, name: detail.user.username).scaleEffect(1.4).frame(width: 52, height: 52)
                        VStack(alignment: .leading) {
                            Text(detail.user.username).font(.title3.bold())
                            if let email = detail.user.email { Text(email).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                    LabeledContent("Personalization", value: detail.personalization.status.capitalized)
                    LabeledContent("Collections", value: detail.user.collectionCount.formatted())
                    if let p = playback { LabeledContent("Last 30 days", value: "\(p.plays) plays · \(Durations.short(ms: p.watchedMs))") }
                    if !detail.sections.isEmpty { LabeledContent("Libraries", value: detail.sections.map(\.title).joined(separator: ", ")) }
                }
                if !sessions.isEmpty {
                    Section("Watching now") {
                        ForEach(sessions) { s in
                            SessionRow(session: s)
                                .swipeActions {
                                    if s.sessionId != nil { Button("Stop", systemImage: "stop.circle", role: .destructive) { stopping = s } }
                                }
                        }
                    }
                }
                Section("History") {
                    if history.isEmpty { Text("Nothing watched yet.").foregroundStyle(.secondary) }
                    ForEach(Array(history.enumerated()), id: \.offset) { _, h in
                        NavigationLink(value: AdminRoute.media(ratingKey: h.grandparentRatingKey ?? h.ratingKey, title: h.grandparentTitle ?? h.title)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(h.grandparentTitle.map { "\($0) — \(h.title)" } ?? h.title).lineLimit(1)
                                if let at = h.viewedAt {
                                    Text(Date(timeIntervalSince1970: TimeInterval(at) / (at > 10_000_000_000 ? 1000 : 1)), style: .relative)
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                Section { WebAdminLink(path: "/users/\(userID)") }
            }
        }
        .navigationTitle(name)
        .refreshable { await load() }
        .task { await load() }
        .task {
            while !Task.isCancelled {
                sessions = (try? await model.client.call(AdminAPI.usersSessions, .init(userId: Double(userID)))) ?? sessions
                try? await Task.sleep(for: .seconds(10))
            }
        }
        .confirmationDialog("Stop \(name)'s playback?", isPresented: Binding(get: { stopping != nil }, set: { if !$0 { stopping = nil } }), titleVisibility: .visible, presenting: stopping) { s in
            Button("Stop Playback", role: .destructive) {
                Task {
                    do {
                        _ = try await model.client.call(AdminAPI.usersTerminateSession, .init(sessionId: s.sessionId ?? "", reason: nil))
                        sessions.removeAll { $0.sessionId == s.sessionId }
                    } catch {
                        self.error = APIError.from(error)
                    }
                }
            }
        } message: { s in
            Text("“\(s.grandparentTitle ?? s.title)” stops on \(s.player).")
        }
        .errorAlert($error)
    }

    func load() async {
        user = await LoadState.run(user) { try await model.client.call(AdminAPI.usersGet, .init(userId: Double(userID))) }
        async let p = model.client.call(AdminAPI.statsUserPlayback, .init(userId: Double(userID), periodDays: 30))
        async let h = model.client.call(AdminAPI.usersHistory, .init(userId: Double(userID), limit: 30))
        playback = try? await p
        history = (try? await h) ?? history
    }
}
#endif
