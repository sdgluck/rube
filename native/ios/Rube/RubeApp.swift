// The app's entry point: builds the long-lived state once and hands it down.
//
// Everything that outlives a screen — the two connections, the lock, the
// appearance, the sign-in in progress — is created here and nowhere else, so
// there is one of each and the views only ever read it from the environment.

import SwiftUI
import RubeAPI
import RubeCore

@main
struct RubeApp: App {
    @State private var store: ConnectionStore
    @State private var lock: AppLock
    @State private var settings: AppSettings
    @State private var shell = ShellState()
    @State private var signIn: SignInCoordinator
    @State private var links = LinkRouter()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        DevFlags.resetIfAsked()
        let store = ConnectionStore()
        _store = State(initialValue: store)
        _lock = State(initialValue: AppLock())
        _settings = State(initialValue: AppSettings())
        _signIn = State(initialValue: SignInCoordinator(store: store))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(lock)
                .environment(settings)
                .environment(shell)
                .environment(signIn)
                .environment(links)
                .preferredColorScheme(settings.appearance.colorScheme)
                .onOpenURL { links.open($0) }
                .onAppear { if let url = DevFlags.launchURL { links.open(url) } }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: lock.didEnterBackground()
            case .active: lock.willEnterForeground()
            default: break
            }
        }
    }
}

/// Links the app was opened with, waiting for the root view to act on them.
/// Parsed here and judged there: a connect link only ever fills in a confirm
/// screen.
@Observable
@MainActor
final class LinkRouter {
    var connect: ConnectRequest?
    var error: String?

    func open(_ url: URL) {
        switch DeepLink.parse(url.absoluteString, allowPlexTvOverride: DevFlags.isDebug) {
        case .connect(let link)?: connect = ConnectRequest(link: link)
        case .match(let link)?: pendingMatch = link
        case nil: error = "The app doesn't understand that link."
        }
    }

    /// Resolved by the root view, which knows whether there's a session for it.
    var pendingMatch: MatchLink?
}

struct ConnectRequest: Identifiable, Hashable {
    let id = UUID()
    let link: ConnectLink
}

/// DEBUG-only switches for the UI tests and the dev server. In a release
/// build every one of these reads as off.
enum DevFlags {
    static var isDebug: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }

    /// `-TBDevSignInAs <plexUserId>`: approve the PIN against the mock
    /// plex.tv without showing the web sheet.
    static var signInAs: String? {
        #if DEBUG
        UserDefaults.standard.string(forKey: "TBDevSignInAs")
        #else
        nil
        #endif
    }

    /// `-TBOpenURL <link>`: act as if the app was opened with this link —
    /// how a UI test hands it a connect link without the simulator's URL prompt.
    static var launchURL: URL? {
        #if DEBUG
        UserDefaults.standard.string(forKey: "TBOpenURL").flatMap(URL.init(string:))
        #else
        nil
        #endif
    }

    /// `-TBResetState YES`: start from a fresh install, every launch.
    static func resetIfAsked() {
        #if DEBUG
        guard UserDefaults.standard.bool(forKey: "TBResetState") else { return }
        if let domain = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: domain) }
        SecItemDelete([kSecClass as String: kSecClassGenericPassword] as CFDictionary)
        #endif
    }
}
