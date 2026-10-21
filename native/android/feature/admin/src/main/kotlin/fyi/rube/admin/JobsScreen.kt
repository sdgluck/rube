// Jobs and rules: run one, watch it, read its log, cancel it.
//
// The active-run lists are polled every two seconds while on screen, as the
// web sidebar does, so a run started here shows its progress without a
// refresh. Logs are fetched by offset — only what was appended since the last
// poll — because the whole log once rode along with every poll and a chatty
// job turned that into megabytes a second (`useRunLog.ts`).
package fyi.rube.admin

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fyi.rube.api.ApiError
import fyi.rube.api.Durations
import fyi.rube.model.Admin
import fyi.rube.model.AdminApi
import fyi.rube.model.RuleRunPhase
import fyi.rube.model.RuleRunSummary
import fyi.rube.platform.Links
import fyi.rube.platform.ui.ActionErrorDialog
import fyi.rube.platform.ui.ConfirmDialog
import fyi.rube.platform.ui.EmptyState
import fyi.rube.platform.ui.Format
import fyi.rube.platform.ui.LabeledRow
import fyi.rube.platform.ui.LoadState
import fyi.rube.platform.ui.LoadStateView
import fyi.rube.platform.ui.Nav
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
import fyi.rube.platform.ui.value
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.net.URLEncoder

@Composable
internal fun JobsAndRulesScreen() {
    var pane by rememberSaveable { mutableIntStateOf(0) }
    var search by rememberSaveable { mutableStateOf("") }
    // Pull-to-refresh belongs to the frame; the lists below reload when this ticks.
    val refreshes = remember { mutableIntStateOf(0) }
    TbScreen(if (pane == 0) "Jobs" else "Rules", actions = { PartMenu() }, onRefresh = { refreshes.intValue += 1; delay(400) }) {
        Column(Modifier.fillMaxSize()) {
            PrimaryTabRow(selectedTabIndex = pane) {
                Tab(selected = pane == 0, onClick = { pane = 0 }, text = { Text("Jobs") })
                Tab(selected = pane == 1, onClick = { pane = 1 }, text = { Text("Rules") })
            }
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                placeholder = { Text(if (pane == 0) "Search jobs" else "Search rules") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            )
            if (pane == 0) JobsList(search, refreshes.intValue) else RulesList(search, refreshes.intValue)
        }
    }
}

@Composable
private fun JobsList(search: String, refresh: Int) {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val haptics = rememberHaptics()
    val error = rememberActionError()
    var jobs by remember { mutableStateOf<LoadState<List<Admin.JobsListItem>>>(LoadState.Loading) }
    var active by remember { mutableStateOf(emptyList<Admin.JobsActiveRunsItem>()) }
    var recent by remember { mutableStateOf(emptyList<Admin.JobsRecentRunsItem>()) }
    val c = model.client

    suspend fun load() {
        jobs = jobs.next { c.call(AdminApi.jobsList) }
        recent = quietly(recent) { c.call(AdminApi.jobsRecentRuns, Admin.JobsRecentRunsInput(limit = 20)) }
    }

    fun start(id: String) = model.scope.launch {
        try {
            c.call(AdminApi.jobsStart, Admin.JobsStartInput(id))
            haptics.confirm()
            active = quietly(active) { c.call(AdminApi.jobsActiveRuns) }
        } catch (e: ApiError) {
            error.value = e
        }
    }

    fun cancel(runId: String) = model.scope.launch {
        try {
            c.call(AdminApi.jobsCancel, Admin.JobsCancelInput(runId))
        } catch (e: ApiError) {
            error.value = e
        }
    }

    LaunchedEffect(refresh) { load() }
    Poll(2_000) { active = quietly(active) { c.call(AdminApi.jobsActiveRuns) } }

    LoadStateView(jobs, onRetry = { model.scope.launch { load() } }) { list ->
        LazyColumn(Modifier.fillMaxSize()) {
            if (active.isNotEmpty()) {
                item { SectionHeader("Running") }
                items(active, key = { "a-${it.id}" }) { run ->
                    SwipeActionsRow(
                        end = SwipeAction("Cancel", Icons.Outlined.StopCircle, MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer) { cancel(run.id) },
                    ) {
                        ListItem(
                            headlineContent = { Text(run.jobName) },
                            supportingContent = {
                                Column {
                                    LinearProgressIndicator(progress = { run.progress.toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
                                    Text(run.message, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                                }
                            },
                            modifier = Modifier.clickableRow { nav.go(JobRunRoute(run.id)) },
                        )
                    }
                }
            }
            item { SectionHeader("Jobs") }
            items(list.filter { search.isBlank() || it.name.contains(search.trim(), ignoreCase = true) }, key = { it.id }) { job ->
                SwipeActionsRow(
                    start = SwipeAction("Run", Icons.Outlined.PlayArrow, MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer) { start(job.id) },
                ) {
                    ListItem(
                        leadingContent = { RunStatusIcon(if (active.any { it.jobId == job.id }) "running" else job.lastRunStatus) },
                        headlineContent = { Text(job.name, color = if (job.enabled == 0L) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface) },
                        supportingContent = {
                            Text(
                                listOfNotNull(job.schedule, job.lastRunStartedAt?.let { Format.relative(it) }).joinToString(" · "),
                                fontFamily = FontFamily.Monospace,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        },
                        modifier = Modifier.clickableRow { nav.go(JobRoute(job.id, job.name)) },
                    )
                }
            }
            if (recent.isNotEmpty()) {
                item { SectionHeader("Recent runs") }
                items(recent.take(15), key = { "r-${it.id}" }) { run ->
                    ListItem(
                        leadingContent = { RunStatusIcon(run.status) },
                        headlineContent = { Text(run.jobName) },
                        supportingContent = { Text(Format.relative(run.startedAt)) },
                        modifier = Modifier.clickableRow { nav.go(JobRunRoute(run.id)) },
                    )
                }
            }
            item { WebAdminRow("/jobs/schedule", "Schedules in web admin") }
        }
    }
    ActionErrorDialog(error)
}

@Composable
internal fun JobDetailScreen(jobId: String, name: String) {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val haptics = rememberHaptics()
    val error = rememberActionError()
    var runs by remember { mutableStateOf<LoadState<List<Admin.JobsRunsItem>>>(LoadState.Loading) }

    suspend fun load() {
        runs = runs.next { model.client.call(AdminApi.jobsRuns, Admin.JobsRunsInput(jobId, 30)) }
    }

    LaunchedEffect(jobId) { load() }
    TbScreen(name, nav = Nav.BACK, onNav = { nav.back() }, onRefresh = { load() }) {
        LoadStateView(runs, onRetry = { model.scope.launch { load() } }) { list ->
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    ListItem(
                        headlineContent = { Text("Run now") },
                        leadingContent = { Icon(Icons.Outlined.PlayArrow, contentDescription = null) },
                        modifier = Modifier.clickableRow {
                            model.scope.launch {
                                try {
                                    val started = model.client.call(AdminApi.jobsStart, Admin.JobsStartInput(jobId))
                                    haptics.confirm()
                                    nav.go(JobRunRoute(started.runId))
                                } catch (e: ApiError) {
                                    error.value = e
                                }
                            }
                        },
                    )
                    WebAdminRow("/jobs/$jobId")
                    SectionHeader("Runs")
                }
                if (list.isEmpty()) item { Text("Never run.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(list, key = { it.id }) { run ->
                    ListItem(
                        leadingContent = { RunStatusIcon(run.status) },
                        headlineContent = { Text(Format.dateTime(run.startedAt)) },
                        supportingContent = { Text(run.message.ifEmpty { run.status }, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                        modifier = Modifier.clickableRow { nav.go(JobRunRoute(run.id)) },
                    )
                }
            }
        }
    }
    ActionErrorDialog(error)
}

@Composable
internal fun JobRunScreen(runId: String) {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val error = rememberActionError()
    var run by remember { mutableStateOf<LoadState<Admin.JobsRunOutput>>(LoadState.Loading) }
    var ruleRuns by remember { mutableStateOf(emptyList<RuleRunSummary>()) }
    var confirmCancel by remember { mutableStateOf(false) }
    val c = model.client

    suspend fun load() {
        run = run.next { c.call(AdminApi.jobsRun, Admin.JobsRunInput(runId)) }
        ruleRuns = quietly(ruleRuns) { c.call(AdminApi.rulesRunsForJobRun, Admin.RulesRunsForJobRunInput(runId)) }
    }

    // Live while it runs; one last read once it has finished.
    LaunchedEffect(runId) {
        while (true) {
            load()
            val r = run.value
            if (r != null && !isRunActive(r.status)) break
            delay(1_000)
        }
    }

    val r = run.value
    TbScreen(r?.jobName ?: "Run", nav = Nav.BACK, onNav = { nav.back() }) {
        LoadStateView(run, onRetry = { model.scope.launch { load() } }) { r ->
            val live = isRunActive(r.status)
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    ListItem(
                        headlineContent = { Text("Status") },
                        trailingContent = { androidx.compose.foundation.layout.Row { RunStatusIcon(r.status); Text("  " + r.status.replaceFirstChar { it.uppercase() }) } },
                    )
                    if (live) LinearProgressIndicator(progress = { r.progress.toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp))
                    if (r.message.isNotEmpty()) Text(r.message, Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium)
                    LabeledRow("Started", Format.dateTime(r.startedAt))
                    r.finishedAt?.let { LabeledRow("Took", Durations.short((it - r.startedAt).toDouble()).let { d -> if (d == "0m") "${(it - r.startedAt) / 1000}s" else d }) }
                    r.failureKind?.let { LabeledRow("Failure", it) }
                    r.variant?.let { LabeledRow("Variant", it) }
                    if (live) {
                        ListItem(
                            headlineContent = { Text("Cancel run", color = MaterialTheme.colorScheme.error) },
                            leadingContent = { Icon(Icons.Outlined.StopCircle, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                            modifier = Modifier.clickableRow { confirmCancel = true },
                        )
                    }
                }
                if (ruleRuns.isNotEmpty()) {
                    item { SectionHeader("Rules in this run") }
                    items(ruleRuns, key = { it.id }) { rr ->
                        ListItem(
                            leadingContent = { RunStatusIcon(rr.status) },
                            headlineContent = { Text(rr.ruleName) },
                            modifier = Modifier.clickableRow { nav.go(RuleRunRoute(rr.id)) },
                        )
                    }
                }
                logSection(runId, live, fetch = { id, offset ->
                    val out = c.call(AdminApi.jobsRunLog, Admin.JobsRunLogInput(id, offset))
                    LogSlice(out.chunk, out.nextOffset.toLong(), out.size.toLong())
                }, full = { id -> c.call(AdminApi.jobsFullLog, Admin.JobsFullLogInput(id)).log })
            }
        }
    }

    if (confirmCancel) {
        ConfirmDialog(
            "Cancel this run?",
            null,
            "Cancel run",
            onConfirm = {
                model.scope.launch {
                    try {
                        c.call(AdminApi.jobsCancel, Admin.JobsCancelInput(runId))
                    } catch (e: ApiError) {
                        error.value = e
                    }
                }
            },
            onDismiss = { confirmCancel = false },
            dismissLabel = "Keep running",
        )
    }
    ActionErrorDialog(error)
}

internal data class LogSlice(val chunk: String, val next: Long, val size: Long)

/** A run's log, appended by offset while the run is live. */
internal fun LazyListScope.logSection(
    runId: String,
    active: Boolean,
    fetch: suspend (String, Long) -> LogSlice,
    full: suspend (String) -> String,
) {
    item(key = "log") { LogView(runId, active, fetch, full) }
}

@Composable
private fun LogView(runId: String, active: Boolean, fetch: suspend (String, Long) -> LogSlice, full: suspend (String) -> String) {
    val context = LocalContext.current
    var text by remember { mutableStateOf("") }
    var offset by remember { mutableLongStateOf(0L) }

    suspend fun poll() {
        // A finished run's log in one request, not a slice loop.
        if (!active && offset == 0L) {
            val whole = quietly<String?>(null) { full(runId) }
            if (whole != null) {
                text = whole
                offset = whole.toByteArray().size.toLong()
                return
            }
        }
        val slice = quietly<LogSlice?>(null) { fetch(runId, offset) } ?: return
        if (slice.size < offset) {
            // The stored log shrank — a rewrite, not an append. Take it whole.
            quietly<LogSlice?>(null) { fetch(runId, 0) }?.let {
                text = it.chunk
                offset = it.next
            }
            return
        }
        if (slice.chunk.isNotEmpty()) {
            text += slice.chunk
            offset = slice.next
        }
    }

    LaunchedEffect(runId, active) {
        do {
            poll()
            if (!active) break
            delay(1_000)
        } while (true)
    }

    Column {
        SectionHeader("Log") {
            if (text.isNotEmpty()) {
                TextButton(onClick = { Links.share(context, text, subject = "Run log") }) {
                    Icon(Icons.Outlined.Share, contentDescription = null)
                    Text("Share", Modifier.padding(start = 6.dp))
                }
            }
        }
        if (text.isEmpty()) {
            Text(if (active) "Waiting for output…" else "No log.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            SelectionContainer {
                Text(
                    text.takeLast(60_000),
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    lineHeight = 15.sp,
                    modifier = Modifier.horizontalScroll(rememberScrollState()).padding(16.dp),
                )
            }
        }
    }
}

// Rules

@Composable
private fun RulesList(search: String, refresh: Int) {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val haptics = rememberHaptics()
    val error = rememberActionError()
    var rules by remember { mutableStateOf<LoadState<List<Admin.RulesListItem>>>(LoadState.Loading) }
    var active by remember { mutableStateOf(emptyList<RuleRunSummary>()) }
    var recent by remember { mutableStateOf(emptyList<RuleRunSummary>()) }
    val c = model.client

    suspend fun load() {
        rules = rules.next { c.call(AdminApi.rulesList) }
        recent = quietly(recent) { c.call(AdminApi.rulesRecentRuns, Admin.RulesRecentRunsInput(limit = 20)) }
    }

    fun run(id: String) = model.scope.launch {
        try {
            c.call(AdminApi.rulesRun, Admin.RulesRunInput(id))
            haptics.confirm()
            active = quietly(active) { c.call(AdminApi.rulesActiveRuns) }
        } catch (e: ApiError) {
            error.value = e
        }
    }

    LaunchedEffect(refresh) { load() }
    Poll(2_000) { active = quietly(active) { c.call(AdminApi.rulesActiveRuns) } }

    LoadStateView(rules, onRetry = { model.scope.launch { load() } }) { list ->
        LazyColumn(Modifier.fillMaxSize()) {
            if (active.isNotEmpty()) {
                item { SectionHeader("Running") }
                items(active, key = { "a-${it.id}" }) { r ->
                    SwipeActionsRow(
                        end = SwipeAction("Cancel", Icons.Outlined.StopCircle, MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer) {
                            model.scope.launch {
                                try {
                                    c.call(AdminApi.rulesCancelRun, Admin.RulesCancelRunInput(r.id))
                                } catch (e: ApiError) {
                                    error.value = e
                                }
                            }
                        },
                    ) {
                        ListItem(
                            headlineContent = { Text(r.ruleName) },
                            supportingContent = {
                                Column {
                                    LinearProgressIndicator(progress = { r.progress.toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
                                    Text(r.message, maxLines = 1, style = MaterialTheme.typography.bodySmall)
                                }
                            },
                            modifier = Modifier.clickableRow { nav.go(RuleRunRoute(r.id)) },
                        )
                    }
                }
            }
            item { SectionHeader("Rules") }
            items(list.filter { search.isBlank() || it.name.contains(search.trim(), ignoreCase = true) }.sortedBy { it.position }, key = { it.id }) { rule ->
                SwipeActionsRow(
                    start = SwipeAction("Run", Icons.Outlined.PlayArrow, MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer) { run(rule.id) },
                ) {
                    ListItem(
                        leadingContent = { RunStatusIcon(if (active.any { it.ruleId == rule.id }) "running" else rule.lastRunStatus) },
                        headlineContent = { Text(rule.name, color = if (rule.enabled == 0L) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface) },
                        supportingContent = { Text(ruleSummary(rule)) },
                        modifier = Modifier.clickableRow { nav.go(RuleRoute(rule.id)) },
                    )
                }
            }
            if (recent.isNotEmpty()) {
                item { SectionHeader("Recent runs") }
                items(recent.take(15), key = { "r-${it.id}" }) { r ->
                    ListItem(
                        leadingContent = { RunStatusIcon(r.status) },
                        headlineContent = { Text(r.ruleName) },
                        supportingContent = { Text(Format.relative(r.startedAt)) },
                        modifier = Modifier.clickableRow { nav.go(RuleRunRoute(r.id)) },
                    )
                }
            }
        }
    }
    ActionErrorDialog(error)
}

private fun ruleSummary(rule: Admin.RulesListItem): String = buildList {
    add(rule.type)
    rule.lastRunItemCount?.let { add("$it items") }
    rule.lastRunAt?.let { add(Format.relative(it)) }
    if (rule.enabled == 0L) add("Off")
}.joinToString(" · ")

private fun rulesWebPath(name: String) = "/rules?q=" + URLEncoder.encode(name, "UTF-8").replace("+", "%20")

@Composable
internal fun RuleDetailScreen(ruleId: String) {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val haptics = rememberHaptics()
    val error = rememberActionError()
    var rule by remember { mutableStateOf<Admin.RulesListItem?>(null) }
    var runs by remember { mutableStateOf<LoadState<List<Admin.RulesRunsItem>>>(LoadState.Loading) }
    val c = model.client

    suspend fun load() {
        rule = quietly(null) { c.call(AdminApi.rulesList) }?.firstOrNull { it.id == ruleId } ?: rule
        runs = runs.next { c.call(AdminApi.rulesRuns, Admin.RulesRunsInput(ruleId, 30)) }
    }

    LaunchedEffect(ruleId) { load() }
    TbScreen(rule?.name ?: "Rule", nav = Nav.BACK, onNav = { nav.back() }, onRefresh = { load() }) {
        LoadStateView(runs, onRetry = { model.scope.launch { load() } }) { list ->
            LazyColumn(Modifier.fillMaxSize()) {
                rule?.let { r ->
                    item {
                        LabeledRow("Type", r.type)
                        LabeledRow("Enabled", if (r.enabled == 0L) "No" else "Yes")
                        r.lastRunAt?.let { LabeledRow("Last run", Format.relative(it)) }
                        r.lastRunItemCount?.let { LabeledRow("Items", Format.count(it)) }
                        r.lastRunCollectionCount?.let { LabeledRow("Collections", Format.count(it)) }
                        r.lastRunError?.let { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                        ListItem(
                            headlineContent = { Text("Run now") },
                            leadingContent = { Icon(Icons.Outlined.PlayArrow, contentDescription = null) },
                            modifier = Modifier.clickableRow {
                                model.scope.launch {
                                    try {
                                        val out = c.call(AdminApi.rulesRun, Admin.RulesRunInput(ruleId))
                                        haptics.confirm()
                                        nav.go(RuleRunRoute(out.runId))
                                    } catch (e: ApiError) {
                                        error.value = e
                                    }
                                }
                            },
                        )
                        WebAdminRow(rulesWebPath(r.name), "Edit in web admin")
                        WebAdminRow("/rules/$ruleId/runs", "Run history in web admin")
                    }
                }
                item { SectionHeader("Runs") }
                if (list.isEmpty()) item { Text("Never run.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(list, key = { it.id }) { run ->
                    ListItem(
                        leadingContent = { RunStatusIcon(run.status) },
                        headlineContent = { Text(Format.dateTime(run.startedAt)) },
                        supportingContent = {
                            Text("${run.trigger.raw.ifEmpty { "other" }} · +${run.changes.added.toLong()} −${run.changes.removed.toLong()}${if (run.phase == RuleRunPhase.TEST) " · test" else ""}")
                        },
                        modifier = Modifier.clickableRow { nav.go(RuleRunRoute(run.id)) },
                    )
                }
            }
        }
    }
    ActionErrorDialog(error)
}

@Composable
internal fun RuleRunScreen(runId: String) {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val error = rememberActionError()
    var run by remember { mutableStateOf<LoadState<Admin.RulesRunDetail?>>(LoadState.Loading) }
    val c = model.client

    suspend fun load() {
        run = run.next { c.call(AdminApi.rulesRunDetail, Admin.RulesRunDetailInput(runId)) }
    }

    LaunchedEffect(runId) {
        while (true) {
            load()
            val r = run.value
            if (run is LoadState.Failed || (r != null && !isRunActive(r.status)) || (run is LoadState.Loaded && r == null)) break
            delay(1_000)
        }
    }

    TbScreen("Rule Run", nav = Nav.BACK, onNav = { nav.back() }) {
        LoadStateView(run, onRetry = { model.scope.launch { load() } }) { detail ->
            if (detail == null) {
                EmptyState(Icons.Outlined.Search, "Run not found")
                return@LoadStateView
            }
            val live = isRunActive(detail.status)
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    ListItem(
                        headlineContent = { Text("Status") },
                        trailingContent = { androidx.compose.foundation.layout.Row { RunStatusIcon(detail.status); Text("  " + detail.status.replaceFirstChar { it.uppercase() }) } },
                    )
                    if (live) LinearProgressIndicator(progress = { detail.progress.toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp))
                    if (detail.message.isNotEmpty()) Text(detail.message, Modifier.padding(16.dp))
                    LabeledRow("Trigger", detail.trigger.raw.ifEmpty { "other" })
                    LabeledRow("Started", Format.dateTime(detail.startedAt))
                    detail.itemCount?.let { LabeledRow("Items", Format.count(it)) }
                    detail.collectionCount?.let { LabeledRow("Collections", Format.count(it)) }
                    detail.error?.let { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                    if (live) {
                        ListItem(
                            headlineContent = { Text("Cancel run", color = MaterialTheme.colorScheme.error) },
                            leadingContent = { Icon(Icons.Outlined.StopCircle, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                            modifier = Modifier.clickableRow {
                                model.scope.launch {
                                    try {
                                        c.call(AdminApi.rulesCancelRun, Admin.RulesCancelRunInput(runId))
                                    } catch (e: ApiError) {
                                        error.value = e
                                    }
                                }
                            },
                        )
                    }
                    LabeledRow("Rule", null, onClick = { nav.go(RuleRoute(detail.ruleId)) })
                    detail.jobRunId?.let { job -> LabeledRow("Job run", null, onClick = { nav.go(JobRunRoute(job)) }) }
                }
                // Rule runs have no full-log endpoint; the slice from 0 is all of it.
                logSection(runId, live, fetch = { id, offset ->
                    val out = c.call(AdminApi.rulesRunLog, Admin.RulesRunLogInput(id, offset))
                    LogSlice(out.chunk, out.nextOffset.toLong(), out.size.toLong())
                }, full = { id -> c.call(AdminApi.rulesRunLog, Admin.RulesRunLogInput(id, 0)).chunk })
            }
        }
    }
    ActionErrorDialog(error)
}
