// "Your tastes": a native form over `preferences.get`, saved as you go.
//
// Autosave, like the web form and like the phone's own Settings: the web once
// had a Save button and an edit made there was lost without a word when you
// switched tabs before pressing it. Debounced so a run of chip taps is one
// request, and held back while the digest has no address — which is said
// beside the field instead. From `apps/portal/src/tabs/PreferencesForm.tsx`.
@file:OptIn(ExperimentalMaterial3Api::class)

package fyi.rube.portal

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import fyi.rube.api.ApiError
import fyi.rube.api.TastesPayload
import fyi.rube.model.Portal
import fyi.rube.model.PortalApi
import fyi.rube.model.WireJson
import fyi.rube.platform.ui.ChipFlow
import fyi.rube.platform.ui.LoadState
import fyi.rube.platform.ui.LoadStateView
import fyi.rube.platform.ui.PartMenu
import fyi.rube.platform.ui.SectionHeader
import fyi.rube.platform.ui.TbScreen
import fyi.rube.platform.ui.Tones
import fyi.rube.platform.ui.error
import fyi.rube.platform.ui.next
import fyi.rube.platform.ui.rememberHaptics
import fyi.rube.platform.ui.value
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

internal typealias Prefs = Portal.PreferencesGetOutput.Preferences
private typealias Bias = Portal.PreferencesGetOutput.Preferences.WatchedBias
private typealias Frequency = Portal.PreferencesGetOutput.Preferences.Digest.Frequency

internal enum class GenreLevel(val label: String) {
    NONE("No preference"), LOVED("Love"), LIKED("Like"), HATED("Avoid");

    /** A tap moves a chip one step along: none → love → like → avoid → none. */
    val next: GenreLevel get() = entries[(ordinal + 1) % entries.size]

    val icon: ImageVector?
        get() = when (this) {
            NONE -> null
            LOVED -> Icons.Filled.Favorite
            LIKED -> Icons.Outlined.ThumbUp
            HATED -> Icons.Filled.Block
        }

    companion object {
        fun of(genre: String, p: Prefs): GenreLevel = when (genre) {
            in p.genres.loved -> LOVED
            in p.genres.liked -> LIKED
            in p.genres.hated -> HATED
            else -> NONE
        }

        fun set(genre: String, level: GenreLevel, p: Prefs): Prefs {
            val g = p.genres
            fun List<String>.without() = filter { it != genre }
            return p.copy(
                genres = g.copy(
                    loved = g.loved.without() + if (level == LOVED) listOf(genre) else emptyList(),
                    liked = g.liked.without() + if (level == LIKED) listOf(genre) else emptyList(),
                    hated = g.hated.without() + if (level == HATED) listOf(genre) else emptyList(),
                ),
            )
        }
    }
}

internal val moodOptions = listOf(
    "Cosy", "Feel-good", "Mind-bending", "Intense", "Dark", "Uplifting", "Nostalgic", "Suspenseful", "Funny",
    "Romantic", "Epic", "Gritty", "Heartwarming", "Thought-provoking", "Action-packed", "Relaxing", "Quirky", "Tear-jerker",
)

private sealed interface SaveStatus {
    data object Idle : SaveStatus
    data object Saving : SaveStatus
    data object Saved : SaveStatus
    data class Failed(val message: String) : SaveStatus
}

@Composable
internal fun TastesScreen() {
    val model = LocalPortal.current
    val haptics = rememberHaptics()
    var state by remember { mutableStateOf<LoadState<Portal.PreferencesGetOutput>>(LoadState.Loading) }
    var genres by remember { mutableStateOf(emptyList<String>()) }
    var draft by remember { mutableStateOf<Prefs?>(null) }
    var optedIn by remember { mutableStateOf(false) }
    // What was last loaded or saved, to tell an edit from a reload.
    var savedKey by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<SaveStatus>(SaveStatus.Idle) }
    var searching by remember { mutableStateOf(false) }
    val show = model.components

    // The form as a comparable value: the draft and the opt-in together.
    val key = draft?.let { "$optedIn|" + WireJson.encoder.encodeToString(Prefs.serializer(), it) }

    suspend fun load() {
        state = state.next { model.client.call(PortalApi.preferencesGet) }
        if (state.error is ApiError.Forbidden) {
            model.componentWentAway()
            return
        }
        val loaded = state.value ?: return
        genres = try {
            model.client.call(PortalApi.availableGenres)
        } catch (e: ApiError) {
            emptyList()
        }
        draft = loaded.preferences
        optedIn = loaded.optedIn
        savedKey = "${loaded.optedIn}|" + WireJson.encoder.encodeToString(Prefs.serializer(), loaded.preferences)
    }

    suspend fun save(sent: String) {
        val p = draft ?: return
        val c = show ?: return
        status = SaveStatus.Saving
        try {
            model.client.call(PortalApi.preferencesSet, Portal.PreferencesSetInput(TastesPayload.make(p, c), optedIn))
            savedKey = sent
            status = SaveStatus.Saved
            haptics.confirm()
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiError.Forbidden) {
            status = SaveStatus.Idle
            model.componentWentAway()
        } catch (e: ApiError) {
            status = if (e is ApiError.Cancelled) SaveStatus.Idle else SaveStatus.Failed(e.message)
        }
    }

    LaunchedEffect(Unit) { if (state.value == null) load() }
    // Debounced autosave: a new key cancels the pending save and starts the wait again.
    LaunchedEffect(key) {
        val p = draft ?: return@LaunchedEffect
        val c = show ?: return@LaunchedEffect
        if (savedKey == null || key == null || key == savedKey) return@LaunchedEffect
        if (TastesPayload.digestNeedsEmail(p, c)) {
            status = SaveStatus.Idle
            return@LaunchedEffect
        }
        delay(700)
        save(key)
    }

    TbScreen("Your Tastes", actions = { PartMenu() }) {
        LoadStateView(state, onRetry = { model.scope.launch { load() } }) {
            val p = draft ?: return@LoadStateView
            fun edit(change: (Prefs) -> Prefs) {
                draft = change(p)
            }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(bottom = 24.dp)) {
                ListItem(
                    headlineContent = { Text("Personalize my home screen") },
                    supportingContent = {
                        Text(
                            when (val s = status) {
                                SaveStatus.Idle -> "Changes save automatically."
                                SaveStatus.Saving -> "Saving…"
                                SaveStatus.Saved -> "Saved"
                                is SaveStatus.Failed -> "Couldn't save: ${s.message}"
                            },
                            modifier = Modifier.testTag("save-status"),
                        )
                    },
                    trailingContent = { Switch(checked = optedIn, onCheckedChange = { optedIn = it; haptics.toggle(it) }) },
                )

                if (show?.tastesGenres == true) {
                    SectionHeader("Genres")
                    if (genres.isEmpty()) {
                        Text("No genres available.", Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        ChipFlow {
                            for (genre in genres) GenreChip(genre, GenreLevel.of(genre, p)) { level ->
                                haptics.tick()
                                edit { GenreLevel.set(genre, level, it) }
                            }
                        }
                    }
                    Hint("Tap a genre to change it: Love, Like, Avoid, then no preference.")
                }

                if (show?.tastesMoods == true) {
                    SectionHeader("Moods")
                    ChipFlow {
                        for (mood in moodOptions) {
                            val on = mood in p.moods
                            FilterChip(
                                selected = on,
                                onClick = {
                                    haptics.tick()
                                    edit { it.copy(moods = if (on) it.moods - mood else it.moods + mood) }
                                },
                                label = { Text(mood) },
                            )
                        }
                    }
                    Hint("Recommendations lean toward these.")
                }

                if (show?.tastesNeverRecommend == true) {
                    SectionHeader("Never recommend")
                    for (title in p.excludedTitles) {
                        ListItem(
                            headlineContent = { Text(title) },
                            trailingContent = {
                                IconButton(onClick = { edit { it.copy(excludedTitles = it.excludedTitles - title) } }) {
                                    Icon(Icons.Outlined.Close, contentDescription = "Remove $title")
                                }
                            },
                        )
                    }
                    TextButton(onClick = { searching = true }, modifier = Modifier.padding(horizontal = 8.dp)) {
                        Icon(Icons.Outlined.Add, contentDescription = null)
                        Text("Add a title", Modifier.padding(start = 8.dp))
                    }
                }

                if (show?.tastesRatingFloor == true) {
                    SectionHeader("Minimum rating")
                    Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Slider(
                            value = (p.ratingFloor ?: 0.0).toFloat(),
                            onValueChange = { v -> edit { it.copy(ratingFloor = (Math.round(v * 2) / 2.0).takeIf { r -> r > 0 }) } },
                            valueRange = 0f..10f,
                            steps = 19,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            p.ratingFloor?.takeIf { it > 0 }?.let { String.format(Locale.US, "%.1f", it) } ?: "Any",
                            Modifier.width(48.dp).padding(start = 12.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                if (show?.tastesRowCount == true) {
                    ListItem(
                        headlineContent = { Text("Rows on my home") },
                        supportingContent = { Text(p.rowCount?.toString() ?: "Auto") },
                        trailingContent = {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilledTonalIconButton(onClick = { edit { it.copy(rowCount = maxOf(1, (it.rowCount ?: 2) - 1)) } }) {
                                    Icon(Icons.Filled.Remove, contentDescription = "Fewer rows")
                                }
                                FilledTonalIconButton(onClick = { edit { it.copy(rowCount = minOf(20, (it.rowCount ?: 0) + 1)) } }) {
                                    Icon(Icons.Outlined.Add, contentDescription = "More rows")
                                }
                            }
                        },
                    )
                }

                if (show?.tastesWatchedBias == true) {
                    SectionHeader("Watched bias")
                    val options = listOf(Bias.BALANCED to "Balanced", Bias.NEW_TO_ME to "New to me", Bias.INCLUDE_FAVORITES to "Favourites")
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                        options.forEachIndexed { i, (bias, label) ->
                            SegmentedButton(
                                selected = p.watchedBias == bias,
                                onClick = { haptics.tick(); edit { it.copy(watchedBias = bias) } },
                                shape = SegmentedButtonDefaults.itemShape(i, options.size),
                            ) { Text(label) }
                        }
                    }
                    Hint(
                        when (p.watchedBias) {
                            Bias.NEW_TO_ME -> "Favour titles you probably haven't watched yet."
                            Bias.INCLUDE_FAVORITES -> "Also resurface titles you've watched and loved."
                            else -> "A mix of new titles and ones you've watched before."
                        },
                    )
                }

                if (show?.tastesStrictHate == true) {
                    ListItem(
                        headlineContent = { Text("Never show genres I avoid") },
                        supportingContent = { Text("Off, they're just shown less often.") },
                        trailingContent = { Switch(checked = p.strictHate, onCheckedChange = { v -> haptics.toggle(v); edit { it.copy(strictHate = v) } }) },
                    )
                }

                if (show?.tastesDigest == true) {
                    SectionHeader("Email digest")
                    val options = listOf(Frequency.NEVER to "Never", Frequency.WEEKLY to "Weekly", Frequency.MONTHLY to "Monthly")
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                        options.forEachIndexed { i, (f, label) ->
                            SegmentedButton(
                                selected = p.digest.frequency == f,
                                onClick = { haptics.tick(); edit { it.copy(digest = it.digest.copy(frequency = f)) } },
                                shape = SegmentedButtonDefaults.itemShape(i, options.size),
                            ) { Text(label) }
                        }
                    }
                    if (p.digest.frequency != Frequency.NEVER) {
                        OutlinedTextField(
                            value = p.digest.email,
                            onValueChange = { v -> edit { it.copy(digest = it.digest.copy(email = v)) } },
                            label = { Text("Email") },
                            placeholder = { Text("you@example.com") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                    }
                    if (show.let { TastesPayload.digestNeedsEmail(p, it) }) {
                        Hint("Add an address to get the digest, or choose Never.", Tones.warning)
                    } else {
                        Hint("What's new, what's popular, and what's leaving.")
                    }
                }
            }
            if (searching) {
                TitleSearchSheet(excluded = p.excludedTitles, onDismiss = { searching = false }) { title ->
                    if (title !in p.excludedTitles) edit { it.copy(excludedTitles = it.excludedTitles + title) }
                    searching = false
                }
            }
        }
    }
}

@Composable
private fun Hint(text: String, color: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = color, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
}

@Composable
private fun GenreChip(genre: String, level: GenreLevel, onChange: (GenreLevel) -> Unit) {
    FilterChip(
        selected = level != GenreLevel.NONE,
        onClick = { onChange(level.next) },
        label = { Text(genre) },
        leadingIcon = level.icon?.let { { Icon(it, contentDescription = null) } },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = when (level) {
                GenreLevel.LOVED -> Tones.like.copy(alpha = 0.3f)
                GenreLevel.HATED -> MaterialTheme.colorScheme.surfaceContainerHighest
                else -> MaterialTheme.colorScheme.secondaryContainer
            },
        ),
        modifier = Modifier.semantics { contentDescription = "$genre: ${level.label}" },
    )
}

/** Search the library for a title to never recommend. */
@Composable
private fun TitleSearchSheet(excluded: List<String>, onDismiss: () -> Unit, add: (String) -> Unit) {
    val model = LocalPortal.current
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf(emptyList<String>()) }
    LaunchedEffect(query) {
        val q = query.trim()
        if (q.length < 2) {
            results = emptyList()
            return@LaunchedEffect
        }
        delay(250)
        results = try {
            model.client.call(PortalApi.searchTitles, Portal.SearchTitlesInput(q))
        } catch (e: ApiError) {
            emptyList()
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().imePadding()) {
            Text("Never recommend", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 16.dp))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                placeholder = { Text("Search titles") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(16.dp),
            )
            val typed = query.trim()
            LazyColumn(Modifier.fillMaxWidth()) {
                if (typed.length < 2 && results.isEmpty()) {
                    item { Hint("Type at least two letters.") }
                }
                items(results.filter { it !in excluded }) { title ->
                    ListItem(headlineContent = { Text(title) }, modifier = Modifier.clickable { add(title) })
                }
                if (typed.isNotEmpty() && typed !in results) {
                    item {
                        ListItem(
                            headlineContent = { Text("Add “$typed”") },
                            leadingContent = { Icon(Icons.Outlined.Add, contentDescription = null) },
                            modifier = Modifier.clickable { add(typed) },
                        )
                    }
                }
            }
        }
    }
}
