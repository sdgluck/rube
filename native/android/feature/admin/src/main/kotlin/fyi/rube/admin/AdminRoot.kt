// The Admin half: a curated subset of the web admin, for the things worth
// doing from a sofa — seeing what's playing and what's broken, running and
// watching jobs, deciding on cleanup, browsing collections and users.
// Everything else (rule editing, settings) is an "Open in web admin" link,
// because a rule editor on a phone would be a worse copy of the web one.
package fyi.rube.admin

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Collections
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.DeleteSweep
import androidx.compose.material.icons.outlined.Error
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.OpenInBrowser
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import fyi.rube.api.AdminUrls
import fyi.rube.api.ApiError
import fyi.rube.api.ServerConnection
import fyi.rube.api.TrpcClient
import fyi.rube.model.Admin
import fyi.rube.model.AdminApi
import fyi.rube.platform.Links
import fyi.rube.platform.ui.Poll
import fyi.rube.platform.ui.Tones
import fyi.rube.platform.ui.clickableRow
import fyi.rube.platform.ui.rememberHaptics
import kotlinx.coroutines.CoroutineScope
import kotlinx.serialization.Serializable

enum class AdminTab(val title: String, val icon: ImageVector) {
    OVERVIEW("Overview", Icons.Outlined.Dashboard),
    JOBS("Jobs", Icons.Outlined.Sync),
    CLEANUP("Cleanup", Icons.Outlined.DeleteSweep),
    COLLECTIONS("Collections", Icons.Outlined.Collections),
    USERS("Users", Icons.Outlined.Group),
}

@Serializable internal object OverviewRoute
@Serializable internal object JobsRoute
@Serializable internal object CleanupRoute
@Serializable internal object CollectionsRoute
@Serializable internal object UsersRoute
@Serializable internal object ProblemsRoute
@Serializable internal object HealthRoute
@Serializable internal object EventsRoute
@Serializable internal object ProtectionsRoute
@Serializable internal data class MediaRoute(val ratingKey: String, val title: String)
@Serializable internal data class CollectionRoute(val ratingKey: String, val title: String)
@Serializable internal data class UserRoute(val id: Long, val name: String)
@Serializable internal data class JobRoute(val id: String, val name: String)
@Serializable internal data class JobRunRoute(val id: String)
@Serializable internal data class RuleRoute(val id: String)
@Serializable internal data class RuleRunRoute(val id: String)

internal fun AdminTab.route(): Any = when (this) {
    AdminTab.OVERVIEW -> OverviewRoute
    AdminTab.JOBS -> JobsRoute
    AdminTab.CLEANUP -> CleanupRoute
    AdminTab.COLLECTIONS -> CollectionsRoute
    AdminTab.USERS -> UsersRoute
}

class AdminModel(connection: ServerConnection, val client: TrpcClient, val scope: CoroutineScope) {
    val baseUrl: String = connection.baseUrl
    val openAuth: Boolean = connection.openAuth
    var metrics by mutableStateOf<Admin.NavMetricsOutput?>(null)
    var tab by mutableStateOf(AdminTab.OVERVIEW)

    /**
     * A Plex image through the admin's proxy. The image loader adds the
     * session for exactly this origin and path; a user's avatar is an absolute
     * plex.tv URL and goes out bare.
     */
    fun image(path: String?): String? = AdminUrls.plexImage(baseUrl, path)

    fun web(path: String): String = AdminUrls.web(baseUrl, path)

    suspend fun refreshMetrics() {
        try {
            metrics = client.call(AdminApi.navMetrics)
        } catch (_: ApiError) {
        }
    }
}

internal val LocalAdmin = staticCompositionLocalOf<AdminModel> { error("No AdminModel") }

/** Every push in the admin half, so any screen can link to any other. */
internal class AdminNav(private val controller: NavHostController) {
    fun go(route: Any) = controller.navigate(route)
    fun back() {
        controller.popBackStack()
    }
}

internal val LocalAdminNav = staticCompositionLocalOf<AdminNav> { error("No AdminNav") }

@Composable
fun AdminRoot(connection: ServerConnection, client: TrpcClient) {
    val scope = rememberCoroutineScope()
    val model = remember(client) { AdminModel(connection, client, scope) }
    val nav = rememberNavController()
    val adminNav = remember(nav) { AdminNav(nav) }
    val haptics = rememberHaptics()

    // The badges, at the web sidebar's pace.
    Poll(30_000) { model.refreshMetrics() }

    fun select(tab: AdminTab) {
        if (tab == model.tab) {
            nav.popBackStack(tab.route(), inclusive = false)
            return
        }
        haptics.tick()
        model.tab = tab
        nav.navigate(tab.route()) {
            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }

    CompositionLocalProvider(LocalAdmin provides model, LocalAdminNav provides adminNav) {
        NavigationSuiteScaffold(
            navigationSuiteItems = {
                for (tab in AdminTab.entries) {
                    val badge: String? = when (tab) {
                        AdminTab.OVERVIEW -> model.metrics?.problems?.toLong()?.takeIf { it > 0 }?.toString()
                        AdminTab.JOBS -> if (model.metrics?.jobsStatus == Admin.NavMetricsOutput.JobsStatus.ERROR) "!" else null
                        AdminTab.CLEANUP -> model.metrics?.cleanupDueSoon?.toLong()?.takeIf { it > 0 }?.toString()
                        else -> null
                    }
                    item(
                        selected = model.tab == tab,
                        onClick = { select(tab) },
                        icon = {
                            if (badge != null) {
                                BadgedBox(badge = { Badge { Text(badge) } }) { Icon(tab.icon, contentDescription = null) }
                            } else {
                                Icon(tab.icon, contentDescription = null)
                            }
                        },
                        label = { Text(tab.title) },
                        modifier = Modifier.testTag("tab-${tab.title}"),
                    )
                }
            },
        ) {
            NavHost(nav, startDestination = OverviewRoute) {
                composable<OverviewRoute> { OverviewScreen() }
                composable<JobsRoute> { JobsAndRulesScreen() }
                composable<CleanupRoute> { CleanupScreen() }
                composable<CollectionsRoute> { CollectionsScreen() }
                composable<UsersRoute> { UsersScreen() }
                composable<ProblemsRoute> { ProblemsScreen() }
                composable<HealthRoute> { HealthScreen() }
                composable<EventsRoute> { EventsScreen() }
                composable<ProtectionsRoute> { ProtectionsScreen() }
                composable<MediaRoute> { e -> e.toRoute<MediaRoute>().let { MediaDetailScreen(it.ratingKey, it.title) } }
                composable<CollectionRoute> { e -> e.toRoute<CollectionRoute>().let { CollectionDetailScreen(it.ratingKey, it.title) } }
                composable<UserRoute> { e -> e.toRoute<UserRoute>().let { UserDetailScreen(it.id, it.name) } }
                composable<JobRoute> { e -> e.toRoute<JobRoute>().let { JobDetailScreen(it.id, it.name) } }
                composable<JobRunRoute> { e -> JobRunScreen(e.toRoute<JobRunRoute>().id) }
                composable<RuleRoute> { e -> RuleDetailScreen(e.toRoute<RuleRoute>().id) }
                composable<RuleRunRoute> { e -> RuleRunScreen(e.toRoute<RuleRunRoute>().id) }
            }
        }
    }
}

/** "Open in web admin" — for the parts of a screen the app leaves to the web. Opens in a Custom Tab. */
@Composable
internal fun WebAdminRow(path: String, title: String = "Open in web admin") {
    val model = LocalAdmin.current
    val context = LocalContext.current
    ListItem(
        headlineContent = { Text(title) },
        leadingContent = { Icon(Icons.Outlined.OpenInBrowser, contentDescription = null) },
        modifier = Modifier.clickableRow { Links.openInTab(context, model.web(path)) },
    )
}

/** A run's status as a coloured symbol, for jobs and rules alike. */
@Composable
internal fun RunStatusIcon(status: String?) {
    when (status) {
        "completed", "ok", "success" -> Icon(Icons.Outlined.CheckCircle, contentDescription = "Succeeded", tint = Tones.success)
        "failed", "error" -> Icon(Icons.Outlined.Error, contentDescription = "Failed", tint = MaterialTheme.colorScheme.error)
        "running", "queued", "cancelling" -> CircularProgressIndicator(Modifier.size(22.dp).testTag("run-active"), strokeWidth = 2.dp)
        "cancelled" -> Icon(Icons.Outlined.StopCircle, contentDescription = "Cancelled", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        null -> Icon(Icons.Outlined.RadioButtonUnchecked, contentDescription = "Never run", tint = MaterialTheme.colorScheme.outline)
        else -> Icon(Icons.Outlined.HourglassTop, contentDescription = status, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

internal fun isRunActive(status: String?) = status == "running" || status == "cancelling" || status == "queued"
