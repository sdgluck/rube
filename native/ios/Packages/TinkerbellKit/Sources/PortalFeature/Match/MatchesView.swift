// What the room agrees on: films everyone liked, then films more than one
// person liked, and a "Watch this" vote among them for when there's more than
// one contender. Fed by the room's poll, so it fills in as people swipe.
// From `apps/portal/src/match/Matches.tsx`.

#if os(iOS)
import SwiftUI
import TinkerbellAPI
import TinkerbellCore
import TinkerbellModels

struct MatchesView: View {
    let room: RoomContext
    let code: String
    let roomState: RoomState
    let refresh: () async -> Void

    @State private var sort: Sort = .likes
    @State private var open: MatchFilm?
    @State private var voted = 0

    enum Sort: Hashable { case likes, recent }

    var sorted: [MatchFilm] {
        sort == .likes ? roomState.matches : roomState.matches.sorted { $0.lastLikedAt > $1.lastLikedAt }
    }

    var body: some View {
        List {
            Section("Here") {
                ForEach(roomState.members, id: \.id) { member in
                    HStack {
                        Circle().fill(member.online ? Color.green : Color.secondary.opacity(0.4)).frame(width: 8, height: 8)
                            .accessibilityLabel(member.online ? "Here now" : "Away")
                        Text(member.name)
                        if member.me { Text("(you)").foregroundStyle(.secondary) }
                        else if member.guest { Text("(guest)").foregroundStyle(.secondary) }
                        Spacer()
                        Text("\(member.swiped)/\(roomState.deckSize)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
            }

            if roomState.matches.isEmpty {
                ContentUnavailableView("No matches yet", systemImage: "heart.slash",
                                       description: Text("A film shows up here once more than one person likes it, and goes to the top when everyone does."))
                    .listRowBackground(Color.clear)
            } else {
                Section {
                    Picker("Sort", selection: $sort) {
                        Text("Most liked").tag(Sort.likes)
                        Text("Recent").tag(Sort.recent)
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text("\(roomState.unanimousCount) everyone agreed on, from \(roomState.swipedCount) films seen")
                }
                section("Everyone liked", sorted.filter(\.unanimous))
                section("Some liked", sorted.filter { !$0.unanimous })
            }
        }
        .sensoryFeedback(.selection, trigger: voted)
        .sheet(item: $open) { film in
            FilmDetailSheet(film: film, poster: room.poster(film.poster), serverID: roomState.plexServerId)
                .presentationDetents([.medium, .large])
        }
    }

    @ViewBuilder func section(_ title: String, _ films: [MatchFilm]) -> some View {
        if !films.isEmpty {
            Section("\(title) · \(films.count)") {
                ForEach(films) { film in
                    let voters = roomState.votes.first { $0.ratingKey == film.ratingKey }?.voters ?? []
                    let mine = roomState.myVote == film.ratingKey
                    HStack(spacing: 12) {
                        Button { open = film } label: {
                            RemoteImage(room.poster(film.poster))
                                .frame(width: 56, height: 84)
                                .clipShape(.rect(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(film.title).font(.headline)
                            Text(film.likedBy.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
                            Button {
                                vote(mine ? nil : film.ratingKey)
                            } label: {
                                Text((mine ? "Your pick" : "Watch this") + (voters.isEmpty ? "" : " · \(voters.count)"))
                            }
                            .buttonStyle(.bordered)
                            .tint(mine ? .accentColor : .secondary)
                            .controlSize(.small)
                        }
                    }
                    .contentShape(.rect)
                    .contextMenu {
                        Button("Details", systemImage: "info.circle") { open = film }
                        Button(mine ? "Withdraw Vote" : "Watch This", systemImage: mine ? "xmark" : "hand.thumbsup") { vote(mine ? nil : film.ratingKey) }
                    }
                }
            }
        }
    }

    /// A nil film withdraws the vote — the server wants the key present and null.
    func vote(_ ratingKey: String?) {
        voted += 1
        Task {
            _ = try? await room.client.call(PortalAPI.matchVote, .init(code: code, ratingKey: ratingKey))
            await refresh()
        }
    }
}

struct FilmDetailSheet: View {
    let film: MatchFilm
    let poster: ImageRequest?
    let serverID: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top, spacing: 16) {
                        RemoteImage(poster).frame(width: 120, height: 180).clipShape(.rect(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 6) {
                            Text(film.title).font(.title2.bold())
                            Text(MatchText.filmMeta(year: film.year, rating: film.rating, durationMs: film.durationMs, contentRating: film.contentRating))
                                .foregroundStyle(.secondary)
                            if !film.genres.isEmpty { Text(film.genres.joined(separator: ", ")).font(.subheadline) }
                        }
                    }
                    Text("Liked by \(film.likedBy.joined(separator: ", "))\(film.unanimous ? " — everyone." : ".")")
                    if let serverID, let url = MatchText.plexLink(serverID: serverID, ratingKey: film.ratingKey) {
                        Button { openURL(url) } label: {
                            Label("Open in Plex", systemImage: "play.rectangle").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                    }
                }
                .padding()
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
#endif
