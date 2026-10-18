// Choosing tonight's films: presets, genres, length and era, with the count
// of what they leave updating as you pick — a room of zero films can't be
// started. The last choice is remembered, since a household tends to want the
// same evening twice.
package dev.tinkerbell.portal.match

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.tinkerbell.api.ApiError
import dev.tinkerbell.model.MatchFilters
import dev.tinkerbell.model.Portal
import dev.tinkerbell.model.PortalApi
import dev.tinkerbell.platform.ui.ActionErrorDialog
import dev.tinkerbell.platform.ui.ChipFlow
import dev.tinkerbell.platform.ui.Nav
import dev.tinkerbell.platform.ui.SectionHeader
import dev.tinkerbell.platform.ui.TbScreen
import dev.tinkerbell.platform.ui.rememberActionError
import dev.tinkerbell.platform.ui.rememberHaptics
import dev.tinkerbell.portal.LocalPortal
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Year

private val lengths = listOf("Any length" to 0L, "Under 90 min" to 90L, "Under 2 hours" to 120L, "Under 2½ hours" to 150L)

private enum class Era(val label: String, val years: Long?) {
    ANY("Any year", null), FIVE("Last 5 years", 5), TEN("Last 10 years", 10), TWENTY("Last 20 years", 20), CLASSIC("Before 2000", null)
}

private data class Choice(val genres: List<String>, val maxMinutes: Long, val era: Era) {
    fun filters(): Portal.MatchCreateInput.Filters = Portal.MatchCreateInput.Filters(
        genres = genres.ifEmpty { null },
        maxMinutes = maxMinutes.takeIf { it > 0 },
        minYear = era.years?.let { Year.now().value - it },
        maxYear = if (era == Era.CLASSIC) 1999 else null,
    )
}

private const val LAST_KEY = "tb.match.lastFilters"

@Composable
fun NewRoomScreen(sectionId: String, onBack: () -> Unit, onCreated: (String) -> Unit) {
    val model = LocalPortal.current
    val prefs = LocalContext.current.getSharedPreferences("tinkerbell", Context.MODE_PRIVATE)
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val error = rememberActionError()
    var choice by remember { mutableStateOf(restore(prefs.getString(LAST_KEY, null))) }
    var available by remember { mutableStateOf<List<String>?>(null) }
    var presets by remember { mutableStateOf(emptyList<Portal.MatchPresetsItem>()) }
    var count by remember { mutableStateOf<Double?>(null) }
    var creating by remember { mutableStateOf(false) }

    fun create(filters: Portal.MatchCreateInput.Filters) {
        creating = true
        prefs.edit().putString(LAST_KEY, "${choice.genres.joinToString("\u001f")}|${choice.maxMinutes}|${choice.era.name}").apply()
        scope.launch {
            try {
                val room = model.client.call(PortalApi.matchCreate, Portal.MatchCreateInput(sectionId, filters))
                haptics.confirm()
                onCreated(room.code)
            } catch (e: ApiError) {
                error.value = e
            } finally {
                creating = false
            }
        }
    }

    LaunchedEffect(sectionId) {
        val loaded = try {
            model.client.call(PortalApi.matchGenres, Portal.MatchGenresInput(sectionId))
        } catch (e: ApiError) {
            emptyList()
        }
        available = loaded
        // A remembered genre this library doesn't have would filter to nothing.
        choice = choice.copy(genres = choice.genres.filter { it in loaded })
        presets = try {
            model.client.call(PortalApi.matchPresets, Portal.MatchPresetsInput(sectionId))
        } catch (e: ApiError) {
            emptyList()
        }
    }
    LaunchedEffect(choice) {
        delay(250)
        val f = choice.filters()
        count = try {
            model.client.call(
                PortalApi.matchCount,
                Portal.MatchCountInput(sectionId, Portal.MatchCountInput.Filters(f.genres, f.maxMinutes, f.minYear, f.maxYear, f.minRating, f.maxRating)),
            )
        } catch (e: ApiError) {
            null
        }
    }

    TbScreen("New Room", nav = Nav.BACK, onNav = onBack) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            Button(
                onClick = { create(choice.filters()) },
                enabled = !creating && count != 0.0,
                modifier = Modifier.fillMaxWidth().padding(16.dp).testTag("create-room"),
            ) {
                Text(if (creating) "Starting…" else count?.let { "Start the room · ${it.toLong()} films" } ?: "Start the room")
            }

            if (presets.isNotEmpty()) {
                SectionHeader("Or try one of these")
                for (preset in presets) {
                    ListItem(
                        headlineContent = { Text(preset.label) },
                        trailingContent = { Text("${preset.count}") },
                        modifier = Modifier.clickable(enabled = !creating) { create(createFilters(preset.filters)) },
                    )
                }
            }

            SectionHeader("Genres")
            val genres = available
            if (genres == null) {
                CircularProgressIndicator(Modifier.padding(16.dp))
            } else {
                ChipFlow {
                    FilterChip(selected = choice.genres.isEmpty(), onClick = { haptics.tick(); choice = choice.copy(genres = emptyList()) }, label = { Text("Any") })
                    for (genre in genres) {
                        val on = genre in choice.genres
                        FilterChip(
                            selected = on,
                            onClick = {
                                haptics.tick()
                                choice = choice.copy(genres = if (on) choice.genres - genre else choice.genres + genre)
                            },
                            label = { Text(genre) },
                        )
                    }
                }
            }

            SectionHeader("Length")
            ChipFlow {
                for ((label, value) in lengths) {
                    FilterChip(selected = choice.maxMinutes == value, onClick = { haptics.tick(); choice = choice.copy(maxMinutes = value) }, label = { Text(label) })
                }
            }

            SectionHeader("Released")
            ChipFlow {
                for (era in Era.entries) {
                    FilterChip(selected = choice.era == era, onClick = { haptics.tick(); choice = choice.copy(era = era) }, label = { Text(era.label) })
                }
            }
        }
    }
    ActionErrorDialog(error)
}

private fun restore(raw: String?): Choice {
    val parts = raw?.split('|') ?: return Choice(emptyList(), 0, Era.ANY)
    return Choice(
        genres = parts.getOrNull(0)?.split('\u001f')?.filter { it.isNotEmpty() }.orEmpty(),
        maxMinutes = parts.getOrNull(1)?.toLongOrNull() ?: 0,
        era = Era.entries.firstOrNull { it.name == parts.getOrNull(2) } ?: Era.ANY,
    )
}

private fun createFilters(f: MatchFilters) = Portal.MatchCreateInput.Filters(
    genres = f.genres,
    maxMinutes = f.maxMinutes?.toLong(),
    minYear = f.minYear?.toLong(),
    maxYear = f.maxYear?.toLong(),
    minRating = f.minRating,
    maxRating = f.maxRating,
)
