// Choosing tonight's films: presets, genres, length and era, with the count
// of what they leave updating as you pick — a room of zero films can't be
// started. The last choice is remembered, since a household tends to want the
// same evening twice.

#if os(iOS)
import SwiftUI
import TinkerbellAPI
import TinkerbellCore
import TinkerbellModels

struct NewRoomView: View {
    @Environment(PortalModel.self) private var model
    let sectionID: String
    let created: (String) -> Void

    @State private var genres: [String] = []
    @State private var available: [String]?
    @State private var presets: [Portal.MatchPresetsItem] = []
    @State private var maxMinutes = 0
    @State private var era: Era = .any
    @State private var count: Double?
    @State private var creating = false
    @State private var error: APIError?

    static let lengths: [(label: String, value: Int)] = [("Any length", 0), ("Under 90 min", 90), ("Under 2 hours", 120), ("Under 2½ hours", 150)]
    static let lastKey = "tb.match.lastFilters"

    enum Era: String, CaseIterable {
        case any, five = "5", ten = "10", twenty = "20", classic
        var label: String {
            switch self {
            case .any: "Any year"
            case .five: "Last 5 years"
            case .ten: "Last 10 years"
            case .twenty: "Last 20 years"
            case .classic: "Before 2000"
            }
        }
    }

    var filters: Portal.MatchCreateInput.Filters {
        var f = Portal.MatchCreateInput.Filters()
        if !genres.isEmpty { f.genres = genres }
        if maxMinutes > 0 { f.maxMinutes = maxMinutes }
        switch era {
        case .any: break
        case .classic: f.maxYear = 1999
        default: f.minYear = Calendar.current.component(.year, from: .now) - (Int(era.rawValue) ?? 0)
        }
        return f
    }

    var body: some View {
        Form {
            Section {
                Button {
                    create(filters)
                } label: {
                    Text(creating ? "Starting…" : count.map { "Start the Room · \(Int($0)) films" } ?? "Start the Room")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(creating || count == 0)
                .accessibilityIdentifier("create-room")
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            if !presets.isEmpty {
                Section("Or try one of these") {
                    ForEach(presets, id: \.label) { preset in
                        Button {
                            create(Self.createFilters(preset.filters))
                        } label: {
                            LabeledContent(preset.label, value: "\(preset.count)")
                        }
                        .foregroundStyle(.primary)
                        .disabled(creating)
                    }
                }
            }

            Section("Genres") {
                if let available {
                    FlowLayout {
                        Chip("Any", isOn: genres.isEmpty) { genres = [] }
                        ForEach(available, id: \.self) { genre in
                            Chip(genre, isOn: genres.contains(genre)) {
                                if let i = genres.firstIndex(of: genre) { genres.remove(at: i) } else { genres.append(genre) }
                            }
                        }
                    }
                    .padding(.vertical, 4)
                } else {
                    ProgressView()
                }
            }

            Section {
                Picker("Length", selection: $maxMinutes) {
                    ForEach(Self.lengths, id: \.value) { Text($0.label).tag($0.value) }
                }
                Picker("Released", selection: $era) {
                    ForEach(Era.allCases, id: \.self) { Text($0.label).tag($0) }
                }
            }
        }
        .navigationTitle("New Room")
        .navigationBarTitleDisplayMode(.inline)
        .errorAlert($error)
        .sensoryFeedback(.selection, trigger: genres)
        .task {
            restore()
            async let g = model.client.call(PortalAPI.matchGenres, .init(sectionId: sectionID))
            async let p = model.client.call(PortalAPI.matchPresets, .init(sectionId: sectionID))
            let loaded = (try? await g) ?? []
            available = loaded
            // A remembered genre this library doesn't have would filter to nothing.
            genres = genres.filter(loaded.contains)
            presets = (try? await p) ?? []
        }
        .task(id: filters) {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            let f = filters
            let input = Portal.MatchCountInput(sectionId: sectionID, filters: .init(
                genres: f.genres, maxMinutes: f.maxMinutes, minYear: f.minYear, maxYear: f.maxYear, minRating: f.minRating, maxRating: f.maxRating
            ))
            count = try? await model.client.call(PortalAPI.matchCount, input)
        }
    }

    static func createFilters(_ f: MatchFilters) -> Portal.MatchCreateInput.Filters {
        .init(genres: f.genres, maxMinutes: f.maxMinutes.map { Int($0) }, minYear: f.minYear.map { Int($0) },
              maxYear: f.maxYear.map { Int($0) }, minRating: f.minRating, maxRating: f.maxRating)
    }

    func create(_ f: Portal.MatchCreateInput.Filters) {
        creating = true
        remember()
        Task {
            defer { creating = false }
            do {
                let room = try await model.client.call(PortalAPI.matchCreate, .init(sectionId: sectionID, filters: f))
                created(room.code)
            } catch {
                self.error = APIError.from(error)
            }
        }
    }

    func remember() {
        let saved: [String: Any] = ["genres": genres, "maxMinutes": maxMinutes, "era": era.rawValue]
        UserDefaults.standard.set(saved, forKey: Self.lastKey)
    }

    func restore() {
        guard let saved = UserDefaults.standard.dictionary(forKey: Self.lastKey) else { return }
        genres = saved["genres"] as? [String] ?? []
        maxMinutes = saved["maxMinutes"] as? Int ?? 0
        era = (saved["era"] as? String).flatMap(Era.init(rawValue:)) ?? .any
    }
}
#endif
