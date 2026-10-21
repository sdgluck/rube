// Joining a room as a guest: someone who opened an invite with no session on
// that server — most likely with no account there at all. They get the room
// and nothing else: a name, and a token for this one room, kept in the
// Keychain per server and room so reopening the link goes straight back in.
// From `apps/portal/src/match/GuestMatch.tsx`.

#if os(iOS)
import SwiftUI
import RubeAPI
import RubeCore
import RubeModels

public struct GuestMatchView: View {
    let link: MatchLink
    /// Offered when the person might have an account on that server after all.
    let onSignIn: (() -> Void)?
    @Environment(ConnectionStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var token: String?
    @State private var preview: LoadState<Portal.MatchGuestPreviewOutput> = .loading
    @State private var name = ""
    @State private var joining = false
    @State private var error: APIError?
    @State private var left = false

    public init(link: MatchLink, onSignIn: (() -> Void)? = nil) {
        self.link = link
        self.onSignIn = onSignIn
    }

    var baseURL: URL { URL(string: link.server)! }
    var client: TRPCClient { TRPCClient(baseURL: baseURL) }

    public var body: some View {
        NavigationStack {
            Group {
                if left {
                    ContentUnavailableView("You've left the room.", systemImage: "door.left.hand.open",
                                           description: Text("Open the invite link again to rejoin."))
                } else if let token {
                    RoomView(room: RoomContext(client: client.with(credential: .matchGuest(token)), posterBase: baseURL, isGuest: true), code: link.code) {
                        store.setGuestToken(nil, server: link.server, code: link.code)
                        self.token = nil
                        left = true
                    }
                } else if let invite = link.invite {
                    joinForm(invite)
                } else {
                    ContentUnavailableView {
                        Label("Room \(link.code)", systemImage: "popcorn")
                    } description: {
                        Text("To join, open the invite link whoever made it sent you — or sign in if you're on this server.")
                    } actions: {
                        if let onSignIn { Button("Sign In with Plex", action: onSignIn).buttonStyle(.borderedProminent) }
                    }
                }
            }
            .navigationTitle("Movie Night")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
        }
        .onAppear { token = store.guestToken(server: link.server, code: link.code) }
        .errorAlert($error)
    }

    func joinForm(_ invite: String) -> some View {
        Form {
            switch preview {
            case .loading:
                ProgressView()
            case .failed(.notFound):
                ContentUnavailableView("This invite doesn't work any more", systemImage: "link.badge.plus",
                                       description: Text("The room has closed, or the link is incomplete. Ask whoever sent it for a new one."))
            case .failed(let e):
                ErrorStateView(error: e) { await loadPreview(invite) }
            case .loaded(let room):
                Section {
                    let pills = MatchText.pills(room.filters)
                    Text("\(room.members.joined(separator: ", ")) \(room.members.count == 1 ? "is" : "are") picking a film from \(room.library)\(pills.isEmpty ? "" : " (\(pills.joined(separator: ", ")))"). Join them: swipe right on what you'd watch, left on what you wouldn't.")
                }
                Section {
                    TextField("Your name", text: $name)
                        .textContentType(.givenName)
                        .onChange(of: name) { _, new in if new.count > 40 { name = String(new.prefix(40)) } }
                        .onSubmit { join(invite) }
                } footer: {
                    Text("What the others will see. No account needed.")
                }
                Section {
                    Button { join(invite) } label: {
                        Text("Join Room \(link.code)").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || joining)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                if let onSignIn {
                    Section {
                        Button("On this Plex server? Sign in instead", action: onSignIn)
                    }
                }
            }
        }
        .task { await loadPreview(invite) }
    }

    func loadPreview(_ invite: String) async {
        preview = await LoadState.run(preview) { try await client.call(PortalAPI.matchGuestPreview, .init(code: link.code, invite: invite)) }
    }

    func join(_ invite: String) {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        joining = true
        Task {
            defer { joining = false }
            do {
                let joined = try await client.call(PortalAPI.matchGuestJoin, .init(code: link.code, invite: invite, name: trimmed))
                store.setGuestToken(joined.token, server: link.server, code: link.code)
                token = joined.token
            } catch {
                self.error = APIError.from(error)
            }
        }
    }
}
#endif
