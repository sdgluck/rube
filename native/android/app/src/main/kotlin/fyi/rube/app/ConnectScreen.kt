// Pointing the app at its servers: typed, pasted, scanned, or from a link.
//
// Whatever the source, the same screen: each address is probed (`auth.server`,
// 8s) before it is saved, and so before it can ever be handed a Plex token at
// sign-in — a connect link can come from anywhere, and this is where a fake
// server is caught. Nothing here replaces an existing connection without the
// person seeing it and pressing the button that says so.
package fyi.rube.app

import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Error
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import fyi.rube.api.DeepLink
import fyi.rube.api.ServerAddress
import fyi.rube.api.ServerCheck
import fyi.rube.api.ServerInfo
import fyi.rube.api.ServerProbe
import fyi.rube.api.ServerProduct
import fyi.rube.platform.ui.Nav
import fyi.rube.platform.ui.SectionHeader
import fyi.rube.platform.ui.TbScreen
import fyi.rube.platform.ui.Tones
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

sealed interface ConnectPurpose {
    data object Welcome : ConnectPurpose
    data class Link(val link: fyi.rube.api.ConnectLink) : ConnectPurpose
    data class Add(val role: ServerProduct) : ConnectPurpose
}

private sealed interface Check {
    data object Idle : Check
    data object Checking : Check
    data class Ok(val info: ServerInfo) : Check
    data class Failed(val message: String) : Check
}

/**
 * The emulator reaches its host as 10.0.2.2 and has no "this phone" to
 * confuse with the server, so the loopback warning is for real devices.
 */
private val isOnDevice: Boolean = !(Build.HARDWARE == "ranchu" || Build.HARDWARE == "goldfish" || Build.PRODUCT.contains("sdk"))

@Composable
internal fun ConnectScreen(purpose: ConnectPurpose, onDone: () -> Unit) {
    val graph = LocalGraph.current
    val store = graph.store
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var portal by remember { mutableStateOf((purpose as? ConnectPurpose.Link)?.link?.portal.orEmpty()) }
    var admin by remember { mutableStateOf((purpose as? ConnectPurpose.Link)?.link?.admin.orEmpty()) }
    var plexTv by remember { mutableStateOf((purpose as? ConnectPurpose.Link)?.link?.plexTv) }
    var portalCheck by remember { mutableStateOf<Check>(Check.Idle) }
    var adminCheck by remember { mutableStateOf<Check>(Check.Idle) }
    var working by remember { mutableStateOf(false) }
    var scanError by remember { mutableStateOf<String?>(null) }
    val showPortal = (purpose as? ConnectPurpose.Add)?.role?.let { it == ServerProduct.PORTAL } ?: true
    val showAdmin = (purpose as? ConnectPurpose.Add)?.role?.let { it == ServerProduct.ADMIN } ?: true

    suspend fun probe(role: ServerProduct, text: String): Check {
        if (text.isBlank()) return Check.Idle
        if (role == ServerProduct.PORTAL) portalCheck = Check.Checking else adminCheck = Check.Checking
        return when (val r = ServerProbe().probe(text, role)) {
            is ServerCheck.Ok -> Check.Ok(r.info)
            is ServerCheck.Failed -> Check.Failed(r.failure.message(role))
        }
    }

    suspend fun probeAll(): Boolean {
        val (p, a) = coroutineScope {
            val p = async { if (showPortal) probe(ServerProduct.PORTAL, portal) else Check.Idle }
            val a = async { if (showAdmin) probe(ServerProduct.ADMIN, admin) else Check.Idle }
            p.await() to a.await()
        }
        portalCheck = p
        adminCheck = a
        // An admin answering with the portal's public address fills an empty
        // portal slot — offered, and probed like anything typed.
        val suggested = (a as? Check.Ok)?.info?.portalUrl
        if (suggested != null && portal.isBlank() && showPortal) {
            portal = suggested
            portalCheck = probe(ServerProduct.PORTAL, suggested)
        }
        return portalCheck !is Check.Failed && adminCheck !is Check.Failed
    }

    /** Slots this would point somewhere new, so the button can say so. */
    fun replacing(): List<ServerProduct> = listOf(ServerProduct.PORTAL to portal, ServerProduct.ADMIN to admin).mapNotNull { (role, text) ->
        val candidates = ServerAddress.candidates(text)
        val existing = store.current[role] ?: return@mapNotNull null
        if (candidates.isEmpty() || ServerAddress.origin(existing.baseUrl) in candidates) null else role
    }

    fun connect() {
        working = true
        scope.launch {
            try {
                if (!probeAll()) return@launch
                for ((role, check) in listOf(ServerProduct.PORTAL to portalCheck, ServerProduct.ADMIN to adminCheck)) {
                    if (check is Check.Ok) store.setServer(role, check.info.origin)
                }
                plexTv?.let(store::setPlexTvOverride)
                if (purpose is ConnectPurpose.Link) graph.links.connect = null
                onDone()
                // Already signed in somewhere: the new server gets its own
                // fresh PIN straight away rather than sitting there signed out.
                if (purpose != ConnectPurpose.Welcome && store.current.anySignedIn) {
                    val pending = store.current.rolesNeedingSession
                    if (pending.isNotEmpty()) graph.signIn.start(pending)
                }
            } finally {
                working = false
            }
        }
    }

    /** A scanned or pasted string: a connect link fills the fields, a match invite goes to the router, a bare address goes in the portal. */
    fun take(raw: String) {
        when (val link = DeepLink.parse(raw, allowPlexTvOverride = DevFlags.isDebug)) {
            is DeepLink.Connect -> {
                link.link.portal?.let { portal = it }
                link.link.admin?.let { admin = it }
                link.link.plexTv?.let { plexTv = it }
                scope.launch { probeAll() }
            }
            is DeepLink.Match -> {
                graph.links.pendingMatch = link.link
                if (purpose != ConnectPurpose.Welcome) onDone()
            }
            null -> portal = raw.trim()
        }
    }

    LaunchedEffect(purpose) { if (purpose is ConnectPurpose.Link) probeAll() }

    val title = if (purpose == ConnectPurpose.Welcome) "Welcome" else "Connect"
    TbScreen(title, nav = if (purpose == ConnectPurpose.Welcome) Nav.NONE else Nav.CLOSE, onNav = onDone, inSuite = false) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            when (purpose) {
                ConnectPurpose.Welcome -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.AutoAwesome, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(40.dp))
                    Text("Connect to your Rube", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        "Scan the code in Rube's Settings → Mobile app, or type the addresses. Most people only need the portal.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                is ConnectPurpose.Link -> Text(
                    "A link asked to connect the app to these servers. Check they're yours before continuing — the app will ask Plex to sign you in to them.",
                    Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodyMedium,
                )
                is ConnectPurpose.Add -> Unit
            }

            if (showPortal) {
                SectionHeader("Portal")
                AddressField("Portal address", portal, portalCheck, "portal-address", onChange = { portal = it; portalCheck = Check.Idle }, onGo = { connect() })
                val suggested = (adminCheck as? Check.Ok)?.info?.portalUrl
                if (suggested != null && portal.isBlank()) {
                    AssistChip(onClick = { portal = suggested }, label = { Text("Use $suggested") }, modifier = Modifier.padding(horizontal = 16.dp))
                }
                Footer(ServerProduct.PORTAL, portal, portalCheck, replacing().contains(ServerProduct.PORTAL), store.current.portal?.displayHost)
            }
            if (showAdmin) {
                SectionHeader("Admin")
                AddressField("Admin address (optional)", admin, adminCheck, "admin-address", onChange = { admin = it; adminCheck = Check.Idle }, onGo = { connect() })
                Footer(ServerProduct.ADMIN, admin, adminCheck, replacing().contains(ServerProduct.ADMIN), store.current.admin?.displayHost)
            }

            if (purpose == ConnectPurpose.Welcome) {
                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = {
                        // Google's code scanner: its own camera UI in Play
                        // services, so the app needs no camera permission.
                        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
                        GmsBarcodeScanning.getClient(context, options).startScan()
                            .addOnSuccessListener { code -> code.rawValue?.let(::take) }
                            .addOnFailureListener { scanError = "The scanner isn't available on this phone. Paste the link instead." }
                    }) {
                        Icon(Icons.Outlined.QrCodeScanner, contentDescription = null)
                        Text("Scan QR code", Modifier.padding(start = 8.dp))
                    }
                    OutlinedButton(onClick = {
                        val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
                        clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()?.let(::take)
                    }) {
                        Icon(Icons.Outlined.ContentPaste, contentDescription = null)
                        Text("Paste", Modifier.padding(start = 8.dp))
                    }
                }
                scanError?.let { Text(it, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error) }
            }

            Button(
                onClick = { connect() },
                enabled = !working && (portal.isNotBlank() || admin.isNotBlank()),
                modifier = Modifier.fillMaxWidth().padding(16.dp).testTag("connect"),
            ) {
                if (working) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                else Text(if (replacing().isEmpty()) "Continue" else "Replace and continue")
            }
        }
    }
}

@Composable
private fun AddressField(label: String, value: String, check: Check, tag: String, onChange: (String) -> Unit, onGo: () -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false, imeAction = ImeAction.Go),
        keyboardActions = KeyboardActions(onGo = { onGo() }),
        trailingIcon = {
            when (check) {
                Check.Idle -> Unit
                Check.Checking -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                is Check.Ok -> Icon(Icons.Outlined.CheckCircle, contentDescription = "Reachable", tint = Tones.success)
                is Check.Failed -> Icon(Icons.Outlined.Error, contentDescription = "Problem", tint = MaterialTheme.colorScheme.error)
            }
        },
        isError = check is Check.Failed,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).testTag(tag),
    )
}

@Composable
private fun Footer(role: ServerProduct, text: String, check: Check, replaces: Boolean, existingHost: String?) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        val small = MaterialTheme.typography.bodySmall
        when (check) {
            is Check.Failed -> Text(check.message, style = small, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("${role.raw}-problem"))
            is Check.Ok -> {
                Text("Rube ${check.info.version}${if (check.info.authRequired == false) " · admin sign-in is off" else ""}", style = small)
                if (ServerAddress.isUnencryptedRemote(check.info.origin)) {
                    IconLine(Icons.Outlined.LockOpen, "Not encrypted — this address uses plain HTTP over the internet.", Tones.warning)
                }
            }
            else -> Text(
                if (role == ServerProduct.PORTAL) "The address people use for the portal, like 192.168.1.10:3100."
                else "Only if you administer this server — Settings → Mobile app shows it.",
                style = small,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (isOnDevice && ServerAddress.candidates(text).firstOrNull()?.let(ServerAddress::isLoopback) == true) {
            IconLine(Icons.Outlined.Warning, "That address is this phone itself, not your server. Use the server's network address instead.", Tones.warning)
        }
        if (replaces && existingHost != null) Text("This replaces $existingHost and signs you out of it.", style = small, color = Tones.warning)
    }
}

@Composable
private fun IconLine(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, color: Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
        Text(text, style = MaterialTheme.typography.bodySmall, color = color)
    }
}
