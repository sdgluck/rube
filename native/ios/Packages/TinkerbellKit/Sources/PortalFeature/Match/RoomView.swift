// One room: the deck, the matches, and who's here. From
// `apps/portal/src/match/Room.tsx`.
//
// Polls `match.state` every three seconds while the room is on screen — the
// web's interval; the server deliberately has no socket for this — and turns
// what changed between polls into the two things worth interrupting someone
// for: a person arriving, and a match. The first poll is what was already
// there, so opening a room with old matches doesn't celebrate them again.

#if os(iOS)
import SwiftUI
import TinkerbellAPI
import TinkerbellCore
import TinkerbellModels

/// Who's asking, and where posters live. A guest's client carries their room
/// token instead of a session; posters are signed paths on the portal either way.
public struct RoomContext: Sendable {
    let client: TRPCClient
    let posterBase: URL
    let isGuest: Bool

    func poster(_ path: String?) -> ImageRequest? {
        PortalURLs.poster(base: posterBase, path: path).map { ImageRequest(url: $0) }
    }
}

typealias RoomState = Portal.MatchStateOutput
typealias MatchFilm = Portal.MatchStateOutput.Match

struct RoomView: View {
    let room: RoomContext
    let code: String
    let onLeft: () -> Void

    @State private var state: LoadState<RoomState> = .loading
    @State private var view: Pane = .swipe
    @State private var arrival: String?
    @State private var matched: MatchFilm?
    @State private var seenMembers: Set<Int>?
    @State private var seenMatches: Set<String>?
    @State private var pendingMatch: String?
    @State private var confirmLeave = false
    @State private var confirmReset = false
    /// Bumped by "Start Over": the deck is rebuilt from scratch rather than
    /// patched, so no card dealt before the reset can survive it.
    @State private var deckGeneration = 0
    @State private var actionError: APIError?

    static let pollInterval: Duration = .seconds(3)

    enum Pane: Hashable { case swipe, matches }

    var body: some View {
        Group {
            switch state {
            case .loading:
                ProgressView()
            case .failed(let error):
                switch error {
                case .notFound, .forbidden:
                    ContentUnavailableView {
                        Label("This room isn't available", systemImage: "door.left.hand.closed")
                    } description: {
                        Text(error.message)
                    } actions: {
                        Button("OK", action: onLeft)
                    }
                default:
                    ErrorStateView(error: error) { await poll() }
                }
            case .loaded(let s):
                content(s)
            }
        }
        .navigationTitle("Room \(code)")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            while !Task.isCancelled {
                await poll()
                try? await Task.sleep(for: Self.pollInterval)
            }
        }
        .sensoryFeedback(.success, trigger: matched?.ratingKey) { _, new in new != nil }
        .errorAlert($actionError)
    }

    func content(_ s: RoomState) -> some View {
        VStack(spacing: 12) {
            Picker("View", selection: $view) {
                Text("Swipe").tag(Pane.swipe)
                Text(s.matches.isEmpty ? "Matches" : "Matches · \(s.matches.count)").tag(Pane.matches)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)

            switch view {
            case .swipe:
                SwipeDeckView(room: room, code: code, roomState: s, onMatched: { key in pendingMatch = key },
                              refresh: { await poll() }, startOver: { confirmReset = true })
                    .id(deckGeneration)
            case .matches:
                MatchesView(room: room, code: code, roomState: s) { await poll() }
            }
        }
        .navigationSubtitle(subtitle(s))
        .overlay(alignment: .top) {
            if let arrival {
                Text("\(arrival) joined")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .glassEffect()
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .padding(.top, 48)
            }
        }
        .animation(.spring, value: arrival)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if let url = URL(string: s.link) {
                    ShareLink(item: url, subject: Text("Movie night"), message: Text("Help pick a film — join room \(s.code).")) {
                        Label("Invite", systemImage: "person.badge.plus")
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Start Over", systemImage: "arrow.counterclockwise") { confirmReset = true }
                    Button("Leave Room", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { confirmLeave = true }
                } label: {
                    Label("Room Options", systemImage: "ellipsis")
                }
                .accessibilityIdentifier("room-options")
            }
        }
        .confirmationDialog("Start over?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Start Over", role: .destructive) { reset() }
        } message: {
            Text("Your swipes in this room are cleared and the deck deals again from the top. Everyone else's stay.")
        }
        .confirmationDialog("Leave room \(s.code)?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave Room", role: .destructive) { leave() }
        } message: {
            Text(room.isGuest ? "You'll need the invite link to come back." : "Your swipes stay in the room for the others.")
        }
        .sheet(item: $matched) { film in
            ItsAMatchView(film: film, poster: room.poster(film.poster)) {
                matched = nil
                view = .matches
            }
            .presentationDetents([.large])
        }
    }

    func subtitle(_ s: RoomState) -> String {
        let online = s.members.filter(\.online).count
        return ([ "\(online)/\(s.members.count) here", s.library] + MatchText.pills(s.filters)).joined(separator: " · ")
    }

    func poll() async {
        let next = await LoadState.run(state) { try await room.client.call(PortalAPI.matchState, .init(code: code)) }
        state = next
        guard let s = next.value else { return }
        if let seen = seenMembers, let fresh = s.members.first(where: { !seen.contains($0.id) && !$0.me }) {
            arrival = fresh.name
            Task {
                try? await Task.sleep(for: .seconds(3))
                if arrival == fresh.name { arrival = nil }
            }
        }
        seenMembers = Set(s.members.map(\.id))
        let unanimous = s.matches.filter(\.unanimous)
        if let seen = seenMatches, let fresh = unanimous.first(where: { !seen.contains($0.ratingKey) || $0.ratingKey == pendingMatch }) {
            matched = fresh
        }
        pendingMatch = nil
        seenMatches = Set(unanimous.map(\.ratingKey))
    }

    func reset() {
        Task {
            do {
                _ = try await room.client.call(PortalAPI.matchReset, .init(code: code))
                deckGeneration += 1
                view = .swipe
                await poll()
            } catch {
                actionError = APIError.from(error)
            }
        }
    }

    func leave() {
        Task {
            do {
                _ = try await room.client.call(PortalAPI.matchLeave, .init(code: code))
                onLeft()
            } catch {
                actionError = APIError.from(error)
            }
        }
    }
}

extension MatchFilm: Identifiable {
    public var id: String { ratingKey }
}

struct ItsAMatchView: View {
    let film: MatchFilm
    let poster: ImageRequest?
    let seeMatches: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Text("It's a match").font(.largeTitle.bold())
            Text("Everyone wants to watch this").foregroundStyle(.secondary)
            RemoteImage(poster)
                .aspectRatio(2 / 3, contentMode: .fit)
                .frame(maxHeight: 360)
                .clipShape(.rect(cornerRadius: 16))
                .shadow(radius: 20)
            Text(film.title).font(.title2.weight(.semibold)).multilineTextAlignment(.center)
            Spacer()
            Button(action: seeMatches) { Text("See Matches").frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent).controlSize(.large)
            Button("Keep Swiping") { dismiss() }
                .controlSize(.large)
        }
        .padding()
        .padding(.top, 24)
    }
}
#endif
