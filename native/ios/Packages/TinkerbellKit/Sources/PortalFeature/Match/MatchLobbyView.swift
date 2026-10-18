// Movie match's front door for a user of this server: start a room, join one
// by its code or its invite link, or go back to one you're in. Guests never
// see this — they arrive in a room from its invite. From
// `apps/portal/src/match/Lobby.tsx`.

#if os(iOS)
import SwiftUI
import TinkerbellAPI
import TinkerbellCore
import TinkerbellModels

enum MatchRoute: Hashable {
    case library
    case newRoom(sectionID: String)
    case room(code: String, invite: String?)
}

struct MatchLobbyView: View {
    @Environment(PortalModel.self) private var model
    @Environment(ShellState.self) private var shell
    @State private var path: [MatchRoute] = []
    @State private var libraries: LoadState<Portal.MatchLibrariesOutput> = .loading
    @State private var rooms: [MatchRoomSummary] = []
    @State private var code = ""
    @State private var link = ""
    @State private var joinError: String?
    @State private var joining = false

    var body: some View {
        // Its own stack with a path, so a link can open a room in it and Back
        // is the lobby.
        NavigationStack(path: $path) {
            lobby.toolbar { ToolbarItem(placement: .topBarTrailing) { PartMenu() } }
        }
    }

    var lobby: some View {
        List {
            Section {
                Text("Can't decide what to watch? Start a room, invite whoever's watching, and swipe through the films. Anything everyone likes is a match.")
                    .foregroundStyle(.secondary)
                switch libraries {
                case .loading:
                    ProgressView()
                case .failed(let error):
                    ErrorStateView(error: error) { await load() }
                case .loaded(let libs) where libs.isEmpty:
                    Text("None of the movie libraries here are shared with you.").foregroundStyle(.secondary)
                case .loaded(let libs):
                    Button {
                        path.append(libs.count == 1 ? .newRoom(sectionID: libs[0].key) : .library)
                    } label: {
                        Label("Start a Room", systemImage: "plus.circle.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .accessibilityIdentifier("start-room")
                }
            }

            Section {
                HStack {
                    TextField("ABCD", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.title3.monospaced())
                        .onChange(of: code) { _, new in
                            let filtered = MatchCode.filterTyping(new)
                            if filtered != new { code = filtered }
                        }
                        .onSubmit { joinByCode() }
                    Button("Join") { joinByCode() }
                        .buttonStyle(.bordered)
                        .disabled(code.count != MatchCode.length || joining)
                }
                HStack {
                    TextField("Paste an invite link", text: $link)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit { joinByLink() }
                    PasteButton(payloadType: String.self) { strings in
                        if let first = strings.first { link = first; joinByLink() }
                    }
                    .labelStyle(.iconOnly)
                    .buttonBorderShape(.capsule)
                }
            } header: {
                Text("Join a room")
            } footer: {
                if let joinError { Text(joinError).foregroundStyle(.red) }
            }

            if !rooms.isEmpty {
                Section("Your rooms") {
                    ForEach(rooms, id: \.code) { room in
                        NavigationLink(value: MatchRoute.room(code: room.code, invite: nil)) {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(room.code).font(.headline.monospaced())
                                    Text(([room.library] + MatchText.pills(room.filters)).joined(separator: " · "))
                                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Text(room.members.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Movie Match")
        .navigationDestination(for: MatchRoute.self) { route in
            switch route {
            case .library:
                LibraryPickerView(libraries: libraries.value ?? []) { path.append(.newRoom(sectionID: $0)) }
            case .newRoom(let sectionID):
                NewRoomView(sectionID: sectionID) { created in
                    path = [.room(code: created, invite: nil)]
                }
            case .room(let code, let invite):
                JoinedRoomView(code: code, invite: invite)
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: shell.pendingMatch, initial: true) { _, pending in
            guard let pending else { return }
            shell.pendingMatch = nil
            path = [.room(code: pending.code, invite: pending.invite)]
        }
    }

    func load() async {
        libraries = await LoadState.run(libraries) { try await model.client.call(PortalAPI.matchLibraries) }
        if case .forbidden = libraries.error { await model.componentWentAway() }
        rooms = (try? await model.client.call(PortalAPI.matchRooms)) ?? rooms
    }

    func joinByCode() {
        guard let normal = MatchCode.normalise(code) else { return }
        joining = true
        joinError = nil
        Task {
            defer { joining = false }
            do {
                let joined = try await model.client.call(PortalAPI.matchJoin, .init(code: normal))
                code = ""
                path.append(.room(code: joined.code, invite: nil))
            } catch {
                joinError = error.userMessage
            }
        }
    }

    func joinByLink() {
        joinError = nil
        guard case .match(let parsed)? = DeepLink.parse(link, allowPlexTvOverride: false) else {
            joinError = "That isn't a movie match invite link."
            return
        }
        link = ""
        if ServerAddress.origin(of: model.baseURL.absoluteString) == parsed.server {
            path.append(.room(code: parsed.code, invite: parsed.invite))
        } else {
            // A room on somebody else's server: join it as their guest.
            shell.guestMatch = parsed
        }
    }
}

struct LibraryPickerView: View {
    let libraries: [Portal.MatchLibrariesItem]
    let pick: (String) -> Void

    var body: some View {
        List(libraries, id: \.key) { lib in
            Button {
                pick(lib.key)
            } label: {
                LabeledContent(lib.title, value: "\(lib.count) films")
            }
            .foregroundStyle(.primary)
        }
        .navigationTitle("Which Library?")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Joins before showing the room. Joining is idempotent, so opening a room
/// you're already in costs one cheap call, and a link from someone else (with
/// or without its secret) lands you in it.
struct JoinedRoomView: View {
    @Environment(PortalModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let code: String
    let invite: String?
    @State private var joined: LoadState<Bool> = .loading

    var body: some View {
        Group {
            switch joined {
            case .loading:
                ProgressView()
            case .failed(let error):
                ContentUnavailableView {
                    Label("Couldn't open that room", systemImage: "door.left.hand.closed")
                } description: {
                    Text(error.message)
                } actions: {
                    Button("Back to Movie Match") { dismiss() }
                }
            case .loaded:
                RoomView(room: RoomContext(client: model.client, posterBase: model.baseURL, isGuest: false), code: code) {
                    dismiss()
                }
            }
        }
        .task {
            joined = await LoadState.run(joined) {
                _ = try await model.client.call(PortalAPI.matchJoin, .init(code: code, invite: invite))
                return true
            }
        }
    }
}
#endif
