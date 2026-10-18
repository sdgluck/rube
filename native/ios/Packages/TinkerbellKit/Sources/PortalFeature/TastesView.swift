// "Your tastes": a native Form over `preferences.get`, saved as you go.
//
// Autosave, like the web form and like a phone's Settings: the web once had a
// Save button and an edit made there was lost without a word when you
// switched tabs before pressing it. Debounced so a run of chip taps is one
// request, and held back while the digest has no address — which is said
// beside the field instead. From `apps/portal/src/tabs/PreferencesForm.tsx`.

#if os(iOS)
import SwiftUI
import TinkerbellAPI
import TinkerbellCore
import TinkerbellModels

typealias Preferences = Portal.PreferencesGetOutput.Preferences

enum GenreLevel: CaseIterable {
    case none, loved, liked, hated

    /// A tap moves a chip one step along: none → love → like → avoid → none.
    var next: GenreLevel {
        switch self {
        case .none: .loved
        case .loved: .liked
        case .liked: .hated
        case .hated: .none
        }
    }

    var label: String {
        switch self {
        case .none: "No preference"
        case .loved: "Love"
        case .liked: "Like"
        case .hated: "Avoid"
        }
    }

    var symbol: String? {
        switch self {
        case .none: nil
        case .loved: "heart.fill"
        case .liked: "hand.thumbsup"
        case .hated: "nosign"
        }
    }

    var tint: Color {
        switch self {
        case .none: .secondary
        case .loved: .pink
        case .liked: .accentColor
        case .hated: .gray
        }
    }
}

let moodOptions = [
    "Cosy", "Feel-good", "Mind-bending", "Intense", "Dark", "Uplifting", "Nostalgic", "Suspenseful", "Funny",
    "Romantic", "Epic", "Gritty", "Heartwarming", "Thought-provoking", "Action-packed", "Relaxing", "Quirky", "Tear-jerker",
]

struct TastesView: View {
    @Environment(PortalModel.self) private var model
    @State private var state: LoadState<Portal.PreferencesGetOutput> = .loading
    @State private var genres: [String] = []
    @State private var draft: Preferences?
    @State private var optedIn = false
    /// What was last loaded or saved, to tell an edit from a reload.
    @State private var savedKey: String?
    @State private var saveStatus: SaveStatus = .idle
    @State private var saveTask: Task<Void, Never>?
    @State private var tapFeedback = 0

    enum SaveStatus: Equatable {
        case idle, saving, saved
        case failed(String)
    }

    var show: Portal.ComponentsOutput? { model.components }

    var body: some View {
        LoadStateView(state, retry: load) { _ in
            if let draft {
                form(Binding(get: { draft }, set: { self.draft = $0 }))
            }
        }
        .navigationTitle("Your Tastes")
        .task { if state.value == nil { await load() } }
        .onChange(of: key) { _, _ in scheduleSave() }
        .sensoryFeedback(.selection, trigger: tapFeedback)
        .sensoryFeedback(.success, trigger: saveStatus) { _, new in new == .saved }
    }

    func form(_ p: Binding<Preferences>) -> some View {
        Form {
            Section {
                Toggle("Personalize my home screen", isOn: $optedIn)
            } footer: {
                Text(statusText)
            }

            if show?.tastesGenres == true {
                Section {
                    genrePicker(p)
                } header: {
                    Text("Genres")
                } footer: {
                    Text("Tap a genre to change it: Love, Like, Avoid, then no preference.")
                }
            }

            if show?.tastesMoods == true {
                Section {
                    FlowLayout {
                        ForEach(moodOptions, id: \.self) { mood in
                            Chip(mood, isOn: p.wrappedValue.moods.contains(mood)) {
                                tapFeedback += 1
                                if let i = p.wrappedValue.moods.firstIndex(of: mood) { p.wrappedValue.moods.remove(at: i) }
                                else { p.wrappedValue.moods.append(mood) }
                            }
                        }
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text("Moods")
                } footer: {
                    Text("Recommendations lean toward these.")
                }
            }

            if show?.tastesNeverRecommend == true {
                Section("Never recommend") {
                    ForEach(p.wrappedValue.excludedTitles, id: \.self) { title in
                        Text(title)
                    }
                    .onDelete { p.wrappedValue.excludedTitles.remove(atOffsets: $0) }
                    NavigationLink {
                        TitleSearchView(excluded: p.wrappedValue.excludedTitles) { title in
                            if !p.wrappedValue.excludedTitles.contains(title) { p.wrappedValue.excludedTitles.append(title) }
                        }
                    } label: {
                        Label("Add a Title", systemImage: "plus")
                    }
                }
            }

            if show?.tastesRatingFloor == true {
                Section("Minimum rating") {
                    HStack {
                        Slider(value: Binding(get: { p.wrappedValue.ratingFloor ?? 0 }, set: { p.wrappedValue.ratingFloor = $0 > 0 ? $0 : nil }), in: 0...10, step: 0.5)
                        Text(p.wrappedValue.ratingFloor.map { String(format: "%.1f", $0) } ?? "Any")
                            .monospacedDigit()
                            .frame(minWidth: 36, alignment: .trailing)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if show?.tastesRowCount == true {
                Section {
                    Stepper {
                        LabeledContent("Rows on my home", value: p.wrappedValue.rowCount.map(String.init) ?? "Auto")
                    } onIncrement: {
                        p.wrappedValue.rowCount = min(20, (p.wrappedValue.rowCount ?? 0) + 1)
                    } onDecrement: {
                        p.wrappedValue.rowCount = max(1, (p.wrappedValue.rowCount ?? 2) - 1)
                    }
                }
            }

            if show?.tastesWatchedBias == true {
                Section {
                    Picker("Watched bias", selection: p.watchedBias) {
                        Text("Balanced").tag(Preferences.WatchedBias.balanced)
                        Text("New to me").tag(Preferences.WatchedBias.newToMe)
                        Text("Include favourites").tag(Preferences.WatchedBias.includeFavorites)
                    }
                } footer: {
                    Text(Self.biasHint(p.wrappedValue.watchedBias))
                }
            }

            if show?.tastesStrictHate == true {
                Section {
                    Toggle("Never show genres I avoid", isOn: p.strictHate)
                } footer: {
                    Text("Off, they're just shown less often.")
                }
            }

            if show?.tastesDigest == true {
                Section {
                    Picker("Email digest", selection: p.digest.frequency) {
                        Text("Never").tag(Preferences.Digest.Frequency.never)
                        Text("Weekly").tag(Preferences.Digest.Frequency.weekly)
                        Text("Monthly").tag(Preferences.Digest.Frequency.monthly)
                    }
                    if p.wrappedValue.digest.frequency != .never {
                        TextField("you@example.com", text: p.digest.email)
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                } footer: {
                    if let show, TastesPayload.digestNeedsEmail(p.wrappedValue, components: show) {
                        Text("Add an address to get the digest, or choose Never.").foregroundStyle(.orange)
                    } else {
                        Text("What's new, what's popular, and what's leaving.")
                    }
                }
            }
        }
    }

    @ViewBuilder func genrePicker(_ p: Binding<Preferences>) -> some View {
        if genres.isEmpty {
            Text("No genres available.").foregroundStyle(.secondary)
        } else {
            FlowLayout {
                ForEach(genres, id: \.self) { genre in
                    let level = Self.level(of: genre, in: p.wrappedValue)
                    Chip(genre, systemImage: level.symbol, isOn: level != .none, tint: level.tint) {
                        tapFeedback += 1
                        Self.set(genre, to: level.next, in: &p.wrappedValue)
                    }
                    .contextMenu {
                        ForEach(GenreLevel.allCases, id: \.self) { choice in
                            Button(choice.label, systemImage: choice.symbol ?? "circle") { Self.set(genre, to: choice, in: &p.wrappedValue) }
                        }
                    }
                    .accessibilityLabel("\(genre): \(level.label)")
                }
            }
            .padding(.vertical, 4)
        }
    }

    static func level(of genre: String, in p: Preferences) -> GenreLevel {
        if p.genres.loved.contains(genre) { return .loved }
        if p.genres.liked.contains(genre) { return .liked }
        if p.genres.hated.contains(genre) { return .hated }
        return .none
    }

    static func set(_ genre: String, to level: GenreLevel, in p: inout Preferences) {
        p.genres.loved.removeAll { $0 == genre }
        p.genres.liked.removeAll { $0 == genre }
        p.genres.hated.removeAll { $0 == genre }
        switch level {
        case .loved: p.genres.loved.append(genre)
        case .liked: p.genres.liked.append(genre)
        case .hated: p.genres.hated.append(genre)
        case .none: break
        }
    }

    static func biasHint(_ bias: Preferences.WatchedBias) -> String {
        switch bias {
        case .newToMe: "Favour titles you probably haven't watched yet."
        case .includeFavorites: "Also resurface titles you've watched and loved."
        default: "A mix of new titles and ones you've watched before."
        }
    }

    var statusText: String {
        switch saveStatus {
        case .idle: "Changes save automatically."
        case .saving: "Saving…"
        case .saved: "Saved"
        case .failed(let message): "Couldn't save: \(message)"
        }
    }

    /// The form as a comparable value: the draft and the opt-in together.
    var key: String {
        guard let draft, let data = try? JSONEncoder().encode(draft) else { return "" }
        return "\(optedIn)|" + String(decoding: data, as: UTF8.self)
    }

    func load() async {
        state = await LoadState.run(state) { try await model.client.call(PortalAPI.preferencesGet) }
        if case .forbidden = state.error { await model.componentWentAway(); return }
        guard let loaded = state.value else { return }
        genres = (try? await model.client.call(PortalAPI.availableGenres)) ?? []
        draft = loaded.preferences
        optedIn = loaded.optedIn
        savedKey = key
    }

    func scheduleSave() {
        guard savedKey != nil, key != savedKey, let draft, let show else { return }
        saveTask?.cancel()
        if TastesPayload.digestNeedsEmail(draft, components: show) { saveStatus = .idle; return }
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            await save()
        }
    }

    func save() async {
        guard let draft, let show, let payload = try? TastesPayload.make(draft, components: show) else { return }
        let sentKey = key
        saveStatus = .saving
        do {
            _ = try await model.client.call(PortalAPI.preferencesSet, .init(preferences: payload, optedIn: optedIn))
            savedKey = sentKey
            saveStatus = .saved
        } catch APIError.forbidden {
            saveStatus = .idle
            await model.componentWentAway()
        } catch APIError.cancelled {
            saveStatus = .idle
        } catch {
            saveStatus = .failed(error.userMessage)
        }
    }
}

/// Search the library for a title to never recommend.
struct TitleSearchView: View {
    @Environment(PortalModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let excluded: [String]
    let add: (String) -> Void
    @State private var query = ""
    @State private var results: [String] = []

    var body: some View {
        List {
            ForEach(results.filter { !excluded.contains($0) }, id: \.self) { title in
                Button(title) {
                    add(title)
                    dismiss()
                }
                .foregroundStyle(.primary)
            }
            let typed = query.trimmingCharacters(in: .whitespaces)
            if !typed.isEmpty && !results.contains(typed) {
                Button("Add “\(typed)”") {
                    add(typed)
                    dismiss()
                }
            }
        }
        .overlay {
            if query.trimmingCharacters(in: .whitespaces).count < 2 && results.isEmpty {
                ContentUnavailableView("Search your library", systemImage: "magnifyingglass", description: Text("Type at least two letters."))
            }
        }
        .navigationTitle("Never Recommend")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search titles")
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard q.count >= 2 else { results = []; return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            results = (try? await model.client.call(PortalAPI.searchTitles, .init(q: q))) ?? []
        }
    }
}
#endif
