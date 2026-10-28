// Joining a room as a guest: someone who opened an invite with no session on
// that server — most likely with no account there at all. They get the room
// and nothing else: a name, and a token for this one room, kept in the sealed
// store per server and room so reopening the link goes straight back in.
// From `apps/portal/src/match/GuestMatch.tsx`.
package fyi.rube.portal.match

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ExitToApp
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.LocalMovies
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import fyi.rube.api.ApiError
import fyi.rube.api.Credential
import fyi.rube.api.MatchLink
import fyi.rube.api.MatchText
import fyi.rube.api.TrpcClient
import fyi.rube.model.MatchRoomSummary
import fyi.rube.model.Portal
import fyi.rube.model.PortalApi
import fyi.rube.platform.ui.ActionErrorDialog
import fyi.rube.platform.ui.EmptyState
import fyi.rube.platform.ui.ErrorState
import fyi.rube.platform.ui.LoadState
import fyi.rube.platform.ui.Nav
import fyi.rube.platform.ui.TbScreen
import fyi.rube.platform.ui.next
import fyi.rube.platform.ui.rememberActionError
import kotlinx.coroutines.launch

/** Where a guest's room token lives: the shell's sealed store, per server and room. */
interface GuestTokens {
    fun get(server: String, code: String): String?
    fun set(token: String?, server: String, code: String)
}

@Composable
fun GuestMatchScreen(
    link: MatchLink,
    tokens: GuestTokens,
    onClose: () -> Unit,
    /** Offered when the person might have an account on that server after all. */
    onSignIn: (() -> Unit)?,
) {
    val client = remember(link.server) { TrpcClient(link.server) }
    val scope = rememberCoroutineScope()
    val error = rememberActionError()
    var token by remember { mutableStateOf(tokens.get(link.server, link.code)) }
    var left by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<LoadState<MatchRoomSummary>>(LoadState.Loading) }
    var name by remember { mutableStateOf("") }
    var joining by remember { mutableStateOf(false) }

    val current = token
    if (current != null && !left) {
        RoomScreen(
            room = RoomContext(client.with(Credential.MatchGuest(current)), link.server, isGuest = true),
            code = link.code,
            nav = Nav.CLOSE,
            onNav = onClose,
            onLeft = {
                tokens.set(null, link.server, link.code)
                token = null
                left = true
            },
        )
        return
    }

    val invite = link.invite
    suspend fun loadPreview() {
        if (invite != null) preview = preview.next { client.call(PortalApi.matchGuestPreview, Portal.MatchGuestPreviewInput(link.code, invite)) }
    }
    fun join() {
        val trimmed = name.trim()
        if (trimmed.isEmpty() || invite == null) return
        joining = true
        scope.launch {
            try {
                val joined = client.call(PortalApi.matchGuestJoin, Portal.MatchGuestJoinInput(link.code, invite, trimmed))
                tokens.set(joined.token, link.server, link.code)
                token = joined.token
            } catch (e: ApiError) {
                error.value = e
            } finally {
                joining = false
            }
        }
    }
    LaunchedEffect(link) { loadPreview() }

    TbScreen("Movie Night", nav = Nav.CLOSE, onNav = onClose, inSuite = false) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                left -> EmptyState(Icons.AutoMirrored.Outlined.ExitToApp, "You've left the room.", "Open the invite link again to rejoin.")
                invite == null -> EmptyState(
                    Icons.Outlined.LocalMovies,
                    "Room ${link.code}",
                    "To join, open the invite link whoever made it sent you — or sign in if you're on this server.",
                    actionLabel = onSignIn?.let { "Sign in with Plex" },
                    onAction = onSignIn,
                )
                else -> when (val p = preview) {
                    LoadState.Loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    is LoadState.Failed ->
                        if (p.error is ApiError.NotFound) {
                            EmptyState(
                                Icons.Outlined.LinkOff,
                                "This invite doesn't work any more",
                                "The room has closed, or the link is incomplete. Ask whoever sent it for a new one.",
                            )
                        } else {
                            ErrorState(p.error, onRetry = { scope.launch { loadPreview() } })
                        }
                    is LoadState.Loaded -> Column(
                        // Scrolls, so the keyboard (already padded for by the full-screen frame)
                        // shortens the form rather than clipping the button off.
                        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        val room = p.value
                        val pills = MatchText.pills(room.filters)
                        Text(
                            "${room.members.joinToString(", ")} ${if (room.members.size == 1) "is" else "are"} picking a film from ${room.library}" +
                                (if (pills.isEmpty()) "" else " (${pills.joinToString(", ")})") +
                                ". Join them: swipe right on what you'd watch, left on what you wouldn't.",
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.testTag("guest-preview"),
                        )
                        OutlinedTextField(
                            value = name,
                            onValueChange = { name = it.take(40) },
                            label = { Text("Your name") },
                            supportingText = { Text("What the others will see. No account needed.") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Go),
                            keyboardActions = KeyboardActions(onGo = { join() }),
                            modifier = Modifier.fillMaxWidth().testTag("guest-name"),
                        )
                        Button(
                            onClick = { join() },
                            enabled = name.isNotBlank() && !joining,
                            modifier = Modifier.fillMaxWidth().testTag("guest-join"),
                        ) { Text("Join room ${link.code}") }
                        if (onSignIn != null) {
                            TextButton(onClick = onSignIn, modifier = Modifier.fillMaxWidth()) { Text("On this Plex server? Sign in instead") }
                        }
                    }
                }
            }
        }
    }
    ActionErrorDialog(error)
}
