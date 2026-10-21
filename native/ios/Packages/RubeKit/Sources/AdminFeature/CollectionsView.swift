// Collections and the media in them, read-mostly: what a rule built, how it
// is doing, why a film is in it, who watched it. Paged by the server, since a
// large library has hundreds of collections.

#if os(iOS)
import SwiftUI
import RubeAPI
import RubeCore
import RubeModels

struct AdminCollectionsView: View {
    @Environment(AdminModel.self) private var model
    @State private var items: [Admin.CollectionsListOutput.Item] = []
    @State private var total: Int?
    @State private var search = ""
    @State private var error: APIError?
    @State private var loading = false

    static let page = 50

    var body: some View {
        List {
            if let error, items.isEmpty { ErrorStateView(error: error) { await reload() } }
            ForEach(items, id: \.plexRatingKey) { c in
                NavigationLink(value: AdminRoute.collection(ratingKey: c.plexRatingKey, title: c.title)) {
                    HStack(spacing: 12) {
                        RemoteImage(model.image(c.thumb)).frame(width: 44, height: 66).clipShape(.rect(cornerRadius: 4))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.title).font(.headline)
                            Text("\(c.sectionTitle) · \(c.childCount) items\(c.smart != 0 ? " · Smart" : "")").font(.caption).foregroundStyle(.secondary)
                            if let p = c.performance, p.plays > 0 {
                                Text("\(p.plays) plays · \(Int(p.viewers)) viewers").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .onAppear { if c.plexRatingKey == items.last?.plexRatingKey { Task { await more() } } }
            }
            if loading { ProgressView().frame(maxWidth: .infinity) }
            if total == 0 { ContentUnavailableView.search(text: search) }
        }
        .navigationTitle("Collections")
        .searchable(text: $search, prompt: "Search collections")
        .task(id: search) {
            if !search.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
            guard !Task.isCancelled else { return }
            await reload()
        }
        .refreshable { await reload() }
    }

    func reload() async {
        items = []
        total = nil
        await more()
    }

    func more() async {
        guard !loading, total == nil || items.count < total! else { return }
        loading = true
        defer { loading = false }
        do {
            let q = search.trimmingCharacters(in: .whitespaces)
            let page = try await model.client.call(AdminAPI.collectionsList, .init(offset: items.count, limit: Self.page, search: q.isEmpty ? nil : q))
            items += page.items
            total = page.total
            error = nil
        } catch APIError.cancelled {
        } catch {
            self.error = APIError.from(error)
        }
    }
}

struct CollectionDetailView: View {
    @Environment(AdminModel.self) private var model
    let ratingKey: String
    let title: String
    @State private var collection: LoadState<Admin.CollectionsGetOutput> = .loading
    @State private var stats: Admin.CollectionsStatsOutput?
    @State private var members: Admin.CollectionsItemsOutput = []
    @State private var syncing = false
    @State private var synced = 0
    @State private var error: APIError?

    var body: some View {
        LoadStateView(collection, retry: load) { c in
            List {
                Section {
                    HStack(alignment: .top, spacing: 14) {
                        RemoteImage(model.image(c.thumb)).frame(width: 90, height: 135).clipShape(.rect(cornerRadius: 8))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(c.sectionTitle).font(.subheadline).foregroundStyle(.secondary)
                            Text("\(c.childCount) items").font(.subheadline)
                            if !c.labels.isEmpty { Text(c.labels.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary) }
                            Text("Synced \(RelativeTime.string(ms: c.syncedAt))").font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                    if !c.summary.isEmpty { Text(c.summary).font(.subheadline) }
                }
                if let s = stats {
                    Section("Stats") {
                        LabeledContent("Runtime", value: Durations.short(ms: Double(s.totalRuntimeMs)))
                        if let range = s.yearRange { LabeledContent("Years", value: "\(Int(range.from))–\(Int(range.to))") }
                        if let w = s.watchedFraction { LabeledContent("Watched", value: w.formatted(.percent.precision(.fractionLength(0)))) }
                        if let p = s.performance { LabeledContent("Plays", value: "\(p.plays) by \(Int(p.viewers)) viewers") }
                        if !s.topGenres.isEmpty { LabeledContent("Top genres", value: s.topGenres.prefix(3).map(\.genre).joined(separator: ", ")) }
                    }
                }
                Section("Items") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 12)], spacing: 12) {
                        ForEach(members, id: \.ratingKey) { m in
                            NavigationLink(value: AdminRoute.media(ratingKey: m.ratingKey, title: m.title)) {
                                VStack(alignment: .leading, spacing: 4) {
                                    RemoteImage(model.image(m.thumb)).aspectRatio(2 / 3, contentMode: .fit).clipShape(.rect(cornerRadius: 6))
                                    Text(m.title).font(.caption).lineLimit(1)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section { WebAdminLink(path: "/collections/\(ratingKey)") }
            }
        }
        .navigationTitle(title)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Sync", systemImage: "arrow.triangle.2.circlepath") { sync() }.disabled(syncing)
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .errorAlert($error)
        .sensoryFeedback(.success, trigger: synced)
    }

    func load() async {
        collection = await LoadState.run(collection) { try await model.client.call(AdminAPI.collectionsGet, .init(ratingKey: ratingKey)) }
        async let s = model.client.call(AdminAPI.collectionsStats, .init(ratingKey: ratingKey))
        async let m = model.client.call(AdminAPI.collectionsItems, .init(ratingKey: ratingKey))
        stats = try? await s
        members = (try? await m) ?? members
    }

    func sync() {
        syncing = true
        Task {
            defer { syncing = false }
            do {
                _ = try await model.client.call(AdminAPI.collectionsSyncOne, .init(ratingKey: ratingKey))
                synced += 1
                await load()
            } catch {
                self.error = APIError.from(error)
            }
        }
    }
}

struct MediaDetailView: View {
    @Environment(AdminModel.self) private var model
    let ratingKey: String
    let title: String
    @State private var media: LoadState<Admin.MediaGetOutput> = .loading
    @State private var why: Admin.MediaWhyOutput = []
    @State private var children: Admin.MediaChildrenOutput = []
    @State private var watchedBy: Admin.StatsWatchedByOutput = []
    @State private var protected = 0
    @State private var error: APIError?

    var body: some View {
        LoadStateView(media, retry: load) { m in
            List {
                Section {
                    HStack(alignment: .top, spacing: 14) {
                        RemoteImage(model.image(m.thumb)).frame(width: 100, height: 150).clipShape(.rect(cornerRadius: 8))
                        VStack(alignment: .leading, spacing: 4) {
                            Text([m.year.map(String.init), m.contentRating, MatchText.runtime(ms: m.duration)].compactMap { $0 }.joined(separator: " · "))
                                .font(.subheadline).foregroundStyle(.secondary)
                            if let r = m.rating ?? m.audienceRating { Label(String(format: "%.1f", r), systemImage: "star.fill").font(.subheadline) }
                            if !m.genres.isEmpty { Text(m.genres.joined(separator: ", ")).font(.caption) }
                            if !m.directors.isEmpty { Text("Directed by \(m.directors.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary) }
                            if let views = m.viewCount, views > 0 { Text("Played \(views)×").font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                    if !m.summary.isEmpty { Text(m.summary).font(.subheadline) }
                }
                if let file = m.media.first {
                    Section("File") {
                        if let res = file.videoResolution ?? m.videoResolution { LabeledContent("Resolution", value: res.uppercased()) }
                        LabeledContent("Video", value: [file.videoCodec, file.videoProfile].compactMap { $0 }.joined(separator: " "))
                        LabeledContent("Audio", value: [file.audioCodec, file.audioChannels.map { "\(Int($0)) ch" }].compactMap { $0 }.joined(separator: " · "))
                        if let size = file.parts.compactMap(\.size).first {
                            LabeledContent("Size", value: ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                        }
                    }
                }
                if !children.isEmpty {
                    Section(m.type == "show" ? "Seasons" : "Episodes") {
                        ForEach(children, id: \.ratingKey) { child in
                            NavigationLink(value: AdminRoute.media(ratingKey: child.ratingKey, title: child.title)) {
                                LabeledContent(child.title, value: child.leafCount.map { "\($0) episodes" } ?? (child.index.map { "#\($0)" } ?? ""))
                            }
                        }
                    }
                }
                if !why.isEmpty {
                    Section("Why it's in its collections") {
                        ForEach(why, id: \.collection.ratingKey) { w in
                            NavigationLink(value: AdminRoute.collection(ratingKey: w.collection.ratingKey, title: w.collection.title)) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(w.collection.title)
                                    if let rule = w.rule { Text("Rule: \(rule.name)").font(.caption).foregroundStyle(.secondary) }
                                    if let criteria = w.criteria { Text(criteria).font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                        }
                    }
                }
                if !watchedBy.isEmpty {
                    Section("Watched by") {
                        ForEach(watchedBy, id: \.userId) { w in
                            NavigationLink(value: AdminRoute.user(id: w.userId, name: w.username)) {
                                LabeledContent(w.username, value: "\(w.plays)× · \(Int(w.maxCompletionPct))%")
                            }
                        }
                    }
                }
                Section {
                    Button("Protect from Cleanup", systemImage: "lock.shield") { protect(m) }
                    WebAdminLink(path: "/media/\(ratingKey)")
                }
            }
            .navigationTitle(m.title)
        }
        .navigationTitle(title)
        .refreshable { await load() }
        .task { await load() }
        .errorAlert($error)
        .sensoryFeedback(.success, trigger: protected)
    }

    func load() async {
        media = await LoadState.run(media) { try await model.client.call(AdminAPI.mediaGet, .init(ratingKey: ratingKey)) }
        async let w = model.client.call(AdminAPI.mediaWhy, .init(ratingKey: ratingKey))
        async let c = model.client.call(AdminAPI.mediaChildren, .init(ratingKey: ratingKey))
        async let b = model.client.call(AdminAPI.statsWatchedBy, .init(ratingKey: ratingKey))
        why = (try? await w) ?? why
        children = (try? await c) ?? children
        watchedBy = (try? await b) ?? watchedBy
    }

    func protect(_ m: Admin.MediaGetOutput) {
        Task {
            do {
                _ = try await model.client.call(AdminAPI.cleanupProtect, .init(kind: .item, value: ratingKey, label: m.title))
                protected += 1
            } catch {
                self.error = APIError.from(error)
            }
        }
    }
}
#endif
