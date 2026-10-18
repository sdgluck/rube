// What the two halves of the app share from the shell around them: the
// Portal ⇄ Admin switch, the way to open Settings, and the Settings rows
// themselves. Passed down through the environment because the shell (sign-in,
// connecting, the lock) lives in the app target, which the features can't
// import — and shouldn't, or a screen could start a sign-in.

import SwiftUI
import TinkerbellAPI

extension EnvironmentValues {
    /// The app's own settings rows, for the portal's Account tab to embed.
    @Entry public var appSettingsSections: AnyView = AnyView(EmptyView())
}

/// Requests from a screen to the shell: open Settings, open a match room a
/// link named. An object rather than closures in the environment so SwiftUI
/// can tell when it actually changed.
@Observable
@MainActor
public final class ShellState {
    public var showingSettings = false
    /// A `tinkerbell://match` link for the signed-in portal user, waiting for
    /// the Match tab to pick it up.
    public var pendingMatch: MatchLink?
    /// A room to join as a guest — on a server you have no session with.
    public var guestMatch: MatchLink?

    public init() {}
}

/// The account button at the top of every tab: which half you're in, and
/// Settings. The switch only appears for someone signed in to both — a portal
/// user never sees that an admin half exists.
public struct PartMenu: View {
    @Environment(ConnectionStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ShellState.self) private var shell

    public init() {}

    var canSwitch: Bool {
        (store.portal?.isSignedIn ?? false) && (store.admin?.isSignedIn ?? false)
    }

    public var body: some View {
        Menu {
            if canSwitch {
                Picker("Part", selection: Binding(get: { settings.lastPart }, set: { settings.lastPart = $0 })) {
                    Label("Portal", systemImage: "sparkles.tv").tag(ServerProduct.portal)
                    Label("Admin", systemImage: "slider.horizontal.3").tag(ServerProduct.admin)
                }
                .pickerStyle(.inline)
            }
            Button("Settings", systemImage: "gearshape") { shell.showingSettings = true }
        } label: {
            Label(canSwitch ? "Switch to \(settings.lastPart == .portal ? "Admin" : "Portal")" : "Settings",
                  systemImage: canSwitch ? "arrow.left.arrow.right.circle" : "gearshape")
        }
        .accessibilityIdentifier("part-menu")
    }
}

/// Wraps chips onto as many lines as they need — genres, moods, filters.
public struct FlowLayout: Layout {
    var spacing: CGFloat

    public init(spacing: CGFloat = 8) {
        self.spacing = spacing
    }

    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? width, height: height)
    }

    public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            if !rows[rows.count - 1].indices.isEmpty, rows[rows.count - 1].width + spacing + size.width > width {
                rows.append(Row())
            }
            var row = rows.removeLast()
            row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            rows.append(row)
        }
        return rows.filter { !$0.indices.isEmpty }
    }
}

/// A selectable capsule — the stock bordered button, tinted when on.
public struct Chip: View {
    let title: String
    let systemImage: String?
    let isOn: Bool
    let tint: Color
    let action: () -> Void

    public init(_ title: String, systemImage: String? = nil, isOn: Bool, tint: Color = .accentColor, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.isOn = isOn
        self.tint = tint
        self.action = action
    }

    public var body: some View {
        Group {
            if isOn {
                Button(action: action) { label }.buttonStyle(.borderedProminent)
            } else {
                Button(action: action) { label }.buttonStyle(.bordered)
            }
        }
        .tint(isOn ? tint : .secondary)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    @ViewBuilder var label: some View {
        if let systemImage {
            Label(title, systemImage: systemImage)
        } else {
            Text(title)
        }
    }
}
