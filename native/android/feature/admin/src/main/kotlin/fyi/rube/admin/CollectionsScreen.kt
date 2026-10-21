// Collections and the media in them, read-mostly: what a rule built, how it
// is doing, why a film is in it, who watched it. Paged by the server, since a
// large library has hundreds of collections.
package fyi.rube.admin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
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
import fyi.rube.api.MatchText
import fyi.rube.model.Admin
import fyi.rube.model.AdminApi
import fyi.rube.platform.ui.ActionErrorDialog
import fyi.rube.platform.ui.EmptyState
import fyi.rube.platform.ui.ErrorState
import fyi.rube.platform.ui.Format
import fyi.rube.platform.ui.LabeledRow
import fyi.rube.platform.ui.LoadState
import fyi.rube.platform.ui.LoadStateView
import fyi.rube.platform.ui.Nav
import fyi.rube.platform.ui.PartMenu
import fyi.rube.platform.ui.RemoteImage
import fyi.rube.platform.ui.SectionHeader
import fyi.rube.platform.ui.TbScreen
import fyi.rube.platform.ui.clickableRow
import fyi.rube.platform.ui.next
import fyi.rube.platform.ui.rememberActionError
import fyi.rube.platform.ui.rememberHaptics
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import java.util.Locale

private const val PAGE = 50L

/**
 * A server-paged list: the next page loads as the end scrolls into view, and
 * a new search starts again from the top. Shared by collections and users.
 */
internal class Paged<T>(private val fetch: suspend (offset: Long, search: String?) -> Pair<List<T>, Long>) {
    val items = mutableStateListOf<T>()
    var total by mutableStateOf<Long?>(null)
    var error by mutableStateOf<ApiError?>(null)
    var loading by mutableStateOf(false)

    suspend fun more(search: String) {
        if (loading || (total != null && items.size >= total!!)) return
        loading = true
        try {
            val (page, count) = fetch(items.size.toLong(), search.trim().ifEmpty { null })
            items += page
            total = count
            error = null
        } catch (e: ApiError) {
            if (e !is ApiError.Cancelled) error = e
        } finally {
            loading = false
        }
    }

    suspend fun reload(search: String) {
        items.clear()
        total = null
        more(search)
    }
}

@Composable
internal fun CollectionsScreen() {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    var search by rememberSaveable { mutableStateOf("") }
    val paged = remember {
        Paged { offset, q ->
            val page = model.client.call(AdminApi.collectionsList, Admin.CollectionsListInput(offset = offset, limit = PAGE, search = q))
            page.items to page.total
        }
    }
    val list = rememberLazyListState()

    LaunchedEffect(search) {
        if (search.isNotEmpty()) delay(300)
        paged.reload(search)
    }
    LaunchedEffect(list) {
        snapshotFlow { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .filter { paged.items.isNotEmpty() && it >= paged.items.size - 5 }
            .collect { paged.more(search) }
    }

    TbScreen("Collections", actions = { PartMenu() }, onRefresh = { paged.reload(search) }) {
        LazyColumn(Modifier.fillMaxSize(), state = list) {
            item { SearchField(search, "Search collections") { search = it } }
            paged.error?.takeIf { paged.items.isEmpty() }?.let { e -> item { ErrorState(e, onRetry = { model.scope.launch { paged.reload(search) } }) } }
            items(paged.items, key = { it.plexRatingKey }) { c ->
                ListItem(
                    leadingContent = { RemoteImage(model.image(c.thumb), Modifier.size(width = 44.dp, height = 66.dp), corner = 4.dp) },
                    headlineContent = { Text(c.title) },
                    supportingContent = {
                        Column {
                            Text("${c.sectionTitle} · ${c.childCount} items${if (c.smart != 0.0) " · Smart" else ""}")
                            c.performance?.takeIf { it.plays > 0 }?.let { Text("${it.plays} plays · ${it.viewers.toLong()} viewers", style = MaterialTheme.typography.bodySmall) }
                        }
                    },
                    modifier = Modifier.clickableRow { nav.go(CollectionRoute(c.plexRatingKey, c.title)) },
                )
            }
            if (paged.loading) item { CircularProgressIndicator(Modifier.padding(24.dp)) }
            if (paged.total == 0L) item { EmptyState(Icons.Outlined.Search, "No collections", if (search.isBlank()) null else "Nothing matches “$search”.") }
        }
    }
}

@Composable
internal fun SearchField(value: String, placeholder: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
        placeholder = { Text(placeholder) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
internal fun CollectionDetailScreen(ratingKey: String, title: String) {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val haptics = rememberHaptics()
    val error = rememberActionError()
    var collection by remember { mutableStateOf<LoadState<Admin.CollectionsGetOutput>>(LoadState.Loading) }
    var stats by remember { mutableStateOf<Admin.CollectionsStatsOutput?>(null) }
    var members by remember { mutableStateOf(emptyList<Admin.CollectionsItemsItem>()) }
    var syncing by remember { mutableStateOf(false) }
    val c = model.client

    suspend fun load() {
        collection = collection.next { c.call(AdminApi.collectionsGet, Admin.CollectionsGetInput(ratingKey)) }
        stats = quietly(stats) { c.call(AdminApi.collectionsStats, Admin.CollectionsStatsInput(ratingKey)) }
        members = quietly(members) { c.call(AdminApi.collectionsItems, Admin.CollectionsItemsInput(ratingKey)) }
    }

    LaunchedEffect(ratingKey) { load() }
    TbScreen(
        title,
        nav = Nav.BACK,
        onNav = { nav.back() },
        onRefresh = { load() },
        actions = {
            IconButton(
                enabled = !syncing,
                onClick = {
                    syncing = true
                    model.scope.launch {
                        try {
                            c.call(AdminApi.collectionsSyncOne, Admin.CollectionsSyncOneInput(ratingKey))
                            haptics.confirm()
                            load()
                        } catch (e: ApiError) {
                            error.value = e
                        } finally {
                            syncing = false
                        }
                    }
                },
            ) { Icon(Icons.Outlined.Sync, contentDescription = "Sync") }
        },
    ) {
        LoadStateView(collection, onRetry = { model.scope.launch { load() } }) { col ->
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        RemoteImage(model.image(col.thumb), Modifier.size(width = 90.dp, height = 135.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(col.sectionTitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("${col.childCount} items")
                            if (col.labels.isNotEmpty()) Text(col.labels.joinToString(", "), style = MaterialTheme.typography.bodySmall)
                            Text("Synced ${Format.relative(col.syncedAt)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (col.summary.isNotEmpty()) Text(col.summary, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodyMedium)
                }
                stats?.let { s ->
                    item {
                        SectionHeader("Stats")
                        LabeledRow("Runtime", Durations.short(s.totalRuntimeMs.toDouble()))
                        s.yearRange?.let { LabeledRow("Years", "${it.from.toLong()}–${it.to.toLong()}") }
                        s.watchedFraction?.let { LabeledRow("Watched", "${(it * 100).toLong()}%") }
                        s.performance?.let { LabeledRow("Plays", "${it.plays} by ${it.viewers.toLong()} viewers") }
                        if (s.topGenres.isNotEmpty()) LabeledRow("Top genres", s.topGenres.take(3).joinToString(", ") { it.genre })
                    }
                }
                item { SectionHeader("Items") }
                items(members.chunked(3)) { row ->
                    Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        for (m in row) {
                            Column(Modifier.weight(1f).clickable { nav.go(MediaRoute(m.ratingKey, m.title)) }) {
                                RemoteImage(model.image(m.thumb), Modifier.fillMaxWidth().aspectRatio(2f / 3f), corner = 6.dp)
                                Text(m.title, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
                item { WebAdminRow("/collections/$ratingKey") }
            }
        }
    }
    ActionErrorDialog(error)
}

@Composable
internal fun MediaDetailScreen(ratingKey: String, title: String) {
    val model = LocalAdmin.current
    val nav = LocalAdminNav.current
    val haptics = rememberHaptics()
    val error = rememberActionError()
    val snackbar = remember { SnackbarHostState() }
    var media by remember { mutableStateOf<LoadState<Admin.MediaGetOutput>>(LoadState.Loading) }
    var why by remember { mutableStateOf(emptyList<Admin.MediaWhyItem>()) }
    var children by remember { mutableStateOf(emptyList<Admin.MediaChildrenItem>()) }
    var watchedBy by remember { mutableStateOf(emptyList<Admin.StatsWatchedByItem>()) }
    val c = model.client

    suspend fun load() {
        media = media.next { c.call(AdminApi.mediaGet, Admin.MediaGetInput(ratingKey)) }
        why = quietly(why) { c.call(AdminApi.mediaWhy, Admin.MediaWhyInput(ratingKey)) }
        children = quietly(children) { c.call(AdminApi.mediaChildren, Admin.MediaChildrenInput(ratingKey)) }
        watchedBy = quietly(watchedBy) { c.call(AdminApi.statsWatchedBy, Admin.StatsWatchedByInput(ratingKey)) }
    }

    LaunchedEffect(ratingKey) { load() }
    val loaded = (media as? LoadState.Loaded)?.value
    TbScreen(loaded?.title ?: title, nav = Nav.BACK, onNav = { nav.back() }, snackbar = snackbar, onRefresh = { load() }) {
        LoadStateView(media, onRetry = { model.scope.launch { load() } }) { m ->
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        RemoteImage(model.image(m.thumb), Modifier.size(width = 100.dp, height = 150.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(listOfNotNull(m.year?.toString(), m.contentRating, MatchText.runtime(m.duration)).joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            (m.rating ?: m.audienceRating)?.let { r ->
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Icon(Icons.Outlined.Star, contentDescription = "Rating", modifier = Modifier.size(18.dp))
                                    Text(String.format(Locale.US, "%.1f", r))
                                }
                            }
                            if (m.genres.isNotEmpty()) Text(m.genres.joinToString(", "), style = MaterialTheme.typography.bodySmall)
                            if (m.directors.isNotEmpty()) Text("Directed by ${m.directors.joinToString(", ")}", style = MaterialTheme.typography.bodySmall)
                            m.viewCount?.takeIf { it > 0 }?.let { Text("Played $it×", style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                    if (m.summary.isNotEmpty()) Text(m.summary, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodyMedium)
                }
                m.media.firstOrNull()?.let { file ->
                    item {
                        SectionHeader("File")
                        (file.videoResolution ?: m.videoResolution)?.let { LabeledRow("Resolution", it.uppercase()) }
                        LabeledRow("Video", listOfNotNull(file.videoCodec, file.videoProfile).joinToString(" "))
                        LabeledRow("Audio", listOfNotNull(file.audioCodec, file.audioChannels?.let { "${it.toLong()} ch" }).joinToString(" · "))
                        file.parts.firstNotNullOfOrNull { it.size }?.let { LabeledRow("Size", Format.bytes(it)) }
                    }
                }
                if (children.isNotEmpty()) {
                    item { SectionHeader(if (m.type == "show") "Seasons" else "Episodes") }
                    items(children, key = { "c-${it.ratingKey}" }) { child ->
                        LabeledRow(
                            child.title,
                            child.leafCount?.let { "$it episodes" } ?: child.index?.let { "#$it" } ?: "",
                            onClick = { nav.go(MediaRoute(child.ratingKey, child.title)) },
                        )
                    }
                }
                if (why.isNotEmpty()) {
                    item { SectionHeader("Why it's in its collections") }
                    items(why, key = { "w-${it.collection.ratingKey}" }) { w ->
                        ListItem(
                            headlineContent = { Text(w.collection.title) },
                            supportingContent = {
                                Column {
                                    w.rule?.let { Text("Rule: ${it.name}") }
                                    w.criteria?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                                }
                            },
                            modifier = Modifier.clickableRow { nav.go(CollectionRoute(w.collection.ratingKey, w.collection.title)) },
                        )
                    }
                }
                if (watchedBy.isNotEmpty()) {
                    item { SectionHeader("Watched by") }
                    items(watchedBy, key = { "u-${it.userId}" }) { w ->
                        LabeledRow(w.username, "${w.plays}× · ${w.maxCompletionPct.toLong()}%", onClick = { nav.go(UserRoute(w.userId, w.username)) })
                    }
                }
                item {
                    HorizontalSpace()
                    ListItem(
                        headlineContent = { Text("Protect from cleanup") },
                        leadingContent = { Icon(Icons.Outlined.Shield, contentDescription = null) },
                        modifier = Modifier.clickableRow {
                            model.scope.launch {
                                try {
                                    c.call(AdminApi.cleanupProtect, Admin.CleanupProtectInput(Admin.CleanupProtectInput.Kind.ITEM, ratingKey, label = m.title))
                                    haptics.confirm()
                                    snackbar.showSnackbar("Protected “${m.title}” from every cleanup rule.")
                                } catch (e: ApiError) {
                                    error.value = e
                                }
                            }
                        },
                    )
                    WebAdminRow("/media/$ratingKey")
                }
            }
        }
    }
    ActionErrorDialog(error)
}

@Composable
private fun HorizontalSpace() = Spacer(Modifier.padding(vertical = 8.dp))
