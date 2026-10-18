// Signed in nowhere yet: one button, branded by the portal when there is one.
package dev.tinkerbell.app

import android.graphics.Color.parseColor
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.RocketLaunch
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.TheaterComedy
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material.icons.filled.WorkspacePremium
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import dev.tinkerbell.api.ApiError
import dev.tinkerbell.api.DataUrl
import dev.tinkerbell.api.PortalUrls
import dev.tinkerbell.api.ServerProduct
import dev.tinkerbell.model.Portal
import dev.tinkerbell.model.PortalApi
import dev.tinkerbell.platform.ui.ConfirmDialog
import dev.tinkerbell.platform.ui.Tones

@Composable
internal fun SignInScreen() {
    val graph = LocalGraph.current
    val store = graph.store
    val phase by graph.signIn.phase.collectAsStateWithLifecycle()
    val messages by graph.signIn.messages.collectAsStateWithLifecycle()
    val connections by store.state.collectAsStateWithLifecycle()
    var branding by remember { mutableStateOf<Portal.BrandingOutput?>(null) }
    var menu by remember { mutableStateOf(false) }
    var confirmForget by remember { mutableStateOf(false) }

    LaunchedEffect(connections.portal?.baseUrl) {
        val client = store.client(ServerProduct.PORTAL) ?: return@LaunchedEffect
        branding = try {
            client.call(PortalApi.branding)
        } catch (e: ApiError) {
            null
        }
    }
    val background: Any? = branding?.backgroundImage?.trim()?.takeIf { it.isNotEmpty() }?.let { raw ->
        when {
            raw.startsWith("data:") -> DataUrl.decode(raw)
            raw.startsWith("http://") || raw.startsWith("https://") -> raw
            else -> connections.portal?.let { PortalUrls.poster(it.baseUrl, raw) }
        }
    }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        if (background != null) {
            AsyncImage(model = background, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)))
        }
        Column(
            Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = "Servers") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(
                            text = { Text("Use different servers") },
                            leadingIcon = { Icon(Icons.Outlined.Dns, contentDescription = null) },
                            onClick = { menu = false; confirmForget = true },
                        )
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            Icon(
                brandIcon(branding?.icon),
                contentDescription = null,
                tint = branding?.iconColor?.let(::hexColor) ?: MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(64.dp),
            )
            Text(branding?.title?.trim()?.ifEmpty { null } ?: "Tinkerbell", style = MaterialTheme.typography.displaySmall, textAlign = TextAlign.Center)
            Text(
                "Sign in with your Plex account to personalize your home screen.",
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.weight(1f))
            Button(
                onClick = { graph.signIn.start() },
                enabled = phase == SignInCoordinator.Phase.IDLE,
                modifier = Modifier.fillMaxWidth().testTag("sign-in"),
            ) {
                Text(
                    when (phase) {
                        SignInCoordinator.Phase.IDLE -> "Sign in with Plex"
                        SignInCoordinator.Phase.WAITING_FOR_PLEX -> "Waiting for Plex…"
                        SignInCoordinator.Phase.FINISHING -> "Finishing sign-in…"
                    },
                )
            }
            Text("Tinkerbell never sees your Plex password.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            for (message in messages) {
                Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (role in ServerProduct.entries) {
                    val c = connections[role] ?: continue
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            if (c.isUnencryptedRemote) Icons.Outlined.LockOpen else Icons.Outlined.Dns,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = if (c.isUnencryptedRemote) Tones.warning else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "${role.label}: ${c.displayHost}",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (c.isUnencryptedRemote) Tones.warning else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }

    if (confirmForget) {
        ConfirmDialog(
            "Forget these servers?",
            "You'll connect the app to its servers again from the start.",
            "Forget servers",
            onConfirm = {
                store.remove(ServerProduct.PORTAL)
                store.remove(ServerProduct.ADMIN)
            },
            onDismiss = { confirmForget = false },
        )
    }
}

/** The branding colour the admin typed: `#e5a00d` or `e5a00d`. */
private fun hexColor(raw: String): Color? {
    val s = raw.trim().removePrefix("#")
    if (s.length != 6) return null
    return try {
        Color(parseColor("#$s"))
    } catch (e: IllegalArgumentException) {
        null
    }
}

/** The portal's icon names are lucide's; these are the nearest Material symbols. */
private fun brandIcon(name: String?): ImageVector = when (name) {
    "Star" -> Icons.Filled.Star
    "Heart" -> Icons.Filled.Favorite
    "Film" -> Icons.Filled.Movie
    "Tv" -> Icons.Filled.Tv
    "Video" -> Icons.Filled.Videocam
    "Music" -> Icons.Filled.MusicNote
    "Flame" -> Icons.Filled.LocalFireDepartment
    "Ghost" -> Icons.Filled.TheaterComedy
    "Rocket" -> Icons.Filled.RocketLaunch
    "Compass" -> Icons.Filled.Explore
    "Sun" -> Icons.Filled.WbSunny
    "Moon" -> Icons.Filled.DarkMode
    "Zap" -> Icons.Filled.Bolt
    "Bookmark" -> Icons.Filled.Bookmark
    "Award" -> Icons.Filled.WorkspacePremium
    "Bell" -> Icons.Filled.Notifications
    "Camera" -> Icons.Filled.CameraAlt
    "Tag" -> Icons.Filled.Sell
    "Play" -> Icons.Filled.PlayArrow
    else -> Icons.Filled.AutoAwesome
}
