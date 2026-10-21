// The cleanup queue: what rules are about to remove, and the decisions on it.
//
// Keeping (a hold) and protecting are safe and one swipe away. Approving a
// removal and lifting a protection are what let something be deleted, so they
// go through a confirmation dialog. Holding several at once can be undone:
// `holdMany` answers with each item's previous hold, and `restoreHolds` puts
// exactly that back — which is what the snackbar's Undo sends.
package fyi.rube.admin

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import fyi.rube.api.ApiError
import fyi.rube.model.Admin
import fyi.rube.model.AdminApi
import fyi.rube.platform.ui.ActionErrorDialog
import fyi.rube.platform.ui.ActionSheet
import fyi.rube.platform.ui.ConfirmDialog
import fyi.rube.platform.ui.EmptyState
import fyi.rube.platform.ui.Format
import fyi.rube.platform.ui.LoadState
import fyi.rube.platform.ui.LoadStateView
import fyi.rube.platform.ui.Nav
import fyi.rube.platform.ui.PartMenu
import fyi.rube.platform.ui.SheetAction
import fyi.rube.platform.ui.SwipeAction
import fyi.rube.platform.ui.SwipeActionsRow
import fyi.rube.platform.ui.TbScreen
import fyi.rube.platform.ui.Tones
import fyi.rube.platform.ui.next
import fyi.rube.platform.ui.rememberActionError
import fyi.rube.platform.ui.rememberHaptics
import fyi.rube.platform.ui.value
import kotlinx.coroutines.launch

private typealias Item = Admin.CleanupQueueItem

private fun key(i: Item) = "${i.ruleId}|${i.ratingKey}"

@Composable
private fun bytes(n: Double?): String? = n?.let { Format.bytes(it) }

private fun whenText(item: Item, date: (Long) -> String): String = when {
    item.held && item.heldUntil != null -> "Kept until ${date(item.heldUntil!!.toLong())}"
    item.held -> "Kept"
    item.runsRemaining == 0L -> "Goes on the next run"
    else -> "In ${Format.plural(item.runsRemaining, "more run")}"
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun CleanupScreen() {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val haptics = rememberHaptics()
    val error = rememberActionError()
    val snackbar = remember { SnackbarHostState() }
    var queue by remember { mutableStateOf<LoadState<List<Item>>>(LoadState.Loading) }
    var counts by remember { mutableStateOf<Map<String, Admin.CleanupCountsValue>>(emptyMap()) }
    var held by remember { mutableStateOf(false) }
    var selecting by remember { mutableStateOf(false) }
    val selection = remember { mutableStateListOf<String>() }
    var toApprove by remember { mutableStateOf<Item?>(null) }
    var sheet by remember { mutableStateOf<Item?>(null) }
    val c = model.client

    suspend fun load() {
        queue = queue.next { c.call(AdminApi.cleanupQueue, Admin.CleanupQueueInput()) }
        counts = quietly(counts) { c.call(AdminApi.cleanupCounts) }
    }

    fun act(work: suspend () -> Unit) {
        model.scope.launch {
            try {
                work()
                haptics.confirm()
                load()
                model.refreshMetrics()
            } catch (e: ApiError) {
                error.value = e
            }
        }
    }

    fun keep(item: Item) = act { c.call(AdminApi.cleanupHold, Admin.CleanupHoldInput(item.ruleId, item.ratingKey, days = 30)) }
    fun stopKeeping(item: Item) = act {
        c.call(AdminApi.cleanupRestoreHolds, Admin.CleanupRestoreHoldsInput(listOf(Admin.CleanupRestoreHoldsInput.Item(item.ruleId, item.ratingKey, null))))
    }
    fun protect(item: Item) = act {
        c.call(AdminApi.cleanupProtect, Admin.CleanupProtectInput(Admin.CleanupProtectInput.Kind.ITEM, item.ratingKey, label = item.title))
    }

    fun holdSelected() {
        val items = queue.value.orEmpty().filter { key(it) in selection }.map { Admin.CleanupHoldManyInput.Item(it.ruleId, it.ratingKey) }
        act {
            val result = c.call(AdminApi.cleanupHoldMany, Admin.CleanupHoldManyInput(items, days = 30))
            selection.clear()
            selecting = false
            model.scope.launch {
                val choice = snackbar.showSnackbar("Kept ${result.count}.", actionLabel = "Undo", duration = SnackbarDuration.Long)
                if (choice == SnackbarResult.ActionPerformed) {
                    act {
                        c.call(
                            AdminApi.cleanupRestoreHolds,
                            Admin.CleanupRestoreHoldsInput(result.previous.map { Admin.CleanupRestoreHoldsInput.Item(it.ruleId, it.ratingKey, it.heldUntil) }),
                        )
                    }
                }
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    TbScreen(
        if (selecting) "${selection.size} selected" else "Cleanup",
        nav = if (selecting) Nav.CLOSE else Nav.NONE,
        onNav = { selecting = false; selection.clear() },
        snackbar = snackbar,
        onRefresh = { load() },
        actions = {
            if (!selecting) {
                IconButton(onClick = { selecting = true }, modifier = Modifier.testTag("select")) { Icon(Icons.Outlined.Checklist, contentDescription = "Select") }
                PartMenu()
            }
        },
        bottomBar = {
            if (selecting) {
                BottomAppBar {
                    Button(onClick = { holdSelected() }, enabled = selection.isNotEmpty(), modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                        Icon(Icons.Outlined.PanTool, contentDescription = null)
                        Text("Keep ${selection.size} for 30 days", Modifier.padding(start = 8.dp))
                    }
                }
            }
        },
    ) {
        LoadStateView(queue, onRetry = { model.scope.launch { load() } }) { items ->
            val shown = items.filter { it.held == held }.sortedBy { it.runsRemaining }
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(16.dp)) {
                        SegmentedButton(selected = !held, onClick = { held = false }, shape = SegmentedButtonDefaults.itemShape(0, 2)) {
                            Text("Due (${items.count { !it.held }})")
                        }
                        SegmentedButton(selected = held, onClick = { held = true }, shape = SegmentedButtonDefaults.itemShape(1, 2)) {
                            Text("Kept (${items.count { it.held }})")
                        }
                    }
                    val queued = counts.values.sumOf { it.queued }.toLong()
                    Text(
                        "$queued queued across ${Format.plural(counts.size.toLong(), "rule")}.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                }
                if (shown.isEmpty()) item { EmptyState(Icons.Outlined.DeleteForever, if (held) "Nothing kept" else "Nothing queued") }
                items(shown, key = { key(it) }) { item ->
                    val k = key(item)
                    val row: @Composable () -> Unit = {
                        ListItem(
                            leadingContent = if (selecting) ({ Checkbox(checked = k in selection, onCheckedChange = null) }) else null,
                            headlineContent = { Text(item.title) },
                            trailingContent = if (item.isProtected) ({ Icon(Icons.Outlined.Shield, contentDescription = "Protected", tint = Tones.success) }) else null,
                            supportingContent = {
                                Column {
                                    Text(
                                        whenText(item) { java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(java.util.Date(it)) },
                                        color = if (item.runsRemaining == 0L && !item.held) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    Text(listOfNotNull(item.ruleName, bytes(item.fileSize)).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                                    if (item.keepVotes.isNotEmpty()) Text("${item.keepVotes.joinToString(", ")} asked to keep", style = MaterialTheme.typography.labelMedium, color = Tones.warning)
                                    if (item.requiresApproval) {
                                        Text(
                                            if (item.approved) "Approved" else "Waiting for your approval",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = if (item.approved) MaterialTheme.colorScheme.onSurfaceVariant else Tones.warning,
                                        )
                                    }
                                }
                            },
                            modifier = Modifier.combinedClickable(
                                onClick = {
                                    if (selecting) {
                                        if (k in selection) selection.remove(k) else selection.add(k)
                                        haptics.tick()
                                    } else {
                                        sheet = item
                                    }
                                },
                                onLongClick = {
                                    if (!selecting) {
                                        selecting = true
                                        selection.add(k)
                                        haptics.confirm()
                                    }
                                },
                            ),
                        )
                    }
                    if (selecting) {
                        row()
                    } else {
                        SwipeActionsRow(
                            start = if (!item.held) {
                                SwipeAction("Keep", Icons.Outlined.PanTool, MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer) { keep(item) }
                            } else {
                                SwipeAction("Stop keeping", Icons.Outlined.Close, MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.colorScheme.onSecondaryContainer) { stopKeeping(item) }
                            },
                            end = if (!item.isProtected) {
                                SwipeAction("Protect", Icons.Outlined.Shield, MaterialTheme.colorScheme.tertiaryContainer, MaterialTheme.colorScheme.onTertiaryContainer) { protect(item) }
                            } else null,
                        ) { row() }
                    }
                }
                item {
                    androidx.compose.material3.HorizontalDivider(Modifier.padding(vertical = 8.dp))
                    ListItem(
                        headlineContent = { Text("Protections") },
                        leadingContent = { Icon(Icons.Outlined.Shield, contentDescription = null) },
                        modifier = Modifier.combinedClickable(onClick = { nav.go(ProtectionsRoute) }),
                    )
                    WebAdminRow("/cleanup/rules", "Cleanup rules in web admin")
                }
            }
        }
    }

    sheet?.let { item ->
        ActionSheet(
            item.title,
            buildList {
                if (!item.held) add(SheetAction("Keep for 30 days", Icons.Outlined.PanTool) { keep(item) })
                else add(SheetAction("Stop keeping", Icons.Outlined.Close) { stopKeeping(item) })
                if (!item.isProtected) add(SheetAction("Protect from cleanup", Icons.Outlined.Shield) { protect(item) })
                if (item.requiresApproval && !item.approved) add(SheetAction("Approve removal", Icons.Outlined.DeleteForever, destructive = true) { toApprove = item })
                add(SheetAction("Details", Icons.Outlined.Info) { nav.go(MediaRoute(item.ratingKey, item.title)) })
            },
            onDismiss = { sheet = null },
            subtitle = item.ruleName,
        )
    }
    toApprove?.let { item ->
        ConfirmDialog(
            "Approve removing “${item.title}”?",
            "“${item.ruleName}” will delete it ${if (item.runsRemaining == 0L) "on its next run" else "in ${item.runsRemaining} runs"}.",
            "Approve removal",
            onConfirm = { act { c.call(AdminApi.cleanupApprove, Admin.CleanupApproveInput(item.ruleId, item.ratingKey, true)) } },
            onDismiss = { toApprove = null },
        )
    }
    ActionErrorDialog(error)
}

@Composable
internal fun ProtectionsScreen() {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val error = rememberActionError()
    var state by remember { mutableStateOf<LoadState<List<Admin.CleanupProtectionsItem>>>(LoadState.Loading) }
    var toRemove by remember { mutableStateOf<Admin.CleanupProtectionsItem?>(null) }

    suspend fun load() {
        state = state.next { model.client.call(AdminApi.cleanupProtections) }
    }
    LaunchedEffect(Unit) { load() }

    TbScreen("Protections", nav = Nav.BACK, onNav = { nav.back() }, onRefresh = { load() }) {
        LoadStateView(state, onRetry = { model.scope.launch { load() } }) { items ->
            LazyColumn(Modifier.fillMaxSize()) {
                if (items.isEmpty()) {
                    item { EmptyState(Icons.Outlined.Shield, "Nothing protected", "Swipe an item in the queue to protect it from every cleanup rule.") }
                }
                items(items, key = { it.id }) { p ->
                    SwipeActionsRow(
                        end = SwipeAction("Unprotect", Icons.Outlined.LockOpen, MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer) { toRemove = p },
                    ) {
                        ListItem(
                            headlineContent = { Text(p.label.ifEmpty { p.value }) },
                            supportingContent = { Text(p.kind.replaceFirstChar { it.uppercase() } + if (p.note.isEmpty()) "" else " · ${p.note}") },
                        )
                    }
                }
            }
        }
    }
    toRemove?.let { p ->
        ConfirmDialog(
            "Stop protecting “${p.label.ifEmpty { p.value }}”?",
            "Cleanup rules will be able to remove it again.",
            "Unprotect",
            onConfirm = {
                model.scope.launch {
                    try {
                        model.client.call(AdminApi.cleanupUnprotect, Admin.CleanupUnprotectInput(p.id))
                        load()
                    } catch (e: ApiError) {
                        error.value = e
                    }
                }
            },
            onDismiss = { toRemove = null },
        )
    }
    ActionErrorDialog(error)
}
