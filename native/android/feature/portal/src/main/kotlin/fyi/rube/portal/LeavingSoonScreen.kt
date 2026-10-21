// What a cleanup rule is about to remove, and the way to say you'd rather it
// didn't. From `apps/portal/src/tabs/LeavingSoon.tsx`.
//
// "Keep" records a vote, not a hold: a shared user must not be able to
// silently overrule the owner's rule, only turn a removal into a decision the
// owner makes. The vote shows at once and is rolled back if it didn't land.
package fyi.rube.portal

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import fyi.rube.api.ApiError
import fyi.rube.api.Durations
import fyi.rube.api.ServerConnection
import fyi.rube.api.ServerProduct
import fyi.rube.model.Portal
import fyi.rube.model.PortalApi
import fyi.rube.platform.ui.EmptyState
import fyi.rube.platform.ui.Format
import fyi.rube.platform.ui.LabeledRow
import fyi.rube.platform.ui.LoadState
import fyi.rube.platform.ui.LoadStateView
import fyi.rube.platform.ui.LocalShell
import fyi.rube.platform.ui.PartMenu
import fyi.rube.platform.ui.SectionHeader
import fyi.rube.platform.ui.SwipeAction
import fyi.rube.platform.ui.SwipeActionsRow
import fyi.rube.platform.ui.TbScreen
import fyi.rube.platform.ui.error
import fyi.rube.platform.ui.next
import fyi.rube.platform.ui.rememberHaptics
import fyi.rube.platform.ui.value
import kotlinx.coroutines.launch

@Composable
internal fun LeavingSoonScreen() {
    val model = LocalPortal.current
    var state by remember { mutableStateOf<LoadState<List<Portal.LeavingSoonItem>>>(LoadState.Loading) }
    val optimistic = remember { mutableStateMapOf<String, Boolean>() }
    val haptics = rememberHaptics()
    val canVote = model.components?.actionKeep == true

    suspend fun load() {
        state = state.next { model.client.call(PortalApi.leavingSoon) }
        if (state.value != null) optimistic.clear()
        if (state.error is ApiError.Forbidden) model.componentWentAway()
    }

    fun vote(ratingKey: String, keep: Boolean) {
        haptics.toggle(keep)
        optimistic[ratingKey] = keep
        model.scope.launch {
            try {
                model.client.call(PortalApi.voteKeep, Portal.VoteKeepInput(ratingKey, keep))
            } catch (e: ApiError.Forbidden) {
                optimistic.remove(ratingKey)
                model.componentWentAway()
            } catch (e: ApiError) {
                optimistic.remove(ratingKey)
            }
        }
    }

    LaunchedEffect(Unit) { if (state.value == null) load() }

    TbScreen("Leaving Soon", actions = { PartMenu() }, onRefresh = { load() }) {
        LoadStateView(state, onRetry = { model.scope.launch { load() } }) { items ->
            if (items.isEmpty()) {
                EmptyState(Icons.Outlined.CheckCircle, "Nothing is going anywhere")
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    items(items, key = { it.ratingKey }) { item ->
                        val voted = optimistic[item.ratingKey] ?: item.voted
                        SwipeActionsRow(
                            start = if (canVote) {
                                SwipeAction(
                                    if (voted) "Undo keep" else "Keep",
                                    if (voted) Icons.AutoMirrored.Outlined.Undo else Icons.Outlined.PanTool,
                                    MaterialTheme.colorScheme.primaryContainer,
                                    MaterialTheme.colorScheme.onPrimaryContainer,
                                ) { vote(item.ratingKey, !voted) }
                            } else {
                                null
                            },
                        ) {
                            ListItem(
                                headlineContent = { Text(item.title) },
                                supportingContent = {
                                    Text(if (item.runsRemaining == 0L) "Goes on the next run" else "In ${Format.plural(item.runsRemaining, "more run")}")
                                },
                                trailingContent = if (canVote) {
                                    {
                                        FilterChip(
                                            selected = voted,
                                            onClick = { vote(item.ratingKey, !voted) },
                                            label = { Text(if (voted) "Asked to keep" else "Keep") },
                                            leadingIcon = {
                                                Icon(
                                                    if (voted) Icons.Filled.CheckCircle else Icons.Outlined.PanTool,
                                                    contentDescription = null,
                                                    modifier = Modifier.padding(0.dp),
                                                )
                                            },
                                            colors = FilterChipDefaults.filterChipColors(),
                                            modifier = Modifier.testTag("keep-${item.ratingKey}"),
                                        )
                                    }
                                } else {
                                    null
                                },
                            )
                        }
                    }
                    item {
                        Text(
                            if (canVote) "Queued for removal. The server owner sees who asks to keep one." else "Queued for removal.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun AccountScreen() {
    val model = LocalPortal.current
    val shell = LocalShell.current
    var summary by remember { mutableStateOf<Portal.MyWatchSummaryOutput?>(null) }
    suspend fun load() {
        summary = try {
            model.client.call(PortalApi.myWatchSummary)
        } catch (e: ApiError) {
            summary
        }
    }
    LaunchedEffect(Unit) { load() }

    TbScreen("Account", actions = { PartMenu() }, onRefresh = { load() }) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            SectionHeader("Plex account")
            LabeledRow("Signed in as", model.me?.username ?: "—")
            LabeledRow("Server", ServerConnection(ServerProduct.PORTAL, model.baseUrl).displayHost)
            summary?.let {
                SectionHeader("Your watching")
                LabeledRow("Plays", Format.count(it.plays))
                LabeledRow("Time watched", Durations.short(it.watchedMs))
            }
            shell.settingsContent()
        }
    }
}
