// Sign in with Plex, run by the app: create a PIN, show plex.tv's approval
// page in an ASWebAuthenticationSession sheet, poll the PIN, then exchange
// the Plex token with each server that needs a session.
//
// The sheet never calls back — there is no `forwardUrl` — so the app closes
// it itself once the poll has a token; closing it by hand cancels the poll
// (after a grace check or two, since tapping Allow and swiping the sheet away
// is one motion). The Plex token lives in this function's locals and nowhere
// else: it is never stored, and it is gone once the exchanges return.

import AuthenticationServices
import SwiftUI
import RubeAPI
import RubeCore
import RubeModels

@Observable
@MainActor
final class SignInCoordinator {
    enum Phase: Equatable {
        case idle
        case waitingForPlex
        case finishing
    }

    var phase: Phase = .idle
    /// What to tell the person once it's over: refusals and failures, per server.
    var messages: [String] = []
    let store: ConnectionStore
    private var webSession: ASWebAuthenticationSession?
    private let anchor = WebAuthAnchor()

    init(store: ConnectionStore) {
        self.store = store
    }

    /// Every connected server without a session.
    var rolesNeedingSession: [ServerProduct] {
        [ServerProduct.portal, .admin].filter { store[$0] != nil && !(store[$0]?.isSignedIn ?? false) }
    }

    func signIn(_ roles: [ServerProduct]? = nil) async {
        guard phase == .idle else { return }
        let roles = roles ?? rolesNeedingSession
        guard !roles.isEmpty else { return }
        messages = []
        phase = .waitingForPlex
        defer { phase = .idle }

        let plex = PlexTV(clientID: store.plexClientID, override: store.plexTvOverride)
        let plexToken: String
        do {
            let pin = try await plex.createPin()
            let sheet = SignInSheetState()
            if let account = DevFlags.signInAs, plex.override != nil {
                // UI tests: approve on the mock plex.tv, no browser.
                Task { try? await plex.approveHeadlessly(code: pin.code, as: account) }
            } else {
                present(plex.authURL(code: pin.code), sheet: sheet)
            }
            defer { closeSheet() }
            plexToken = try await PlexPinPoller().waitForToken(pin, plex: plex, sheet: sheet)
        } catch .cancelled {
            return
        } catch {
            messages = [error.message]
            return
        }

        phase = .finishing
        for role in roles {
            guard let client = store.client(role) else { continue }
            let outcome = role == .portal
                ? await SignInExchange.portal(client, plexToken: plexToken)
                : await SignInExchange.admin(client, plexToken: plexToken)
            switch outcome {
            case .signedIn(_, let token):
                store.setSession(role, token: token)
            case .open:
                store.setSession(role, token: nil, openAuth: true)
            case .refused(let message):
                messages.append("\(role.label): \(message)")
            case .failed(let error):
                messages.append("\(role.label): \(error.message)")
            }
        }
    }

    private func present(_ url: URL, sheet: SignInSheetState) {
        let session = ASWebAuthenticationSession(url: url, callback: .customScheme("rube")) { _, _ in
            // Only ever called on dismissal: plex.tv never redirects back.
            sheet.markClosed()
        }
        // Not ephemeral: someone already signed in to plex.tv in Safari is
        // one tap from done, rather than typing a password on a phone.
        session.prefersEphemeralWebBrowserSession = false
        session.presentationContextProvider = anchor
        webSession = session
        session.start()
    }

    private func closeSheet() {
        webSession?.cancel()
        webSession = nil
    }
}

final class WebAuthAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            if let key = scenes.flatMap(\.windows).first(where: \.isKeyWindow) { return key }
            return ASPresentationAnchor(windowScene: scenes[0])
        }
    }
}

/// Signed in nowhere yet: one button, branded by the portal when there is one.
struct SignInView: View {
    @Environment(ConnectionStore.self) private var store
    @Environment(SignInCoordinator.self) private var signIn
    @State private var branding: Portal.BrandingOutput?
    @State private var background: PlatformImage?
    @State private var confirmForget = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()
                Image(systemName: Self.symbol(branding?.icon))
                    .font(.system(size: 56, weight: .semibold))
                    .foregroundStyle(Color(hex: branding?.iconColor) ?? .accentColor)
                Text(branding?.title?.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? "Rube")
                    .font(.largeTitle.bold())
                Text("Sign in with your Plex account to personalize your home screen.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Spacer()
                VStack(spacing: 12) {
                    Button {
                        Task { await signIn.signIn() }
                    } label: {
                        Group {
                            switch signIn.phase {
                            case .idle: Text("Sign In with Plex")
                            case .waitingForPlex: Text("Waiting for Plex…")
                            case .finishing: Text("Finishing sign-in…")
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(signIn.phase != .idle)
                    .accessibilityIdentifier("sign-in")

                    Text("Rube never sees your Plex password.").font(.footnote).foregroundStyle(.secondary)
                    ForEach(signIn.messages, id: \.self) { message in
                        Text(message).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                    }
                }
                serverList
            }
            .padding()
            .background {
                if let background {
                    Image(uiImage: background).resizable().scaledToFill().ignoresSafeArea()
                        .overlay(Color.black.opacity(0.55).ignoresSafeArea())
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Use Different Servers", systemImage: "server.rack", role: .destructive) { confirmForget = true }
                    } label: {
                        Label("Servers", systemImage: "ellipsis")
                    }
                }
            }
            .confirmationDialog("Forget these servers?", isPresented: $confirmForget, titleVisibility: .visible) {
                Button("Forget Servers", role: .destructive) {
                    store.remove(.portal)
                    store.remove(.admin)
                }
            }
        }
        .task {
            guard let client = store.client(.portal) else { return }
            branding = try? await client.call(PortalAPI.branding)
            if let raw = branding?.backgroundImage?.trimmingCharacters(in: .whitespaces), !raw.isEmpty {
                let url = URL(string: raw).flatMap { $0.scheme == nil ? PortalURLs.poster(base: client.baseURL, path: raw) : $0 }
                if let url { background = await ImageLoader.shared.image(ImageRequest(url: url)) }
            }
        }
    }

    var serverList: some View {
        VStack(spacing: 4) {
            ForEach([ServerProduct.portal, .admin], id: \.self) { role in
                if let c = store[role] {
                    Label("\(role.label): \(c.displayHost)", systemImage: c.isUnencryptedRemote ? "lock.open" : "server.rack")
                        .font(.caption)
                        .foregroundStyle(c.isUnencryptedRemote ? .orange : .secondary)
                }
            }
        }
    }

    /// The portal's icon names are lucide's; these are the nearest symbols.
    static func symbol(_ name: String?) -> String {
        switch name {
        case "Star": "star.fill"
        case "Heart": "heart.fill"
        case "Film": "film"
        case "Tv": "tv"
        case "Video": "video.fill"
        case "Music": "music.note"
        case "Flame": "flame.fill"
        case "Ghost": "theatermasks.fill"
        case "Rocket": "airplane"
        case "Compass": "safari"
        case "Sun": "sun.max.fill"
        case "Moon": "moon.fill"
        case "Zap": "bolt.fill"
        case "Bookmark": "bookmark.fill"
        case "Award": "rosette"
        case "Bell": "bell.fill"
        case "Camera": "camera.fill"
        case "Tag": "tag.fill"
        case "Play": "play.fill"
        default: "sparkles"
        }
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

extension Color {
    /// The branding colour the admin typed: `#e5a00d` or `e5a00d`.
    init?(hex: String?) {
        guard var s = hex?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}
