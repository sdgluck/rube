// What Rube built for this person, and the one-gesture way to say it
// was wrong. From `apps/portal/src/tabs/MyCollections.tsx`.
//
// "Not for me" is optimistic and undoable: the row turns into an undo row at
// once and the request goes a few seconds later, because the server has no
// "un-not-for-me" to call afterwards — the undo window is the only one there
// is. The snackbar's Undo and the row's own button both close it.
package fyi.rube.portal

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fyi.rube.api.ApiError
import fyi.rube.model.Portal
import fyi.rube.model.PortalApi
import fyi.rube.platform.ui.EmptyState
import fyi.rube.platform.ui.Format
import fyi.rube.platform.ui.LoadState
import fyi.rube.platform.ui.LoadStateView
import fyi.rube.platform.ui.Notice
import fyi.rube.platform.ui.PartMenu
import fyi.rube.platform.ui.SwipeAction
import fyi.rube.platform.ui.SwipeActionsRow
import fyi.rube.platform.ui.TbScreen
import fyi.rube.platform.ui.Tone
import fyi.rube.platform.ui.error
import fyi.rube.platform.ui.next
import fyi.rube.platform.ui.rememberHaptics
import fyi.rube.platform.ui.value
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val UNDO_WINDOW_MS = 4_000L

@Composable
internal fun CollectionsScreen() {
    val model = LocalPortal.current
    var state by remember { mutableStateOf<LoadState<List<Portal.MyCollectionsItem>>>(LoadState.Loading) }
    // Titles whose undo window is open, with the job that will send them.
    val pending = remember { mutableStateMapOf<String, Job>() }
    val excluded = remember { mutableStateListOf<String>() }
    val snackbar = remember { SnackbarHostState() }
    val haptics = rememberHaptics()
    val canExclude = model.components?.actionNotForMe == true

    suspend fun load() {
        state = state.next { model.client.call(PortalApi.myCollections) }
        if (state.error is ApiError.Forbidden) model.componentWentAway()
    }

    fun send(title: String) {
        excluded += title
        model.scope.launch {
            try {
                model.client.call(PortalApi.notInterested, Portal.NotInterestedInput(title))
            } catch (e: ApiError.Forbidden) {
                excluded -= title
                model.componentWentAway()
            } catch (e: ApiError) {
                excluded -= title
            }
        }
    }

    fun undo(title: String) {
        pending.remove(title)?.cancel()
    }

    fun exclude(title: String) {
        haptics.confirm()
        pending[title] = model.scope.launch {
            delay(UNDO_WINDOW_MS)
            pending.remove(title)
            send(title)
        }
        model.scope.launch {
            val result = snackbar.showSnackbar("You won't see “$title” again.", actionLabel = "Undo", duration = SnackbarDuration.Short)
            if (result == SnackbarResult.ActionPerformed) undo(title)
        }
    }

    LaunchedEffect(Unit) { if (state.value == null) load() }
    // Leaving the tab sends what's pending rather than dropping it.
    DisposableEffect(Unit) {
        onDispose {
            for ((title, job) in pending.toMap()) {
                job.cancel()
                send(title)
            }
            pending.clear()
        }
    }

    TbScreen("Your Collections", actions = { PartMenu() }, snackbar = snackbar, onRefresh = { load() }) {
        LoadStateView(state, onRetry = { model.scope.launch { load() } }) { collections ->
            LazyColumn(Modifier.fillMaxSize().testTag("collections-list")) {
                item { PersonalizationBanner(model.personalization) }
                if (collections.isEmpty()) {
                    item {
                        EmptyState(
                            Icons.Outlined.GridView,
                            "Nothing yet",
                            "They arrive after the next nightly run.",
                            actionLabel = if (model.components?.tabTastes == true) "Set your tastes" else null,
                            onAction = { model.tab = PortalTab.TASTES },
                        )
                    }
                }
                items(collections, key = { it.ratingKey }) { collection ->
                    if (pending.containsKey(collection.title)) {
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Text("You won't see “${collection.title}” again.", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            OutlinedButton(onClick = { undo(collection.title) }) { Text("Undo") }
                        }
                    } else {
                        val gone = collection.title in excluded
                        SwipeActionsRow(
                            end = if (canExclude && !gone) {
                                SwipeAction("Not for me", Icons.Outlined.ThumbDown, MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer) {
                                    exclude(collection.title)
                                }
                            } else {
                                null
                            },
                        ) {
                            ListItem(
                                headlineContent = { Text(collection.title, style = MaterialTheme.typography.titleMedium) },
                                supportingContent = {
                                    androidx.compose.foundation.layout.Column {
                                        if (collection.summary.isNotEmpty()) Text(collection.summary, maxLines = 3, overflow = TextOverflow.Ellipsis)
                                        if (gone) Text("Won't show this again", style = MaterialTheme.typography.labelMedium)
                                    }
                                },
                                trailingContent = { Text(Format.plural(collection.itemCount, "item")) },
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Said when personalization isn't live, so an empty list reads as "not yet" rather than "you have no taste". */
@Composable
internal fun PersonalizationBanner(status: Portal.PersonalizationStatusOutput?) {
    when (status) {
        Portal.PersonalizationStatusOutput.DISABLED ->
            Notice("Personalized collections are switched off on this server.", Icons.Outlined.PauseCircle, Tone.WARNING)
        Portal.PersonalizationStatusOutput.ENABLING ->
            Notice("Personalization is being set up. Your collections will appear soon.", Icons.Outlined.HourglassTop)
        Portal.PersonalizationStatusOutput.DISABLING ->
            Notice("Personalization is being switched off on this server.", Icons.Outlined.HourglassTop, Tone.WARNING)
        else -> Unit
    }
}
