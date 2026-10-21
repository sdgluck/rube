// Which screen the app is on, decided from the connections alone: nothing
// connected is the connect screen, connected but signed in nowhere is sign-in,
// and otherwise the Portal or the Admin half. Because it is derived, a session
// the server rejects (cleared by the client's 401 hook) puts the app back on
// sign-in without any screen having to navigate there.

import AdminFeature
import PortalFeature
import SwiftUI
import RubeAPI
import RubeCore

struct RootView: View {
    @Environment(ConnectionStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(AppLock.self) private var lock
    @Environment(ShellState.self) private var shell
    @Environment(LinkRouter.self) private var links
    @Environment(SignInCoordinator.self) private var signIn

    var anySignedIn: Bool { (store.portal?.isSignedIn ?? false) || (store.admin?.isSignedIn ?? false) }

    var body: some View {
        @Bindable var shell = shell
        @Bindable var links = links
        Group {
            if store.isEmpty {
                // A link on a fresh install is the first screen, not a sheet over one.
                NavigationStack {
                    if let request = links.connect {
                        ConnectView(purpose: .link(request.link)).id(request.id)
                    } else {
                        ConnectView(purpose: .welcome)
                    }
                }
            } else if !anySignedIn {
                SignInView()
            } else {
                main
            }
        }
        .environment(\.appSettingsSections, AnyView(SettingsSections()))
        .sheet(isPresented: $shell.showingSettings) { SettingsSheet() }
        .sheet(item: store.isEmpty ? .constant(nil) : $links.connect) { request in
            NavigationStack { ConnectView(purpose: .link(request.link)) }
        }
        .fullScreenCover(item: $shell.guestMatch) { link in
            GuestMatchView(link: link, onSignIn: store.portal == nil || origin(store.portal) == link.server ? {
                shell.guestMatch = nil
                if store.portal == nil {
                    links.connect = ConnectRequest(link: ConnectLink(portal: link.server))
                }
                links.pendingMatch = link
            } : nil)
        }
        .onChange(of: links.pendingMatch, initial: true) { _, link in route(link) }
        .onChange(of: store.portal?.isSignedIn) { _, _ in route(links.pendingMatch) }
        .alert("Can't open link", isPresented: Binding(get: { links.error != nil }, set: { if !$0 { links.error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(links.error ?? "")
        }
        .overlay {
            if lock.isLocked { LockView() }
        }
        .tint(Color.accentColor)
    }

    @ViewBuilder var main: some View {
        let wantsAdmin = settings.lastPart == .admin || !(store.portal?.isSignedIn ?? false)
        if wantsAdmin, let admin = store.admin, admin.isSignedIn, let client = store.client(.admin) {
            AdminRootView(connection: admin, client: client)
                .id("admin|\(admin.baseURL)|\(admin.sessionToken ?? "open")")
                .transition(.opacity)
        } else if let portal = store.portal, portal.isSignedIn, let client = store.client(.portal) {
            PortalRootView(client: client)
                .id("portal|\(portal.baseURL)|\(portal.sessionToken ?? "")")
                .transition(.opacity)
        }
    }

    /// A match link: into the Match tab when it's for the portal you're signed
    /// in to, as a guest otherwise. Held while sign-in is in progress, so a
    /// link that arrived before the session still lands in its room.
    func route(_ link: MatchLink?) {
        guard let link else { return }
        if let portal = store.portal, origin(portal) == link.server {
            guard portal.isSignedIn else { return }
            settings.lastPart = .portal
            shell.pendingMatch = link
        } else {
            shell.guestMatch = link
        }
        links.pendingMatch = nil
    }

    func origin(_ connection: ServerConnection?) -> String? {
        connection.flatMap { ServerAddress.origin(of: $0.baseURL.absoluteString) }
    }
}

extension MatchLink: @retroactive Identifiable {
    public var id: String { "\(server)|\(code)" }
}

/// Face ID before anything else is visible.
struct LockView: View {
    @Environment(AppLock.self) private var lock

    var body: some View {
        ZStack {
            Rectangle().fill(.background).ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "lock.fill").font(.system(size: 44)).foregroundStyle(.tint)
                Text("Rube is locked").font(.title2.bold())
                Button {
                    Task { await lock.unlock() }
                } label: {
                    Label("Unlock", systemImage: lock.biometryName == "Touch ID" ? "touchid" : "faceid")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
        }
        .task { await lock.unlock() }
    }
}
