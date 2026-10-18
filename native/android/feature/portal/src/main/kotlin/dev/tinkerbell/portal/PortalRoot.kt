// The Portal half: what a person this server shares with sees.
//
// Tabs follow `apps/portal/src/PortalApp.tsx` — Tastes first, because your
// collections are empty until you've said what you like — and each sits
// behind the admin's switch for it (`components`). A tab the admin turns off
// while you're looking at it disappears on the next refresh rather than
// showing an error: the server answers FORBIDDEN, the screen asks the model to
// re-read the switches, and the navigation bar follows.
//
// One NavHost for the whole half, with each tab's stack saved and restored on
// switching — the standard Material pattern, and what makes Back inside a tab
// pop that tab rather than jump between tabs.
package dev.tinkerbell.portal

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.LocalMovies
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import dev.tinkerbell.api.ApiError
import dev.tinkerbell.api.PortalUrls
import dev.tinkerbell.api.TrpcClient
import dev.tinkerbell.model.Portal
import dev.tinkerbell.model.PortalApi
import dev.tinkerbell.platform.ui.ErrorState
import dev.tinkerbell.platform.ui.LocalShell
import dev.tinkerbell.platform.ui.rememberHaptics
import dev.tinkerbell.portal.match.MatchLobbyScreen
import dev.tinkerbell.portal.match.NewRoomScreen
import dev.tinkerbell.portal.match.JoinedRoomScreen
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable

enum class PortalTab(val title: String, val icon: ImageVector) {
    TASTES("Tastes", Icons.Outlined.Favorite),
    COLLECTIONS("Collections", Icons.Outlined.GridView),
    MATCH("Match", Icons.Outlined.LocalMovies),
    LEAVING("Leaving", Icons.Outlined.Schedule),
    ACCOUNT("Account", Icons.Outlined.AccountCircle),
}

@Serializable internal object TastesRoute
@Serializable internal object CollectionsRoute
@Serializable internal object MatchRoute
@Serializable internal object LeavingRoute
@Serializable internal object AccountRoute
@Serializable internal data class NewRoomRoute(val sectionId: String)
@Serializable internal data class RoomRoute(val code: String, val invite: String? = null)

internal fun PortalTab.route(): Any = when (this) {
    PortalTab.TASTES -> TastesRoute
    PortalTab.COLLECTIONS -> CollectionsRoute
    PortalTab.MATCH -> MatchRoute
    PortalTab.LEAVING -> LeavingRoute
    PortalTab.ACCOUNT -> AccountRoute
}

class PortalModel(val client: TrpcClient, val scope: CoroutineScope) {
    var me by mutableStateOf<Portal.MeOutput?>(null)
    var components by mutableStateOf<Portal.ComponentsOutput?>(null)
    var personalization by mutableStateOf<Portal.PersonalizationStatusOutput?>(null)
    var error by mutableStateOf<ApiError?>(null)
    var tab by mutableStateOf(PortalTab.TASTES)

    val baseUrl: String get() = client.baseUrl

    suspend fun load() {
        try {
            me = client.call(PortalApi.me)
            components = client.call(PortalApi.components)
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiError) {
            if (e !is ApiError.Cancelled && me == null) error = e
        }
        personalization = try {
            client.call(PortalApi.personalizationStatus)
        } catch (e: ApiError) {
            personalization
        }
    }

    /** A screen got FORBIDDEN: the admin probably just switched it off. */
    suspend fun componentWentAway() {
        try {
            components = client.call(PortalApi.components)
        } catch (_: ApiError) {
        }
    }

    val visibleTabs: List<PortalTab>
        get() {
            val c = components ?: return listOf(PortalTab.ACCOUNT)
            return buildList {
                if (c.tabTastes) add(PortalTab.TASTES)
                if (c.tabCollections) add(PortalTab.COLLECTIONS)
                if (c.tabMatch) add(PortalTab.MATCH)
                if (c.tabLeaving) add(PortalTab.LEAVING)
                add(PortalTab.ACCOUNT)
            }
        }

    fun poster(path: String?): String? = PortalUrls.poster(baseUrl, path)
}

val LocalPortal = staticCompositionLocalOf<PortalModel> { error("No PortalModel") }

@Composable
fun PortalRoot(client: TrpcClient) {
    val scope = rememberCoroutineScope()
    val model = remember(client) { PortalModel(client, scope) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // On every return to the foreground: the admin may have changed the switches.
    LaunchedEffect(model) { lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { model.load() } }

    CompositionLocalProvider(LocalPortal provides model) {
        when {
            model.components != null -> Tabs(model)
            model.error != null -> ErrorState(model.error!!, onRetry = null, modifier = Modifier.fillMaxSize())
            else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
    }
}

@Composable
private fun Tabs(model: PortalModel) {
    val nav = rememberNavController()
    val shell = LocalShell.current
    val haptics = rememberHaptics()
    val tabs = model.visibleTabs
    // Fixed for the life of this graph: the first tab the admin allows.
    val start = remember { if (model.tab in tabs) model.tab else tabs.first() }

    fun select(tab: PortalTab) {
        if (tab == model.tab) {
            // A second tap on the current tab goes back to its first screen.
            nav.popBackStack(tab.route(), inclusive = false)
            return
        }
        haptics.tick()
        model.tab = tab
        nav.selectTab(tab.route())
    }

    // A tab the admin just switched off: move to the first one still allowed.
    LaunchedEffect(tabs) {
        if (model.tab !in tabs) {
            model.tab = tabs.first()
            nav.selectTab(model.tab.route())
        }
    }
    // A match link for this portal: into the Match tab, and into its room.
    LaunchedEffect(shell.state.pendingMatch) {
        val link = shell.state.pendingMatch ?: return@LaunchedEffect
        if (PortalTab.MATCH !in tabs) return@LaunchedEffect
        shell.state.pendingMatch = null
        model.tab = PortalTab.MATCH
        nav.selectTab(MatchRoute)
        nav.navigate(RoomRoute(link.code, link.invite))
    }

    NavigationSuiteScaffold(
        navigationSuiteItems = {
            for (tab in tabs) {
                item(
                    selected = model.tab == tab,
                    onClick = { select(tab) },
                    icon = { Icon(tab.icon, contentDescription = null) },
                    label = { Text(tab.title) },
                    modifier = Modifier.testTag("tab-${tab.title}"),
                )
            }
        },
    ) {
        NavHost(nav, startDestination = start.route()) {
            composable<TastesRoute> { TastesScreen() }
            composable<CollectionsRoute> { CollectionsScreen() }
            composable<LeavingRoute> { LeavingSoonScreen() }
            composable<AccountRoute> { AccountScreen() }
            composable<MatchRoute> {
                MatchLobbyScreen(
                    onNewRoom = { nav.navigate(NewRoomRoute(it)) },
                    onRoom = { code, invite -> nav.navigate(RoomRoute(code, invite)) },
                )
            }
            composable<NewRoomRoute> { entry ->
                NewRoomScreen(
                    sectionId = entry.toRoute<NewRoomRoute>().sectionId,
                    onBack = { nav.popBackStack() },
                    onCreated = { code ->
                        nav.navigate(RoomRoute(code)) { popUpTo<MatchRoute>() }
                    },
                )
            }
            composable<RoomRoute> { entry ->
                val route = entry.toRoute<RoomRoute>()
                JoinedRoomScreen(code = route.code, invite = route.invite, onLeft = { nav.popBackStack(MatchRoute, inclusive = false) })
            }
        }
    }
}

private fun NavHostController.selectTab(route: Any) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
