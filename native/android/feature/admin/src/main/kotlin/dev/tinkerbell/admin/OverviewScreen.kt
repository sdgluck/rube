// The admin's first screen: what's playing, whether anything is broken, and
// how the library and the jobs are doing — the questions you open an admin
// app on your phone to answer. Now playing polls; the rest refreshes on pull.
@file:OptIn(ExperimentalMaterial3Api::class)

package dev.tinkerbell.admin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.HeartBroken
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.tinkerbell.api.ApiError
import dev.tinkerbell.api.Durations
import dev.tinkerbell.model.Admin
import dev.tinkerbell.model.AdminApi
import dev.tinkerbell.model.PlexSession
import dev.tinkerbell.platform.ui.ActionErrorDialog
import dev.tinkerbell.platform.ui.ConfirmDialog
import dev.tinkerbell.platform.ui.ErrorState
import dev.tinkerbell.platform.ui.Format
import dev.tinkerbell.platform.ui.LabeledRow
import dev.tinkerbell.platform.ui.LoadState
import dev.tinkerbell.platform.ui.Notice
import dev.tinkerbell.platform.ui.PartMenu
import dev.tinkerbell.platform.ui.Poll
import dev.tinkerbell.platform.ui.RemoteImage
import dev.tinkerbell.platform.ui.SectionHeader
import dev.tinkerbell.platform.ui.TbScreen
import dev.tinkerbell.platform.ui.Tone
import dev.tinkerbell.platform.ui.Tones
import dev.tinkerbell.platform.ui.clickableRow
import dev.tinkerbell.platform.ui.error
import dev.tinkerbell.platform.ui.next
import dev.tinkerbell.platform.ui.rememberActionError
import dev.tinkerbell.platform.ui.rememberHaptics
import dev.tinkerbell.platform.ui.value
import kotlinx.coroutines.launch

internal suspend fun <T> quietly(fallback: T, block: suspend () -> T): T = try {
    block()
} catch (e: ApiError) {
    fallback
}

@Composable
internal fun OverviewScreen() {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    var sessions by remember { mutableStateOf(emptyList<PlexSession>()) }
    var overview by remember { mutableStateOf<LoadState<Admin.StatsOverviewOutput>>(LoadState.Loading) }
    var activity by remember { mutableStateOf<Admin.StatsActivityOutput?>(null) }
    var ops by remember { mutableStateOf<Admin.StatsOpsOutput?>(null) }
    var problems by remember { mutableStateOf<Admin.ProblemsListOutput?>(null) }
    var health by remember { mutableStateOf(emptyList<Admin.HealthStatusItem>()) }
    var recent by remember { mutableStateOf<Admin.StatsRecentlyAddedOutput?>(null) }
    var selected by remember { mutableStateOf<PlexSession?>(null) }
    val c = model.client

    suspend fun load() {
        overview = overview.next { c.call(AdminApi.statsOverview) }
        activity = quietly(activity) { c.call(AdminApi.statsActivity) }
        ops = quietly(ops) { c.call(AdminApi.statsOps) }
        problems = quietly(problems) { c.call(AdminApi.problemsList) }
        health = quietly(health) { c.call(AdminApi.healthStatus) }
        recent = quietly(recent) { c.call(AdminApi.statsRecentlyAdded) }
        model.refreshMetrics()
    }

    LaunchedEffect(Unit) { load() }
    // Now playing moves; the web dashboard polls it every few seconds too.
    Poll(10_000) { sessions = quietly(sessions) { c.call(AdminApi.statsSessions) } }

    TbScreen("Overview", actions = { PartMenu() }, onRefresh = { load() }) {
        LazyColumn(Modifier.fillMaxSize().testTag("overview")) {
            if (model.openAuth) {
                item {
                    Notice("Admin sign-in is off on this server — anyone who can reach it can administer it.", Icons.Outlined.LockOpen, Tone.DANGER)
                }
            }
            item { SectionHeader("Now playing") }
            if (sessions.isEmpty()) {
                item { Text("Nothing is playing.", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            items(sessions, key = { it.sessionId ?: it.sessionKey ?: "${it.user}-${it.title}" }) { session ->
                SessionRow(session, Modifier.clickableRow { selected = session })
            }

            item {
                val open = problems?.problems?.filter { !it.dismissed }.orEmpty()
                val unhealthy = health.filter { it.configured && it.status == "error" }
                SectionHeader("Attention")
                ListItem(
                    headlineContent = { Text("Problems") },
                    leadingContent = {
                        Icon(
                            if (open.isEmpty()) Icons.Outlined.Verified else Icons.Outlined.Warning,
                            contentDescription = null,
                            tint = if (open.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else Tones.warning,
                        )
                    },
                    trailingContent = { Text(if (open.isEmpty()) "None" else "${open.size}") },
                    modifier = Modifier.clickableRow { nav.go(ProblemsRoute) },
                )
                ListItem(
                    headlineContent = { Text("Health") },
                    leadingContent = {
                        Icon(
                            if (unhealthy.isEmpty()) Icons.Outlined.Favorite else Icons.Outlined.HeartBroken,
                            contentDescription = null,
                            tint = if (unhealthy.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                        )
                    },
                    trailingContent = { Text(if (unhealthy.isEmpty()) "All good" else unhealthy.joinToString(", ") { it.service }, maxLines = 1) },
                    modifier = Modifier.clickableRow { nav.go(HealthRoute) },
                )
            }

            overview.error?.let { e -> item { ErrorState(e, onRetry = { model.scope.launch { load() } }) } }

            recent?.items?.takeIf { it.isNotEmpty() }?.let { items ->
                item {
                    SectionHeader("Recently added")
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(items, key = { it.ratingKey }) { item ->
                            Column(Modifier.width(100.dp).clickable { nav.go(MediaRoute(item.ratingKey, item.title)) }) {
                                RemoteImage(model.image(item.thumb), Modifier.size(width = 100.dp, height = 150.dp))
                                Text(item.grandparentTitle ?: item.title, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(Format.relative(item.addedAt), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }

            overview.value?.let { o ->
                item {
                    SectionHeader("Library")
                    LabeledRow("Items", Format.count(o.totalItems))
                    LabeledRow("Movies", Format.count(o.movieCount))
                    LabeledRow("Shows", "${Format.count(o.showCount)} · ${Format.count(o.episodeCount)} episodes")
                    LabeledRow("4K", Format.count(o.count4k))
                    LabeledRow("Added this week", Format.count(o.addedThisWeek))
                    LabeledRow("Users", Format.count(o.userCount))
                }
            }
            activity?.let { a ->
                item {
                    SectionHeader("Activity")
                    LabeledRow("Plays today", Format.count(a.playsToday))
                    LabeledRow("Plays this week", Format.count(a.playsWeek))
                    LabeledRow("Active users this week", Format.count(a.activeUsersWeek))
                    a.topUserToday?.let { LabeledRow("Top today", "${it.name} · ${it.plays}") }
                }
            }
            ops?.let { o ->
                item {
                    SectionHeader("Operations")
                    LabeledRow("Failed jobs (24h)", Format.count(o.failedJobs24h))
                    o.lastFailure?.let { f -> LabeledRow("Last failure", f.name, onClick = { nav.go(JobRunRoute(f.runId)) }) }
                    LabeledRow("Last sync", Format.relative(o.lastSyncAt))
                    LabeledRow("Up for", Durations.short(o.uptimeSec * 1000))
                }
            }
            item {
                SectionHeader("More")
                LabeledRow("Events", null, leading = Icons.AutoMirrored.Outlined.List, onClick = { nav.go(EventsRoute) })
                WebAdminRow("/")
            }
        }
    }

    selected?.let { s ->
        SessionSheet(s, onDismiss = { selected = null }) { sessions = sessions.filter { it.sessionId != s.sessionId } }
    }
}

@Composable
internal fun SessionRow(session: PlexSession, modifier: Modifier = Modifier) {
    val model = LocalAdmin.current
    val progress = session.duration?.takeIf { it > 0 }?.let { d -> session.viewOffset?.let { (it / d).coerceIn(0.0, 1.0).toFloat() } }
    ListItem(
        leadingContent = { RemoteImage(model.image(session.parentThumb ?: session.thumb), Modifier.size(width = 44.dp, height = 66.dp), corner = 4.dp) },
        headlineContent = { Text(session.grandparentTitle ?: session.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (session.grandparentTitle != null) Text(session.title, maxLines = 1)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(if (session.state == "paused") Icons.Outlined.Pause else Icons.Outlined.PlayArrow, contentDescription = session.state, modifier = Modifier.size(16.dp))
                    Text("${session.user} · ${session.player}", style = MaterialTheme.typography.bodySmall)
                    if (session.decision == "transcode") Text("· Transcode", style = MaterialTheme.typography.bodySmall, color = Tones.warning)
                }
                progress?.let { LinearProgressIndicator(progress = { it }, modifier = Modifier.fillMaxWidth()) }
            }
        },
        modifier = modifier,
    )
}

@Composable
private fun SessionSheet(session: PlexSession, onDismiss: () -> Unit, terminated: () -> Unit) {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val haptics = rememberHaptics()
    val error = rememberActionError()
    var confirm by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Text("Now playing", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 24.dp))
        SessionRow(session)
        LabeledRow("Player", listOfNotNull(session.player, session.platform).joinToString(" · "))
        LabeledRow("Stream", session.decision.replaceFirstChar { it.uppercase() })
        session.videoResolution?.let { LabeledRow("Resolution", it) }
        session.address?.let { LabeledRow("Address", it + if (session.local == true) " (local)" else "") }
        session.userId?.let { id ->
            LabeledRow("About ${session.user}", null, leading = Icons.Outlined.Person, onClick = {
                onDismiss()
                nav.go(UserRoute(id, session.user))
            })
        }
        if (session.sessionId != null) {
            ListItem(
                headlineContent = { Text("Stop playback", color = MaterialTheme.colorScheme.error) },
                leadingContent = { Icon(Icons.Outlined.StopCircle, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                modifier = Modifier.clickableRow { confirm = true },
            )
        }
        androidx.compose.foundation.layout.Spacer(Modifier.padding(12.dp))
    }
    if (confirm) {
        ConfirmDialog(
            "Stop ${session.user}'s playback?",
            "Plex ends the stream on their device.",
            "Stop playback",
            onConfirm = {
                model.scope.launch {
                    try {
                        model.client.call(AdminApi.usersTerminateSession, Admin.UsersTerminateSessionInput(session.sessionId ?: return@launch))
                        haptics.confirm()
                        terminated()
                        onDismiss()
                    } catch (e: ApiError) {
                        error.value = e
                    }
                }
            },
            onDismiss = { confirm = false },
        )
    }
    ActionErrorDialog(error)
}
