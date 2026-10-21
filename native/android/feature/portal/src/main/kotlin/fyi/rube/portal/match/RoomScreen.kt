// One room: the deck, the matches, and who's here. From
// `apps/portal/src/match/Room.tsx`.
//
// Polls `match.state` every three seconds while the room is on screen — the
// web's interval; the server deliberately has no socket for this — and turns
// what changed between polls into the two things worth interrupting someone
// for: a person arriving, and a match. The first poll is what was already
// there, so opening a room with old matches doesn't celebrate them again.
@file:OptIn(ExperimentalMaterial3Api::class)

package fyi.rube.portal.match

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.MeetingRoom
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import fyi.rube.api.ApiError
import fyi.rube.api.MatchText
import fyi.rube.api.PortalUrls
import fyi.rube.api.TrpcClient
import fyi.rube.model.Portal
import fyi.rube.model.PortalApi
import fyi.rube.platform.Links
import fyi.rube.platform.ui.ActionErrorDialog
import fyi.rube.platform.ui.EmptyState
import fyi.rube.platform.ui.ErrorState
import fyi.rube.platform.ui.LoadState
import fyi.rube.platform.ui.Nav
import fyi.rube.platform.ui.Poll
import fyi.rube.platform.ui.RemoteImage
import fyi.rube.platform.ui.TbScreen
import fyi.rube.platform.ui.next
import fyi.rube.platform.ui.rememberActionError
import fyi.rube.platform.ui.rememberHaptics
import fyi.rube.portal.LocalPortal
import kotlinx.coroutines.launch

/**
 * Who's asking, and where posters live. A guest's client carries their room
 * token instead of a session; posters are signed paths on the portal either way.
 */
class RoomContext(val client: TrpcClient, val posterBase: String, val isGuest: Boolean) {
    fun poster(path: String?): String? = PortalUrls.poster(posterBase, path)
}

internal typealias RoomState = Portal.MatchStateOutput
internal typealias MatchFilm = Portal.MatchStateOutput.Match

private const val POLL_MS = 3_000L

/**
 * Joins before showing the room. Joining is idempotent, so opening a room
 * you're already in costs one cheap call, and a link from someone else (with
 * or without its secret) lands you in it.
 */
@Composable
fun JoinedRoomScreen(code: String, invite: String?, onLeft: () -> Unit) {
    val model = LocalPortal.current
    var joined by remember { mutableStateOf<LoadState<Boolean>>(LoadState.Loading) }
    androidx.compose.runtime.LaunchedEffect(code) {
        joined = joined.next {
            model.client.call(PortalApi.matchJoin, Portal.MatchJoinInput(code, invite))
            true
        }
    }
    when (val j = joined) {
        LoadState.Loading -> TbScreen("Room $code", nav = Nav.BACK, onNav = onLeft) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
        is LoadState.Failed -> TbScreen("Room $code", nav = Nav.BACK, onNav = onLeft) {
            EmptyState(Icons.Outlined.MeetingRoom, "Couldn't open that room", j.error.message, actionLabel = "Back to Movie Match", onAction = onLeft)
        }
        is LoadState.Loaded -> RoomScreen(RoomContext(model.client, model.baseUrl, isGuest = false), code, nav = Nav.BACK, onNav = onLeft, onLeft = onLeft)
    }
}

@Composable
fun RoomScreen(room: RoomContext, code: String, nav: Nav, onNav: () -> Unit, onLeft: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val snackbar = remember { SnackbarHostState() }
    val error = rememberActionError()
    var state by remember { mutableStateOf<LoadState<RoomState>>(LoadState.Loading) }
    var pane by remember { mutableIntStateOf(0) }
    var matched by remember { mutableStateOf<MatchFilm?>(null) }
    var seenMembers by remember { mutableStateOf<Set<Long>?>(null) }
    var seenMatches by remember { mutableStateOf<Set<String>?>(null) }
    var pendingMatch by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    var confirmReset by remember { mutableStateOf(false) }
    // Bumped by "Start over": the deck is rebuilt from scratch rather than
    // patched, so no card dealt before the reset can survive it.
    var deckGeneration by remember { mutableIntStateOf(0) }

    suspend fun poll() {
        val next = state.next { room.client.call(PortalApi.matchState, Portal.MatchStateInput(code)) }
        state = next
        val s = (next as? LoadState.Loaded)?.value ?: return
        val seen = seenMembers
        if (seen != null) {
            s.members.firstOrNull { it.id !in seen && !it.me }?.let { fresh ->
                scope.launch { snackbar.showSnackbar("${fresh.name} joined") }
            }
        }
        seenMembers = s.members.map { it.id }.toSet()
        val unanimous = s.matches.filter { it.unanimous }
        val seenM = seenMatches
        if (seenM != null) {
            unanimous.firstOrNull { it.ratingKey !in seenM || it.ratingKey == pendingMatch }?.let {
                matched = it
                haptics.confirm()
            }
        }
        pendingMatch = null
        seenMatches = unanimous.map { it.ratingKey }.toSet()
    }

    Poll(POLL_MS, key = code) { poll() }

    val loaded = (state as? LoadState.Loaded)?.value
    TbScreen(
        title = "Room $code",
        subtitle = loaded?.let { s ->
            (listOf("${s.members.count { it.online }}/${s.members.size} here", s.library) + MatchText.pills(s.filters)).joinToString(" · ")
        },
        nav = nav,
        onNav = onNav,
        snackbar = snackbar,
        inSuite = !room.isGuest,
        actions = {
            if (loaded != null) {
                IconButton(onClick = {
                    Links.share(context, "Help pick a film — join room ${loaded.code}: ${loaded.link}", subject = "Movie night")
                }) { Icon(Icons.Outlined.PersonAdd, contentDescription = "Invite") }
                IconButton(onClick = { menu = true }, modifier = Modifier.testTag("room-options")) {
                    Icon(Icons.Outlined.MoreVert, contentDescription = "Room options")
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("Start over") },
                        leadingIcon = { Icon(Icons.Outlined.RestartAlt, contentDescription = null) },
                        onClick = { menu = false; confirmReset = true },
                        modifier = Modifier.testTag("menu-start-over"),
                    )
                    DropdownMenuItem(
                        text = { Text("Leave room") },
                        leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null) },
                        onClick = { menu = false; confirmLeave = true },
                        modifier = Modifier.testTag("menu-leave"),
                    )
                }
            }
        },
    ) { padding ->
        when (val s = state) {
            LoadState.Loading -> androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            is LoadState.Failed ->
                if (s.error is ApiError.NotFound || s.error is ApiError.Forbidden) {
                    EmptyState(Icons.Outlined.MeetingRoom, "This room isn't available", s.error.message, Modifier.padding(padding), actionLabel = "OK", onAction = onLeft)
                } else {
                    ErrorState(s.error, onRetry = { scope.launch { poll() } }, modifier = Modifier.padding(padding))
                }
            is LoadState.Loaded -> Column(Modifier.fillMaxSize().padding(padding)) {
                PrimaryTabRow(selectedTabIndex = pane) {
                    Tab(selected = pane == 0, onClick = { pane = 0 }, text = { Text("Swipe") })
                    Tab(
                        selected = pane == 1,
                        onClick = { pane = 1 },
                        text = { Text(if (s.value.matches.isEmpty()) "Matches" else "Matches · ${s.value.matches.size}") },
                        modifier = Modifier.testTag("tab-matches"),
                    )
                }
                if (pane == 0) {
                    androidx.compose.runtime.key(deckGeneration) {
                        SwipeDeck(
                            room = room,
                            code = code,
                            roomState = s.value,
                            onMatched = { pendingMatch = it },
                            refresh = { poll() },
                            startOver = { confirmReset = true },
                        )
                    }
                } else {
                    MatchesList(room, code, s.value) { poll() }
                }
            }
        }
    }

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Start over?") },
            text = { Text("Your swipes in this room are cleared and the deck deals again from the top. Everyone else's stay.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmReset = false
                        scope.launch {
                            try {
                                room.client.call(PortalApi.matchReset, Portal.MatchResetInput(code))
                                deckGeneration += 1
                                pane = 0
                                poll()
                            } catch (e: ApiError) {
                                error.value = e
                            }
                        }
                    },
                    modifier = Modifier.testTag("confirm-start-over"),
                ) { Text("Start over") }
            },
            dismissButton = { TextButton(onClick = { confirmReset = false }) { Text("Cancel") } },
        )
    }
    if (confirmLeave) {
        AlertDialog(
            onDismissRequest = { confirmLeave = false },
            title = { Text("Leave room $code?") },
            text = { Text(if (room.isGuest) "You'll need the invite link to come back." else "Your swipes stay in the room for the others.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmLeave = false
                        scope.launch {
                            try {
                                room.client.call(PortalApi.matchLeave, Portal.MatchLeaveInput(code))
                                onLeft()
                            } catch (e: ApiError) {
                                error.value = e
                            }
                        }
                    },
                    modifier = Modifier.testTag("confirm-leave"),
                ) { Text("Leave room", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmLeave = false }) { Text("Cancel") } },
        )
    }
    matched?.let { film ->
        ItsAMatchSheet(
            film = film,
            poster = room.poster(film.poster),
            onSeeMatches = {
                matched = null
                pane = 1
            },
            onDismiss = { matched = null },
        )
    }
    ActionErrorDialog(error)
}

@Composable
private fun ItsAMatchSheet(film: MatchFilm, poster: String?, onSeeMatches: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().padding(24.dp).testTag("its-a-match"),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("It's a match", style = MaterialTheme.typography.displaySmall)
            Text("Everyone wants to watch this", color = MaterialTheme.colorScheme.onSurfaceVariant)
            RemoteImage(poster, Modifier.heightIn(max = 340.dp).aspectRatio(2f / 3f), corner = 16.dp)
            Text(film.title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Button(onClick = onSeeMatches, modifier = Modifier.fillMaxWidth().testTag("see-matches")) { Text("See matches") }
            OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth().testTag("keep-swiping")) { Text("Keep swiping") }
        }
    }
}
