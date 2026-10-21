// The Admin half: a curated subset of the web admin, for the things worth
// doing from a sofa — seeing what's playing and what's broken, running and
// watching jobs, deciding on cleanup, browsing collections and users.
// Everything else (rule editing, settings) is an "Open in Web Admin" link,
// because a rule editor on a phone would be a worse copy of the web one.
//
// Every file here is iOS-only so `swift test` on macOS still builds the package.

#if os(iOS)
import SwiftUI
import RubeAPI
import RubeCore
import RubeModels

public enum AdminTab: Hashable, Sendable {
    case overview, jobs, cleanup, collections, users
}

@Observable
@MainActor
public final class AdminModel {
    public let client: TRPCClient
    public let baseURL: URL
    let token: String?
    let openAuth: Bool
    var metrics: Admin.NavMetricsOutput?
    var tab: AdminTab = .overview

    public init(connection: ServerConnection, client: TRPCClient) {
        self.client = client
        baseURL = connection.baseURL
        token = connection.sessionToken
        openAuth = connection.openAuth
    }

    /// A Plex image through the admin's proxy, with the session — and only
    /// then. A user's avatar is an absolute plex.tv URL, and the admin
    /// session must never be sent anywhere but the admin server.
    func image(_ path: String?) -> ImageRequest? {
        guard let url = AdminURLs.plexImage(base: baseURL, path: path) else { return nil }
        let sameOrigin = ServerAddress.origin(of: url.absoluteString) == ServerAddress.origin(of: baseURL.absoluteString)
        return ImageRequest(url: url, bearer: sameOrigin ? token : nil)
    }

    func web(_ path: String) -> URL? { AdminURLs.web(base: baseURL, path: path) }

    func refreshMetrics() async {
        if let fresh = try? await client.call(AdminAPI.navMetrics) { metrics = fresh }
    }
}

public struct AdminRootView: View {
    @State private var model: AdminModel

    public init(connection: ServerConnection, client: TRPCClient) {
        _model = State(initialValue: AdminModel(connection: connection, client: client))
    }

    public var body: some View {
        TabView(selection: $model.tab) {
            Tab("Overview", systemImage: "gauge.with.dots.needle.67percent", value: AdminTab.overview) {
                stack { OverviewView() }
            }
            .badge(badge(model.metrics?.problems))
            Tab("Jobs", systemImage: "gearshape.2", value: AdminTab.jobs) {
                stack { JobsAndRulesView() }
            }
            .badge(model.metrics?.jobsStatus == .error ? Text("!") : nil)
            Tab("Cleanup", systemImage: "trash", value: AdminTab.cleanup) {
                stack { CleanupView() }
            }
            .badge(badge(model.metrics?.cleanupDueSoon))
            Tab("Collections", systemImage: "square.stack", value: AdminTab.collections) {
                stack { AdminCollectionsView() }
            }
            Tab("Users", systemImage: "person.2", value: AdminTab.users) {
                stack { UsersView() }
            }
        }
        .sensoryFeedback(.selection, trigger: model.tab)
        .environment(model)
        .task {
            // The badges, at the web sidebar's pace.
            while !Task.isCancelled {
                await model.refreshMetrics()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    func badge(_ value: Double?) -> Int {
        Int(value ?? 0)
    }

    func stack<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        NavigationStack {
            content()
                .toolbar { ToolbarItem(placement: .topBarTrailing) { PartMenu() } }
                .navigationDestination(for: AdminRoute.self) { AdminRouteView(route: $0) }
        }
    }
}

/// Every push in the admin half, so any screen can link to any other.
enum AdminRoute: Hashable {
    case media(ratingKey: String, title: String)
    case collection(ratingKey: String, title: String)
    case user(id: Int, name: String)
    case job(id: String, name: String)
    case jobRun(id: String)
    case rule(id: String)
    case ruleRun(id: String)
    case problems
    case health
    case events
    case protections
}

struct AdminRouteView: View {
    let route: AdminRoute

    var body: some View {
        switch route {
        case .media(let key, let title): MediaDetailView(ratingKey: key, title: title)
        case .collection(let key, let title): CollectionDetailView(ratingKey: key, title: title)
        case .user(let id, let name): UserDetailView(userID: id, name: name)
        case .job(let id, let name): JobDetailView(jobID: id, name: name)
        case .jobRun(let id): JobRunView(runID: id)
        case .rule(let id): RuleDetailView(ruleID: id)
        case .ruleRun(let id): RuleRunView(runID: id)
        case .problems: ProblemsView()
        case .health: HealthView()
        case .events: EventsView()
        case .protections: ProtectionsView()
        }
    }
}

/// "Open in Web Admin" — for the parts of a screen the app leaves to the web.
struct WebAdminLink: View {
    @Environment(AdminModel.self) private var model
    let path: String
    var title = "Open in Web Admin"

    var body: some View {
        if let url = model.web(path) {
            Link(destination: url) {
                Label(title, systemImage: "safari")
            }
        }
    }
}

/// A run's status as a coloured symbol, for jobs and rules alike.
struct RunStatusIcon: View {
    let status: String?

    var body: some View {
        switch status {
        case "completed"?, "ok"?, "success"?:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case "failed"?, "error"?:
            Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
        case "running"?, "queued"?, "cancelling"?:
            ProgressView().controlSize(.small)
        case "cancelled"?:
            Image(systemName: "stop.circle").foregroundStyle(.secondary)
        case nil:
            Image(systemName: "circle.dashed").foregroundStyle(.tertiary)
        default:
            Image(systemName: "circle").foregroundStyle(.secondary)
        }
    }
}

func isRunActive(_ status: String?) -> Bool {
    status == "running" || status == "cancelling" || status == "queued"
}

extension Int {
    var asDate: Date { RelativeTime.date(ms: self) }
}
#endif
