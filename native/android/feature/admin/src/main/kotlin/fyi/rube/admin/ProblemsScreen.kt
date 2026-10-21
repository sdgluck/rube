// Problems, health and events: what's broken, what's unreachable, and what
// happened. Problems are grouped by kind with a "Fix all" for the kinds that
// can be fixed in bulk; every row's actions are in its sheet, with swipes as
// the shortcut (fix from the start edge, dismiss from the end).
package fyi.rube.admin

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Error
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.OpenInBrowser
import androidx.compose.material.icons.outlined.RemoveCircleOutline
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import fyi.rube.api.ApiError
import fyi.rube.model.Admin
import fyi.rube.model.ProblemKind
import fyi.rube.model.AdminApi
import fyi.rube.platform.Links
import fyi.rube.platform.ui.ActionErrorDialog
import fyi.rube.platform.ui.ActionSheet
import fyi.rube.platform.ui.EmptyState
import fyi.rube.platform.ui.ErrorState
import fyi.rube.platform.ui.Format
import fyi.rube.platform.ui.LoadState
import fyi.rube.platform.ui.LoadStateView
import fyi.rube.platform.ui.Nav
import fyi.rube.platform.ui.Notice
import fyi.rube.platform.ui.Poll
import fyi.rube.platform.ui.SectionHeader
import fyi.rube.platform.ui.SheetAction
import fyi.rube.platform.ui.SwipeAction
import fyi.rube.platform.ui.SwipeActionsRow
import fyi.rube.platform.ui.TbScreen
import fyi.rube.platform.ui.Tones
import fyi.rube.platform.ui.clickableRow
import fyi.rube.platform.ui.next
import fyi.rube.platform.ui.rememberActionError
import fyi.rube.platform.ui.rememberHaptics
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

private typealias Problem = Admin.ProblemsListOutput.Problem

internal fun kindTitle(raw: String): String = when (raw) {
    "episodeOrdering" -> "Episode ordering"
    "missingEpisodes" -> "Missing episodes"
    "inArrNotInPlex" -> "In *Arr, not in Plex"
    "inPlexNotInArr" -> "In Plex, not in *Arr"
    "failedImport" -> "Failed imports"
    "unknownSize" -> "Unknown size"
    "ruleFailing" -> "Failing rules"
    "ruleEmpty" -> "Empty rules"
    "ruleConflict" -> "Rule conflicts"
    "legacyAgent" -> "Legacy agents"
    "unmatched" -> "Unmatched"
    "duplicateAcrossInstances" -> "Duplicates across instances"
    else -> raw.ifEmpty { "Other" }
}

@Composable
internal fun ProblemsScreen() {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val context = LocalContext.current
    val haptics = rememberHaptics()
    val error = rememberActionError()
    var state by remember { mutableStateOf<LoadState<Admin.ProblemsListOutput>>(LoadState.Loading) }
    var showDismissed by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf<Problem?>(null) }
    val c = model.client

    suspend fun load() {
        state = state.next { c.call(AdminApi.problemsList) }
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

    fun fix(p: Problem) = act {
        notice = c.call(AdminApi.problemsFix, Admin.ProblemsFixInput(p.kind, p.subject)).message
    }

    fun dismiss(p: Problem) = act { c.call(AdminApi.problemsDismiss, Admin.ProblemsDismissInput(p.kind, p.subject)) }
    fun restore(p: Problem) = act { c.call(AdminApi.problemsUndismiss, Admin.ProblemsUndismissInput(p.kind, p.subject)) }

    fun rescan(subject: String? = null) = act {
        notice = when (val r = c.call(AdminApi.problemsRescan, Admin.ProblemsRescanInput(subject))) {
            is Admin.ProblemsRescanOutput.OkTrue -> "Checking again — this takes a moment."
            is Admin.ProblemsRescanOutput.OkFalse ->
                if (r.value.reason == Admin.ProblemsRescanOutput.OkFalseValue.Reason.ALREADY_RUNNING) "A check is already running."
                else "Couldn't start a check (${r.value.reason.raw.ifEmpty { "unknown" }})."
        }
    }

    fun fixAll(kind: String, problems: List<Problem>) = act {
        val result = c.call(AdminApi.problemsFixAll, Admin.ProblemsFixAllInput(problemKind(kind), problems.filter { it.fixable }.map { it.subject }))
        notice = "Fixed ${result.fixed.toLong()}." + if (result.failed.isEmpty()) "" else " ${result.failed.size} failed: " + result.failed.joinToString("; ") { "${it.title} (${it.error})" }
    }

    LaunchedEffect(Unit) { load() }

    TbScreen(
        "Problems",
        nav = Nav.BACK,
        onNav = { nav.back() },
        onRefresh = { load() },
        actions = {
            IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text("Show dismissed") },
                    trailingIcon = { Checkbox(checked = showDismissed, onCheckedChange = null) },
                    onClick = { showDismissed = !showDismissed; menu = false },
                )
                DropdownMenuItem(text = { Text("Check again") }, leadingIcon = { Icon(Icons.Outlined.Refresh, null) }, onClick = { menu = false; rescan() })
                DropdownMenuItem(
                    text = { Text("Open in web admin") },
                    leadingIcon = { Icon(Icons.Outlined.OpenInBrowser, null) },
                    onClick = { menu = false; Links.openInTab(context, model.web("/problems")) },
                )
            }
        },
    ) {
        LoadStateView(state, onRetry = { model.scope.launch { load() } }) { list ->
            val shown = list.problems.filter { showDismissed || !it.dismissed }
            LazyColumn(Modifier.fillMaxSize()) {
                notice?.let { n -> item { Notice(n, Icons.Outlined.Build) } }
                if (shown.isEmpty()) {
                    item {
                        EmptyState(
                            Icons.Outlined.Verified,
                            "No problems",
                            list.lastScannedAt?.let { "Last checked ${Format.relative(it)}." } ?: "Not checked yet.",
                        )
                    }
                }
                for ((kind, problems) in shown.groupBy { it.kind.raw }.toSortedMap()) {
                    item(key = "h-$kind") {
                        SectionHeader(kindTitle(kind)) {
                            if (problems.count { it.fixable } > 1) TextButton(onClick = { fixAll(kind, problems) }) { Text("Fix all") }
                        }
                    }
                    items(problems, key = { it.fingerprint }) { p ->
                        SwipeActionsRow(
                            start = if (p.fixable && p.fixPending != true) {
                                SwipeAction(p.fixLabel ?: "Fix", Icons.Outlined.Build, MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer) { fix(p) }
                            } else null,
                            end = if (p.dismissed) {
                                SwipeAction("Restore", Icons.Outlined.Visibility, MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.colorScheme.onSecondaryContainer) { restore(p) }
                            } else {
                                SwipeAction("Dismiss", Icons.Outlined.VisibilityOff, MaterialTheme.colorScheme.surfaceContainerHighest, MaterialTheme.colorScheme.onSurface) { dismiss(p) }
                            },
                        ) {
                            ListItem(
                                headlineContent = { Text(p.title) },
                                supportingContent = {
                                    Column {
                                        Text(p.detail)
                                        if (p.fixPending == true) Text("Fix in progress", style = MaterialTheme.typography.labelMedium)
                                        if (p.dismissed) Text("Dismissed", style = MaterialTheme.typography.labelMedium)
                                    }
                                },
                                modifier = Modifier.clickableRow { sheet = p },
                            )
                        }
                    }
                }
            }
        }
    }

    sheet?.let { p ->
        ActionSheet(
            p.title,
            buildList {
                if (p.fixable) add(SheetAction(p.fixLabel ?: "Fix", Icons.Outlined.Build) { fix(p) })
                add(SheetAction("Check again", Icons.Outlined.Refresh) { rescan(p.subject) })
                if (p.dismissed) add(SheetAction("Restore", Icons.Outlined.Visibility) { restore(p) })
                else add(SheetAction("Dismiss", Icons.Outlined.VisibilityOff) { dismiss(p) })
            },
            onDismiss = { sheet = null },
            subtitle = p.detail,
        )
    }
    ActionErrorDialog(error)
}

// A group's kind, read back from the wire value the list is grouped by.
private fun problemKind(raw: String) = ProblemKind.entries.firstOrNull { it.raw == raw } ?: ProblemKind.UNKNOWN

@Composable
internal fun HealthScreen() {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val context = LocalContext.current
    var state by remember { mutableStateOf<LoadState<List<Admin.HealthStatusItem>>>(LoadState.Loading) }
    val checking = remember { mutableStateListOf<String>() }

    suspend fun load() {
        state = state.next { model.client.call(AdminApi.healthStatus) }
    }

    fun check(service: String) {
        checking += service
        model.scope.launch {
            quietly(null) { model.client.call(AdminApi.healthCheck, Admin.HealthCheckInput(service)) }
            checking -= service
            load()
        }
    }

    Poll(30_000) { load() }

    TbScreen(
        "Health",
        nav = Nav.BACK,
        onNav = { nav.back() },
        onRefresh = { load() },
        actions = {
            IconButton(onClick = { Links.openInTab(context, model.web("/settings/health")) }) {
                Icon(Icons.Outlined.OpenInBrowser, contentDescription = "Settings in web admin")
            }
        },
    ) {
        LoadStateView(state, onRetry = { model.scope.launch { load() } }) { items ->
            LazyColumn(Modifier.fillMaxSize()) {
                items(items, key = { it.service }) { item ->
                    SwipeActionsRow(
                        end = if (item.configured) {
                            SwipeAction("Check", Icons.Outlined.Refresh, MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer) { check(item.service) }
                        } else null,
                    ) {
                        ListItem(
                            leadingContent = {
                                when {
                                    !item.configured -> Icon(Icons.Outlined.RemoveCircleOutline, contentDescription = "Not configured", tint = MaterialTheme.colorScheme.outline)
                                    item.status == "ok" -> Icon(Icons.Outlined.CheckCircle, contentDescription = "OK", tint = Tones.success)
                                    item.status == "error" -> Icon(Icons.Outlined.Error, contentDescription = "Error", tint = MaterialTheme.colorScheme.error)
                                    else -> Icon(Icons.Outlined.HelpOutline, contentDescription = "Unknown", tint = MaterialTheme.colorScheme.outline)
                                }
                            },
                            headlineContent = { Text(item.service) },
                            supportingContent = {
                                Column {
                                    Text(if (item.configured) item.message ?: "Not checked yet" else "Not configured")
                                    item.timestamp?.let { Text(Format.relative(it), style = MaterialTheme.typography.labelSmall) }
                                }
                            },
                            trailingContent = if (item.service in checking) ({ CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }) else null,
                            modifier = if (item.configured) Modifier.clickableRow { check(item.service) } else Modifier,
                        )
                    }
                }
            }
        }
    }
}

private const val EVENTS_PAGE = 50L

@Composable
internal fun EventsScreen() {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val items = remember { mutableStateListOf<Admin.EventsListOutput.Item>() }
    var total by remember { mutableStateOf<Long?>(null) }
    var search by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<ApiError?>(null) }
    var loading by remember { mutableStateOf(false) }
    val list = rememberLazyListState()

    suspend fun more() {
        if (loading || (total != null && items.size >= total!!)) return
        loading = true
        try {
            val q = search.trim()
            val page = model.client.call(AdminApi.eventsList, Admin.EventsListInput(offset = items.size.toLong(), limit = EVENTS_PAGE, search = q.ifEmpty { null }))
            items += page.items
            total = page.total
            error = null
        } catch (e: ApiError) {
            if (e !is ApiError.Cancelled) error = e
        } finally {
            loading = false
        }
    }

    suspend fun reload() {
        items.clear()
        total = null
        more()
    }

    LaunchedEffect(search) {
        if (search.isNotEmpty()) delay(300)
        reload()
    }
    LaunchedEffect(list) {
        snapshotFlow { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .filter { it >= items.size - 5 && items.isNotEmpty() }
            .collect { more() }
    }

    TbScreen("Events", nav = Nav.BACK, onNav = { nav.back() }, onRefresh = { reload() }) {
        LazyColumn(Modifier.fillMaxSize(), state = list) {
            item {
                OutlinedTextField(
                    value = search,
                    onValueChange = { search = it },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    placeholder = { Text("Search events") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            error?.let { e -> item { ErrorState(e, onRetry = { model.scope.launch { reload() } }) } }
            items(items, key = { it.id }) { event ->
                val bad = event.type.contains("error") || event.type.contains("fail")
                ListItem(
                    overlineContent = {
                        Text(event.type, color = if (bad) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                    },
                    headlineContent = { Text(event.message) },
                    supportingContent = if (event.count > 1) ({ Text("×${event.count}") }) else null,
                    trailingContent = { Text(Format.relative(event.timestamp), style = MaterialTheme.typography.labelSmall) },
                )
            }
            if (loading) item { CircularProgressIndicator(Modifier.padding(24.dp)) }
        }
    }
}
