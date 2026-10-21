// Which screen the app is on, decided from the connections alone: nothing
// connected is the connect screen, connected but signed in nowhere is sign-in,
// and otherwise the Portal or the Admin half. Because it is derived, a session
// the server rejects (cleared by the client's 401 hook) puts the app back on
// sign-in without any screen having to navigate there.
//
// Above that sit the app-level screens — Settings, a server, a connect link to
// confirm, a room joined as a guest — in one NavHost, so each slides in and
// Back (predictive on Android 14+) slides it away.
package fyi.rube.app

import androidx.activity.compose.LocalActivity

import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.AlertDialog
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalContext
import fyi.rube.platform.ui.isDark
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import fyi.rube.admin.AdminRoot
import fyi.rube.api.ConnectLink
import fyi.rube.api.MatchLink
import fyi.rube.api.ServerAddress
import fyi.rube.api.ServerConnection
import fyi.rube.api.ServerProduct
import fyi.rube.platform.Connections
import fyi.rube.platform.ui.LocalShell
import fyi.rube.platform.ui.Shell
import fyi.rube.platform.ui.RubeTheme
import fyi.rube.portal.PortalRoot
import fyi.rube.portal.match.GuestMatchScreen
import fyi.rube.portal.match.GuestTokens
import kotlinx.serialization.Serializable

@Serializable internal object HomeRoute
@Serializable internal object SettingsRoute
@Serializable internal data class ServerDetailRoute(val role: String)
@Serializable internal data class AddServerRoute(val role: String)
@Serializable internal object ConnectLinkRoute
@Serializable internal object GuestRoute

internal val LocalGraph = staticCompositionLocalOf<AppGraph> { error("No AppGraph") }

/** The app-level navigator, for the shell's own screens. */
internal class AppNav(private val nav: NavHostController) {
    fun settings() = nav.navigate(SettingsRoute) { launchSingleTop = true }
    fun server(role: ServerProduct) = nav.navigate(ServerDetailRoute(role.raw))
    fun add(role: ServerProduct) = nav.navigate(AddServerRoute(role.raw))
    fun back() {
        nav.popBackStack()
    }
}

internal val LocalAppNav = staticCompositionLocalOf<AppNav> { error("No AppNav") }

internal fun origin(connection: ServerConnection?): String? = connection?.let { ServerAddress.origin(it.baseUrl) }

@Composable
fun RubeRoot(graph: AppGraph) {
    val appearance by graph.settings.appearance.collectAsStateWithLifecycle()
    val connections by graph.store.state.collectAsStateWithLifecycle()
    val locked by graph.lock.locked.collectAsStateWithLifecycle()
    val nav = rememberNavController()
    val appNav = remember(nav) { AppNav(nav) }
    val links = graph.links
    val shell = graph.shell

    // A match link: into the Match tab when it's for the portal you're signed
    // in to, as a guest otherwise. Held while sign-in is in progress, so a
    // link that arrived before the session still lands in its room.
    LaunchedEffect(links.pendingMatch, connections.portal?.isSignedIn, connections.portal?.baseUrl, links.connect) {
        val link = links.pendingMatch ?: return@LaunchedEffect
        val portal = connections.portal
        // Connecting to that very portal right now (the guest screen's "sign
        // in instead"): hold the link until the connection and session exist.
        if (portal == null && links.connect?.link?.portal == link.server) return@LaunchedEffect
        if (portal != null && origin(portal) == link.server) {
            if (!portal.isSignedIn) return@LaunchedEffect
            graph.settings.setLastPart(ServerProduct.PORTAL)
            shell.pendingMatch = link
        } else {
            shell.guestMatch = link
        }
        links.pendingMatch = null
    }
    // A connect link over a working app is a screen of its own; on a fresh
    // install it *is* the first screen (see Home).
    LaunchedEffect(links.connect, connections.isEmpty) {
        if (links.connect != null && !connections.isEmpty) nav.navigate(ConnectLinkRoute) { launchSingleTop = true }
    }
    LaunchedEffect(shell.guestMatch) {
        if (shell.guestMatch != null) nav.navigate(GuestRoute) { launchSingleTop = true }
    }

    RubeTheme(appearance) {
        // The bars' icons follow the app's appearance, not the system's: the
        // app is dark by default on a phone that may well be light.
        val dark = appearance.isDark()
        val activity = LocalActivity.current as? ComponentActivity
        SideEffect {
            val style = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
            activity?.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
        }
        CompositionLocalProvider(LocalGraph provides graph, LocalAppNav provides appNav) {
            // Test tags double as resource ids, so UI Automator and `adb` can find them too.
            Surface(Modifier.semantics { testTagsAsResourceId = true }, color = MaterialTheme.colorScheme.background) {
                NavHost(nav, startDestination = HomeRoute) {
                    composable<HomeRoute> { Home(graph, connections) }
                    composable<SettingsRoute> { SettingsScreen() }
                    composable<ServerDetailRoute> { e -> ServerDetailScreen(ServerProduct.fromRaw(e.toRoute<ServerDetailRoute>().role)!!) }
                    composable<AddServerRoute> { e ->
                        ConnectScreen(ConnectPurpose.Add(ServerProduct.fromRaw(e.toRoute<AddServerRoute>().role)!!), onDone = { appNav.back() })
                    }
                    composable<ConnectLinkRoute> {
                        val request = links.connect
                        if (request == null) {
                            LaunchedEffect(Unit) { appNav.back() }
                        } else {
                            key(request.id) {
                                ConnectScreen(ConnectPurpose.Link(request.link), onDone = {
                                    links.connect = null
                                    appNav.back()
                                })
                            }
                        }
                    }
                    composable<GuestRoute> {
                        val link = shell.guestMatch
                        if (link == null) {
                            LaunchedEffect(Unit) { appNav.back() }
                        } else {
                            GuestRoom(graph, connections, link, onClose = {
                                shell.guestMatch = null
                                appNav.back()
                            })
                        }
                    }
                }
                if (locked) LockScreen(graph.lock)
                links.error?.let { message ->
                    AlertDialog(
                        onDismissRequest = { links.error = null },
                        title = { Text("Can't open link") },
                        text = { Text(message) },
                        confirmButton = { TextButton(onClick = { links.error = null }) { Text("OK") } },
                    )
                }
            }
        }
    }
}

@Composable
private fun Home(graph: AppGraph, connections: Connections) {
    val appNav = LocalAppNav.current
    val lastPart by graph.settings.lastPart.collectAsStateWithLifecycle()
    when {
        connections.isEmpty -> {
            val request = graph.links.connect
            if (request != null) {
                key(request.id) { ConnectScreen(ConnectPurpose.Link(request.link), onDone = { graph.links.connect = null }) }
            } else {
                ConnectScreen(ConnectPurpose.Welcome, onDone = {})
            }
        }
        !connections.anySignedIn -> SignInScreen()
        else -> {
            val portal = connections.portal
            val admin = connections.admin
            val wantsAdmin = lastPart == ServerProduct.ADMIN || portal?.isSignedIn != true
            val shell = Shell(
                state = graph.shell,
                canSwitch = portal?.isSignedIn == true && admin?.isSignedIn == true,
                part = if (wantsAdmin && admin?.isSignedIn == true) ServerProduct.ADMIN else ServerProduct.PORTAL,
                switchTo = graph.settings::setLastPart,
                openSettings = appNav::settings,
                settingsContent = { SettingsSections() },
            )
            CompositionLocalProvider(LocalShell provides shell) {
                if (wantsAdmin && admin != null && admin.isSignedIn) {
                    key("admin", admin.baseUrl, admin.sessionToken ?: "open") {
                        val client = remember { graph.store.client(ServerProduct.ADMIN)!! }
                        AdminRoot(admin, client)
                    }
                } else if (portal != null && portal.isSignedIn) {
                    key("portal", portal.baseUrl, portal.sessionToken) {
                        val client = remember { graph.store.client(ServerProduct.PORTAL)!! }
                        PortalRoot(client)
                    }
                }
            }
        }
    }
}

@Composable
private fun GuestRoom(graph: AppGraph, connections: Connections, link: MatchLink, onClose: () -> Unit) {
    val tokens = remember(graph) {
        object : GuestTokens {
            override fun get(server: String, code: String) = graph.store.guestToken(server, code)
            override fun set(token: String?, server: String, code: String) = graph.store.setGuestToken(token, server, code)
        }
    }
    val portal = connections.portal
    // Offered when this might be your own portal after all.
    val canSignIn = portal == null || origin(portal) == link.server
    GuestMatchScreen(
        link = link,
        tokens = tokens,
        onClose = onClose,
        onSignIn = if (canSignIn) {
            {
                onClose()
                if (graph.store.current.portal == null) graph.links.connect = ConnectRequest(ConnectLink(portal = link.server))
                graph.links.pendingMatch = link
            }
        } else {
            null
        },
    )
}
