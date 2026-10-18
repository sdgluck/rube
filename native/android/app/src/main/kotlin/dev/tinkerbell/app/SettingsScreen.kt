// The app's own settings: which servers, the lock, the look, signing out.
//
// Written as bare rows (`SettingsSections`) so the portal's Account tab can
// embed them under the person's own details, and the admin half can show them
// as a screen — one set of rows, two places, rather than two settings screens
// that drift.
package dev.tinkerbell.app

import androidx.activity.compose.LocalActivity

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.OpenInBrowser
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.tinkerbell.api.ServerCheck
import dev.tinkerbell.api.ServerConnection
import dev.tinkerbell.api.ServerProbe
import dev.tinkerbell.api.ServerProduct
import dev.tinkerbell.api.SignInExchange
import dev.tinkerbell.platform.Appearance
import dev.tinkerbell.platform.BiometricAuthenticator
import dev.tinkerbell.platform.Links
import dev.tinkerbell.platform.ui.ConfirmDialog
import dev.tinkerbell.platform.ui.LabeledRow
import dev.tinkerbell.platform.ui.Nav
import dev.tinkerbell.platform.ui.SectionHeader
import dev.tinkerbell.platform.ui.TbScreen
import dev.tinkerbell.platform.ui.Tones
import dev.tinkerbell.platform.ui.clickableRow
import kotlinx.coroutines.launch

@Composable
internal fun SettingsScreen() {
    val nav = LocalAppNav.current
    TbScreen("Settings", nav = Nav.BACK, onNav = { nav.back() }, inSuite = false) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) { SettingsSections() }
    }
}

@Composable
internal fun SettingsSections() {
    val graph = LocalGraph.current
    val nav = LocalAppNav.current
    val context = LocalContext.current
    val activity = LocalActivity.current as? FragmentActivity
    val scope = rememberCoroutineScope()
    val connections by graph.store.state.collectAsStateWithLifecycle()
    val phase by graph.signIn.phase.collectAsStateWithLifecycle()
    val messages by graph.signIn.messages.collectAsStateWithLifecycle()
    val lockOn by graph.lock.enabled.collectAsStateWithLifecycle()
    val appearance by graph.settings.appearance.collectAsStateWithLifecycle()
    var confirmSignOut by remember { mutableStateOf(false) }
    val transparent = ListItemDefaults.colors(containerColor = Color.Transparent)

    SectionHeader("Servers")
    for (role in ServerProduct.entries) {
        val connection = connections[role]
        if (connection != null) {
            ServerRow(connection, Modifier.clickableRow { nav.server(role) }.testTag("server-${role.raw}"))
        } else {
            ListItem(
                headlineContent = { Text("Add ${role.label.lowercase()} server") },
                leadingContent = { Icon(Icons.Outlined.AddCircleOutline, contentDescription = null) },
                colors = transparent,
                modifier = Modifier.clickableRow { nav.add(role) },
            )
        }
    }
    val pending = connections.rolesNeedingSession
    if (pending.isNotEmpty()) {
        ListItem(
            headlineContent = {
                Text(if (phase == SignInCoordinator.Phase.IDLE) "Sign in to ${pending.joinToString(" and ") { it.label }}" else "Signing in…")
            },
            leadingContent = { Icon(Icons.Outlined.Key, contentDescription = null) },
            colors = transparent,
            modifier = Modifier.clickableRow { if (phase == SignInCoordinator.Phase.IDLE) graph.signIn.start() },
        )
    }
    for (message in messages) Text(message, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)

    if (activity != null && BiometricAuthenticator.isAvailable(activity)) {
        SectionHeader("Security")
        val biometrics = BiometricAuthenticator.hasBiometrics(activity)
        ListItem(
            headlineContent = { Text(if (biometrics) "Lock with fingerprint or face" else "Lock with screen lock") },
            supportingContent = { Text("Asks when the app opens, and when you come back after five minutes away.") },
            leadingContent = { Icon(if (biometrics) Icons.Outlined.Fingerprint else Icons.Outlined.Lock, contentDescription = null) },
            trailingContent = {
                Switch(checked = lockOn, onCheckedChange = { on -> scope.launch { graph.lock.setEnabled(on, BiometricAuthenticator(activity)) } })
            },
            colors = transparent,
        )
    }

    SectionHeader("Appearance")
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Appearance.entries.forEachIndexed { i, option ->
            SegmentedButton(
                selected = appearance == option,
                onClick = { graph.settings.setAppearance(option) },
                shape = SegmentedButtonDefaults.itemShape(i, Appearance.entries.size),
                modifier = Modifier.testTag("appearance-${option.name.lowercase()}"),
            ) { Text(option.label) }
        }
    }

    connections.admin?.let { admin ->
        ListItem(
            headlineContent = { Text("Open web admin") },
            leadingContent = { Icon(Icons.Outlined.OpenInBrowser, contentDescription = null) },
            colors = transparent,
            modifier = Modifier.clickableRow { Links.openInTab(context, admin.baseUrl) },
        )
    }

    SectionHeader("About")
    LabeledRow("Version", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
    if (connections.anySignedIn) {
        ListItem(
            headlineContent = { Text("Sign out", color = MaterialTheme.colorScheme.error) },
            leadingContent = { Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
            colors = transparent,
            modifier = Modifier.clickableRow { confirmSignOut = true }.testTag("sign-out"),
        )
    }

    if (confirmSignOut) {
        ConfirmDialog(
            "Sign out of Tinkerbell?",
            "You'll need to sign in with Plex again. Your servers stay connected.",
            "Sign out",
            onConfirm = { graph.scope.launch { signOut(graph) } },
            onDismiss = { confirmSignOut = false },
        )
    }
}

/**
 * Logout on each server, then forget the tokens whatever they said — a
 * sign-out that fails offline must still sign out.
 */
internal suspend fun signOut(graph: AppGraph) {
    val store = graph.store
    if (store.current.portal?.sessionToken != null) store.client(ServerProduct.PORTAL)?.let { SignInExchange.logoutPortal(it) }
    if (store.current.admin?.sessionToken != null) store.client(ServerProduct.ADMIN)?.let { SignInExchange.logoutAdmin(it) }
    store.setSession(ServerProduct.PORTAL, null)
    store.setSession(ServerProduct.ADMIN, null)
}

@Composable
private fun ServerRow(connection: ServerConnection, modifier: Modifier) {
    ListItem(
        headlineContent = { Text(connection.role.label) },
        supportingContent = {
            Column {
                Text(connection.displayHost)
                when {
                    connection.openAuth -> Text("Sign-in is off on this server", color = MaterialTheme.colorScheme.error)
                    !connection.isSignedIn -> Text("Not signed in", color = Tones.warning)
                }
                if (connection.isUnencryptedRemote) Text("Not encrypted", color = Tones.warning)
            }
        },
        leadingContent = { Icon(Icons.Outlined.Dns, contentDescription = null) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = modifier,
    )
}

@Composable
internal fun ServerDetailScreen(role: ServerProduct) {
    val graph = LocalGraph.current
    val nav = LocalAppNav.current
    val connections by graph.store.state.collectAsStateWithLifecycle()
    val phase by graph.signIn.phase.collectAsStateWithLifecycle()
    var check by remember { mutableStateOf<ServerCheck?>(null) }
    var confirmRemove by remember { mutableStateOf(false) }
    val connection = connections[role]

    LaunchedEffect(connection?.baseUrl) {
        connection?.let { check = ServerProbe().probe(it.baseUrl, role) }
    }

    TbScreen(role.label, nav = Nav.BACK, onNav = { nav.back() }, inSuite = false) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
            if (connection == null) return@Column
            LabeledRow("Address", connection.baseUrl)
            when (val c = check) {
                is ServerCheck.Ok -> LabeledRow("Version", c.info.version)
                is ServerCheck.Failed -> Text(c.failure.message(role), Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
                null -> LabeledRow("Version", "Checking…")
            }
            LabeledRow("Session", if (connection.openAuth) "Sign-in off" else if (connection.sessionToken == null) "Signed out" else "Signed in")
            if (connection.isUnencryptedRemote) {
                Text(
                    "Not encrypted: this server is reached over plain HTTP across the internet, so your session can be read on the way.",
                    Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = Tones.warning,
                )
            }
            ListItem(
                headlineContent = { Text("Sign in again") },
                leadingContent = { Icon(Icons.Outlined.Key, contentDescription = null) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickableRow { if (phase == SignInCoordinator.Phase.IDLE) graph.signIn.start(listOf(role)) },
            )
            ListItem(
                headlineContent = { Text("Remove server", color = MaterialTheme.colorScheme.error) },
                leadingContent = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickableRow { confirmRemove = true },
            )
        }
    }
    if (confirmRemove) {
        ConfirmDialog(
            "Remove the ${role.label.lowercase()} server?",
            "This signs you out of it on this phone.",
            "Remove server",
            onConfirm = {
                graph.scope.launch {
                    val store = graph.store
                    if (store.current[role]?.sessionToken != null) {
                        store.client(role)?.let { if (role == ServerProduct.PORTAL) SignInExchange.logoutPortal(it) else SignInExchange.logoutAdmin(it) }
                    }
                    store.remove(role)
                    nav.back()
                }
            },
            onDismiss = { confirmRemove = false },
        )
    }
}
