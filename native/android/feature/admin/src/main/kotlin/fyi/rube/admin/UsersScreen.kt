// The people the server shares with: who watches most, what they've been
// watching, what they're watching right now — with the one action that can't
// wait for a laptop, stopping a stream.
package fyi.rube.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fyi.rube.api.ApiError
import fyi.rube.api.Durations
import fyi.rube.model.Admin
import fyi.rube.model.AdminApi
import fyi.rube.model.PlexSession
import fyi.rube.model.UserSummary
import fyi.rube.platform.ui.ActionErrorDialog
import fyi.rube.platform.ui.Avatar
import fyi.rube.platform.ui.ConfirmDialog
import fyi.rube.platform.ui.ErrorState
import fyi.rube.platform.ui.Format
import fyi.rube.platform.ui.LabeledRow
import fyi.rube.platform.ui.LoadState
import fyi.rube.platform.ui.LoadStateView
import fyi.rube.platform.ui.Nav
import fyi.rube.platform.ui.Notice
import fyi.rube.platform.ui.PartMenu
import fyi.rube.platform.ui.Poll
import fyi.rube.platform.ui.SectionHeader
import fyi.rube.platform.ui.SwipeAction
import fyi.rube.platform.ui.SwipeActionsRow
import fyi.rube.platform.ui.TbScreen
import fyi.rube.platform.ui.clickableRow
import fyi.rube.platform.ui.next
import fyi.rube.platform.ui.rememberActionError
import fyi.rube.platform.ui.rememberHaptics
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

private const val PAGE = 50L

@Composable
internal fun UsersScreen() {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val haptics = rememberHaptics()
    val error = rememberActionError()
    var search by rememberSaveable { mutableStateOf("") }
    var top by remember { mutableStateOf(emptyList<Admin.StatsTopUsersItem>()) }
    var playback by remember { mutableStateOf(emptyMap<Long, Admin.StatsAllUserPlaybackItem>()) }
    var syncNotice by remember { mutableStateOf<String?>(null) }
    val paged = remember {
        Paged<UserSummary> { offset, q ->
            val page = model.client.call(AdminApi.usersList, Admin.UsersListInput(offset = offset, limit = PAGE, search = q))
            page.items to page.total
        }
    }
    val list = rememberLazyListState()
    val c = model.client

    LaunchedEffect(search) {
        if (search.isNotEmpty()) delay(300)
        paged.reload(search)
    }
    LaunchedEffect(Unit) {
        top = quietly(top) { c.call(AdminApi.statsTopUsers, Admin.StatsTopUsersInput(periodDays = 30, limit = 5)) }
        playback = quietly(emptyList()) { c.call(AdminApi.statsAllUserPlayback, Admin.StatsAllUserPlaybackInput(periodDays = 30)) }.associateBy { it.userId }
    }
    LaunchedEffect(list) {
        snapshotFlow { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .filter { paged.items.isNotEmpty() && it >= paged.items.size - 5 }
            .collect { paged.more(search) }
    }

    TbScreen(
        "Users",
        onRefresh = { paged.reload(search) },
        actions = {
            IconButton(onClick = {
                model.scope.launch {
                    try {
                        val r = c.call(AdminApi.usersSync)
                        haptics.confirm()
                        syncNotice = "Synced ${r.synced.toLong()} users from Plex${if (r.removed > 0) ", removed ${r.removed.toLong()}" else ""}."
                        paged.reload(search)
                    } catch (e: ApiError) {
                        error.value = e
                    }
                }
            }) { Icon(Icons.Outlined.Sync, contentDescription = "Sync users") }
            PartMenu()
        },
    ) {
        LazyColumn(Modifier.fillMaxSize(), state = list) {
            item { SearchField(search, "Search users") { search = it } }
            syncNotice?.let { item { Notice(it, Icons.Outlined.Info) } }
            paged.error?.takeIf { paged.items.isEmpty() }?.let { e -> item { ErrorState(e, onRetry = { model.scope.launch { paged.reload(search) } }) } }
            if (search.isBlank() && top.isNotEmpty()) {
                item { SectionHeader("Most watching · 30 days") }
                items(top.take(5), key = { "t-${it.userId}" }) { u ->
                    LabeledRow(u.name, "${u.plays} plays · ${Durations.short(u.watchedMs)}", onClick = { nav.go(UserRoute(u.userId, u.name)) })
                }
            }
            item { SectionHeader(paged.total?.let { "$it users" } ?: "Users") }
            items(paged.items, key = { "u-${it.userId}" }) { user ->
                UserRow(user, playback[user.userId], Modifier.clickableRow { nav.go(UserRoute(user.userId, user.username)) })
            }
            if (paged.loading) item { CircularProgressIndicator(Modifier.padding(24.dp)) }
        }
    }
    ActionErrorDialog(error)
}

@Composable
private fun UserRow(user: UserSummary, playback: Admin.StatsAllUserPlaybackItem?, modifier: Modifier) {
    val detail = buildList {
        if (playback != null && playback.plays > 0) add("${playback.plays} plays · ${Durations.short(playback.watchedMs)}")
        user.lastWatchedTitle?.let { add(it) }
        if (!user.accepted) add("Invite pending")
        if (isEmpty()) add(if (user.optedIn) "Personalized" else "Not personalized")
    }.joinToString(" · ")
    ListItem(
        leadingContent = { Avatar(user.thumb, user.username) },
        headlineContent = {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(user.username)
                if (user.isOwner) Text("Owner", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                if (user.isProtected) Icon(Icons.Outlined.Shield, contentDescription = "Protected", modifier = Modifier.padding(top = 2.dp))
            }
        },
        supportingContent = { Text(detail, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        modifier = modifier,
    )
}

@Composable
internal fun UserDetailScreen(userId: Long, name: String) {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val haptics = rememberHaptics()
    val error = rememberActionError()
    var user by remember { mutableStateOf<LoadState<Admin.UsersGetOutput>>(LoadState.Loading) }
    var playback by remember { mutableStateOf<Admin.StatsUserPlaybackOutput?>(null) }
    var sessions by remember { mutableStateOf(emptyList<PlexSession>()) }
    var history by remember { mutableStateOf(emptyList<Admin.UsersHistoryItem>()) }
    var stopping by remember { mutableStateOf<PlexSession?>(null) }
    val c = model.client
    val id = userId.toDouble()

    suspend fun load() {
        user = user.next { c.call(AdminApi.usersGet, Admin.UsersGetInput(id)) }
        playback = quietly(playback) { c.call(AdminApi.statsUserPlayback, Admin.StatsUserPlaybackInput(id, periodDays = 30)) }
        history = quietly(history) { c.call(AdminApi.usersHistory, Admin.UsersHistoryInput(id, limit = 30)) }
    }

    LaunchedEffect(userId) { load() }
    Poll(10_000, key = userId) { sessions = quietly(sessions) { c.call(AdminApi.usersSessions, Admin.UsersSessionsInput(id)) } }

    TbScreen(name, nav = Nav.BACK, onNav = { nav.back() }, onRefresh = { load() }) {
        LoadStateView(user, onRetry = { model.scope.launch { load() } }) { detail ->
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Avatar(detail.user.thumb, detail.user.username, size = 56.dp)
                        Column {
                            Text(detail.user.username, style = MaterialTheme.typography.titleLarge)
                            detail.user.email?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                    LabeledRow("Personalization", detail.personalization.status.replaceFirstChar { it.uppercase() })
                    LabeledRow("Collections", Format.count(detail.user.collectionCount))
                    playback?.let { LabeledRow("Last 30 days", "${it.plays} plays · ${Durations.short(it.watchedMs)}") }
                    if (detail.sections.isNotEmpty()) LabeledRow("Libraries", detail.sections.joinToString(", ") { it.title })
                }
                if (sessions.isNotEmpty()) {
                    item { SectionHeader("Watching now") }
                    items(sessions, key = { it.sessionId ?: it.sessionKey ?: it.title }) { s ->
                        SwipeActionsRow(
                            end = if (s.sessionId != null) {
                                SwipeAction("Stop", Icons.Outlined.StopCircle, MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer) { stopping = s }
                            } else null,
                        ) { SessionRow(s, Modifier.clickableRow { if (s.sessionId != null) stopping = s }) }
                    }
                }
                item { SectionHeader("History") }
                if (history.isEmpty()) item { Text("Nothing watched yet.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                itemsIndexed(history) { _, h ->
                    ListItem(
                        headlineContent = { Text(h.grandparentTitle?.let { "$it — ${h.title}" } ?: h.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        // Plex reports seconds here and Rube milliseconds elsewhere; anything this small is seconds.
                        supportingContent = h.viewedAt?.let { at -> { Text(Format.relative(if (at > 10_000_000_000) at else at * 1000)) } },
                        modifier = Modifier.clickableRow { nav.go(MediaRoute(h.grandparentRatingKey ?: h.ratingKey, h.grandparentTitle ?: h.title)) },
                    )
                }
                item { WebAdminRow("/users/$userId") }
            }
        }
    }

    stopping?.let { s ->
        ConfirmDialog(
            "Stop $name's playback?",
            "“${s.grandparentTitle ?: s.title}” stops on ${s.player}.",
            "Stop playback",
            onConfirm = {
                model.scope.launch {
                    try {
                        c.call(AdminApi.usersTerminateSession, Admin.UsersTerminateSessionInput(s.sessionId ?: return@launch))
                        haptics.confirm()
                        sessions = sessions.filter { it.sessionId != s.sessionId }
                    } catch (e: ApiError) {
                        error.value = e
                    }
                }
            },
            onDismiss = { stopping = null },
        )
    }
    ActionErrorDialog(error)
}
