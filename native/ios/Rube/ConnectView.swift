// Pointing the app at its servers: typed, pasted, scanned, or from a link.
//
// Whatever the source, the same screen: each address is probed (`auth.server`,
// 8s) before it is saved, and so before it can ever be handed a Plex token at
// sign-in — a connect link can come from anywhere, and this is where a fake
// server is caught. Nothing here replaces an existing connection without the
// person seeing it and pressing the button that says so.

import SwiftUI
import RubeAPI
import RubeCore
import VisionKit

struct ConnectView: View {
    enum Purpose: Hashable {
        case welcome
        case link(ConnectLink)
        case add(ServerProduct)
    }

    let purpose: Purpose
    @Environment(ConnectionStore.self) private var store
    @Environment(LinkRouter.self) private var links
    @Environment(SignInCoordinator.self) private var signIn
    @Environment(\.dismiss) private var dismiss
    @State private var portal = ""
    @State private var admin = ""
    @State private var plexTv: URL?
    @State private var portalCheck: Check = .idle
    @State private var adminCheck: Check = .idle
    @State private var scanning = false
    @State private var working = false

    enum Check: Equatable {
        case idle, checking
        case ok(ServerInfo)
        case failed(String)
    }

    var showPortal: Bool { if case .add(let r) = purpose { r == .portal } else { true } }
    var showAdmin: Bool { if case .add(let r) = purpose { r == .admin } else { true } }

    var body: some View {
        Form {
            if case .welcome = purpose {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "sparkles").font(.largeTitle).foregroundStyle(.tint)
                        Text("Connect to your Rube").font(.title2.bold())
                        Text("Scan the code in Rube's Settings → Mobile app, or type the addresses. Most people only need the portal.")
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                }
            }
            if case .link = purpose {
                Section {
                    Text("A link asked to connect the app to these servers. Check they're yours before continuing — the app will ask Plex to sign you in to them.")
                        .font(.subheadline)
                }
            }

            if showPortal {
                Section {
                    addressField("Portal address", text: $portal, check: portalCheck, role: .portal)
                    if case .ok(let info) = adminCheck, let suggested = info.portalURL, portal.isEmpty {
                        Button("Use \(suggested)") { portal = suggested }
                    }
                } header: {
                    Text("Portal")
                } footer: {
                    footer(for: .portal, text: portal, check: portalCheck)
                }
            }

            if showAdmin {
                Section {
                    addressField("Admin address (optional)", text: $admin, check: adminCheck, role: .admin)
                } header: {
                    Text("Admin")
                } footer: {
                    footer(for: .admin, text: admin, check: adminCheck)
                }
            }

            if purpose == .welcome {
                Section {
                    if DataScannerViewController.isSupported {
                        Button("Scan QR Code", systemImage: "qrcode.viewfinder") { scanning = true }
                    }
                    PasteButton(payloadType: String.self) { strings in
                        if let first = strings.first { Task { @MainActor in take(first) } }
                    }
                }
            }

            Section {
                Button {
                    Task { await connect() }
                } label: {
                    HStack {
                        Spacer()
                        if working { ProgressView() } else { Text(buttonTitle) }
                        Spacer()
                    }
                }
                .disabled(working || (portal.trimmingCharacters(in: .whitespaces).isEmpty && admin.trimmingCharacters(in: .whitespaces).isEmpty))
                .accessibilityIdentifier("connect")
            }
        }
        .navigationTitle(purpose == .welcome ? "Welcome" : "Connect")
        .toolbar {
            if purpose != .welcome {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .sheet(isPresented: $scanning) {
            QRScannerView { payload in
                scanning = false
                take(payload)
            }
            .ignoresSafeArea()
        }
        .onAppear {
            if case .link(let link) = purpose {
                portal = link.portal ?? ""
                admin = link.admin ?? ""
                plexTv = link.plexTv
                Task { await probeAll() }
            }
        }
    }

    var buttonTitle: String {
        replacing.isEmpty ? "Continue" : "Replace and Continue"
    }

    /// Slots this would point somewhere new, so the button can say so.
    var replacing: [ServerProduct] {
        [(ServerProduct.portal, portal), (.admin, admin)].compactMap { role, text in
            let candidates = ServerAddress.candidates(text)
            guard let existing = store[role], !candidates.isEmpty else { return nil }
            return candidates.contains(ServerAddress.origin(of: existing.baseURL.absoluteString) ?? "") ? nil : role
        }
    }

    func addressField(_ prompt: String, text: Binding<String>, check: Check, role: ServerProduct) -> some View {
        HStack {
            TextField(prompt, text: text)
                .keyboardType(.URL)
                .textContentType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .onSubmit { Task { await connect() } }
                .accessibilityIdentifier("\(role.rawValue)-address")
            switch check {
            case .idle: EmptyView()
            case .checking: ProgressView()
            case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            case .failed: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder func footer(for role: ServerProduct, text: String, check: Check) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            switch check {
            case .failed(let message):
                Text(message).foregroundStyle(.red)
            case .ok(let info):
                Text("Rube \(info.version)\(info.authRequired == false ? " · admin sign-in is off" : "")")
                if ServerAddress.isUnencryptedRemote(info.origin) {
                    Label("Not encrypted — this address uses plain HTTP over the internet.", systemImage: "lock.open").foregroundStyle(.orange)
                }
            default:
                if role == .portal {
                    Text("The address people use for the portal, like 192.168.1.10:3100.")
                } else {
                    Text("Only if you administer this server — Settings → Mobile app shows it.")
                }
            }
            if Self.isOnDevice, ServerAddress.candidates(text).first.map(ServerAddress.isLoopback) == true {
                Label("That address is this phone itself, not your server. Use the server's network address instead.", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            }
            if let existing = store[role], replacing.contains(role) {
                Text("This replaces \(existing.displayHost) and signs you out of it.").foregroundStyle(.orange)
            }
        }
    }

    static var isOnDevice: Bool {
        #if targetEnvironment(simulator)
        false
        #else
        true
        #endif
    }

    /// A scanned or pasted string: a connect link fills the fields, a match
    /// invite goes to the root to open, a bare address goes in the portal.
    func take(_ raw: String) {
        switch DeepLink.parse(raw, allowPlexTvOverride: DevFlags.isDebug) {
        case .connect(let link)?:
            portal = link.portal ?? portal
            admin = link.admin ?? admin
            plexTv = link.plexTv ?? plexTv
            Task { await probeAll() }
        case .match(let link)?:
            links.pendingMatch = link
            if purpose != .welcome { dismiss() }
        case nil:
            portal = raw
        }
    }

    @discardableResult
    func probeAll() async -> Bool {
        async let p = probe(.portal, portal)
        async let a = probe(.admin, admin)
        let (pc, ac) = await (p, a)
        portalCheck = pc
        adminCheck = ac
        // An admin answering with the portal's public address fills an empty
        // portal slot — offered, and probed like anything typed.
        if case .ok(let info) = ac, let suggested = info.portalURL, portal.trimmingCharacters(in: .whitespaces).isEmpty, showPortal {
            portal = suggested
            portalCheck = await probe(.portal, suggested)
        }
        return [portalCheck, adminCheck].allSatisfy { if case .failed = $0 { false } else { true } }
    }

    func probe(_ role: ServerProduct, _ text: String) async -> Check {
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { return .idle }
        await MainActor.run { if role == .portal { portalCheck = .checking } else { adminCheck = .checking } }
        switch await ServerProbe().probe(text, want: role) {
        case .ok(let info): return .ok(info)
        case .failed(let failure): return .failed(failure.message(want: role))
        }
    }

    func connect() async {
        working = true
        defer { working = false }
        guard await probeAll() else { return }
        let roles: [(ServerProduct, Check)] = [(.portal, portalCheck), (.admin, adminCheck)]
        for case (let role, .ok(let info)) in roles {
            store.setServer(role, origin: info.origin)
        }
        if let plexTv { store.setPlexTvOverride(plexTv) }
        if case .link = purpose { links.connect = nil }
        guard purpose != .welcome else { return }
        dismiss()
        // Already signed in somewhere: the new server gets its own fresh PIN
        // straight away rather than sitting there signed out.
        if store.portal?.isSignedIn == true || store.admin?.isSignedIn == true {
            let pending = signIn.rolesNeedingSession
            if !pending.isEmpty { Task { await signIn.signIn(pending) } }
        }
    }
}

/// VisionKit's live scanner, reporting the first QR code it reads.
struct QRScannerView: UIViewControllerRepresentable {
    let found: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(found: found) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let found: (String) -> Void
        var done = false
        init(found: @escaping (String) -> Void) { self.found = found }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !done else { return }
            for case .barcode(let code) in items {
                if let payload = code.payloadStringValue {
                    done = true
                    scanner.stopScanning()
                    found(payload)
                    return
                }
            }
        }
    }
}
