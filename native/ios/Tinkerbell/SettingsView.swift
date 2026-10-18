// The app's own settings: which servers, the lock, the look, signing out.
//
// Written as bare sections so the portal's Account tab can embed them under
// the person's own details, and the admin half can show them in a sheet —
// one set of rows, two places, rather than two settings screens that drift.

import SwiftUI
import TinkerbellAPI
import TinkerbellCore

struct SettingsSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form { SettingsSections() }
                .navigationTitle("Settings")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct SettingsSections: View {
    @Environment(ConnectionStore.self) private var store
    @Environment(AppLock.self) private var lock
    @Environment(AppSettings.self) private var settings
    @Environment(SignInCoordinator.self) private var signIn
    @State private var adding: ServerProduct?
    @State private var confirmSignOut = false

    var body: some View {
        @Bindable var settings = settings
        Section("Servers") {
            ForEach([ServerProduct.portal, .admin], id: \.self) { role in
                if let connection = store[role] {
                    NavigationLink {
                        ServerDetailView(role: role)
                    } label: {
                        ServerRow(connection: connection)
                    }
                } else {
                    Button("Add \(role.label) Server", systemImage: "plus.circle") { adding = role }
                }
            }
            if !signIn.rolesNeedingSession.isEmpty {
                Button {
                    Task { await signIn.signIn() }
                } label: {
                    Label(signIn.phase == .idle ? "Sign In to \(signIn.rolesNeedingSession.map(\.label).joined(separator: " and "))" : "Signing in…",
                          systemImage: "person.badge.key")
                }
                .disabled(signIn.phase != .idle)
            }
            ForEach(signIn.messages, id: \.self) { Text($0).font(.footnote).foregroundStyle(.red) }
        }

        if lock.isAvailable {
            Section {
                Toggle(isOn: Binding(get: { lock.isEnabled }, set: { on in Task { await lock.setEnabled(on) } })) {
                    Label("Lock with \(lock.biometryName ?? "Passcode")", systemImage: lock.biometryName == nil ? "lock" : lock.biometryName == "Touch ID" ? "touchid" : "faceid")
                }
            } footer: {
                Text("Asks when the app opens, and when you come back after five minutes away.")
            }
        }

        Section {
            Picker(selection: $settings.appearance) {
                ForEach(Appearance.allCases) { Text($0.label).tag($0) }
            } label: {
                Label("Appearance", systemImage: "circle.lefthalf.filled")
            }
        }

        if let admin = store.admin {
            Section {
                Link(destination: admin.baseURL) {
                    Label("Open Web Admin", systemImage: "safari")
                }
            }
        }

        Section {
            LabeledContent("Version", value: Self.version)
            if store.portal?.isSignedIn == true || store.admin?.isSignedIn == true {
                Button("Sign Out", role: .destructive) { confirmSignOut = true }
                    .confirmationDialog("Sign out of Tinkerbell?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                        Button("Sign Out", role: .destructive) { Task { await signOut() } }
                    } message: {
                        Text("You'll need to sign in with Plex again. Your servers stay connected.")
                    }
            }
        }
        .sheet(item: $adding) { role in
            NavigationStack { ConnectView(purpose: .add(role)) }
        }
    }

    static var version: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))"
    }

    /// Logout on each server, then forget the tokens whatever they said — a
    /// sign-out that fails offline must still sign out.
    func signOut() async {
        if let client = store.client(.portal), store.portal?.sessionToken != nil { await SignInExchange.logoutPortal(client) }
        if let client = store.client(.admin), store.admin?.sessionToken != nil { await SignInExchange.logoutAdmin(client) }
        store.setSession(.portal, token: nil)
        store.setSession(.admin, token: nil)
    }
}

extension ServerProduct: @retroactive Identifiable {
    public var id: String { rawValue }
}

struct ServerRow: View {
    let connection: ServerConnection

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(connection.role.label)
            Text(connection.displayHost).font(.caption).foregroundStyle(.secondary)
            if connection.openAuth {
                Label("Sign-in is off on this server", systemImage: "lock.open").font(.caption).foregroundStyle(.red)
            } else if !connection.isSignedIn {
                Text("Not signed in").font(.caption).foregroundStyle(.orange)
            }
            if connection.isUnencryptedRemote {
                Label("Not encrypted", systemImage: "lock.open").font(.caption).foregroundStyle(.orange)
            }
        }
    }
}

struct ServerDetailView: View {
    let role: ServerProduct
    @Environment(ConnectionStore.self) private var store
    @Environment(SignInCoordinator.self) private var signIn
    @Environment(\.dismiss) private var dismiss
    @State private var check: ServerCheck?
    @State private var confirmRemove = false

    var body: some View {
        Form {
            if let connection = store[role] {
                Section {
                    LabeledContent("Address", value: connection.baseURL.absoluteString)
                    switch check {
                    case .ok(let info)?: LabeledContent("Version", value: info.version)
                    case .failed(let f)?: Text(f.message(want: role)).foregroundStyle(.red)
                    case nil: LabeledContent("Version") { ProgressView() }
                    }
                    LabeledContent("Session", value: connection.openAuth ? "Sign-in off" : connection.sessionToken == nil ? "Signed out" : "Signed in")
                } footer: {
                    if connection.isUnencryptedRemote {
                        Text("Not encrypted: this server is reached over plain HTTP across the internet, so your session can be read on the way.")
                    }
                }
                Section {
                    Button("Sign In Again", systemImage: "person.badge.key") {
                        Task { await signIn.signIn([role]) }
                    }
                    .disabled(signIn.phase != .idle)
                    Button("Remove Server", systemImage: "trash", role: .destructive) { confirmRemove = true }
                }
            }
        }
        .navigationTitle(role.label)
        .task {
            if let c = store[role] { check = await ServerProbe().probe(c.baseURL.absoluteString, want: role) }
        }
        .confirmationDialog("Remove the \(role.label.lowercased()) server?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove Server", role: .destructive) {
                Task {
                    if let client = store.client(role), store[role]?.sessionToken != nil {
                        if role == .portal { await SignInExchange.logoutPortal(client) } else { await SignInExchange.logoutAdmin(client) }
                    }
                    store.remove(role)
                    dismiss()
                }
            }
        } message: {
            Text("This signs you out of it on this phone.")
        }
    }
}
