// What the room agrees on: films everyone liked, then films more than one
// person liked, and a "Watch this" vote among them for when there's more than
// one contender. Fed by the room's poll, so it fills in as people swipe.
// From `apps/portal/src/match/Matches.tsx`.
@file:OptIn(ExperimentalMaterial3Api::class)

package fyi.rube.portal.match

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.HeartBroken
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import fyi.rube.api.ApiError
import fyi.rube.api.MatchText
import fyi.rube.model.Portal
import fyi.rube.model.PortalApi
import fyi.rube.platform.Links
import fyi.rube.platform.ui.EmptyState
import fyi.rube.platform.ui.RemoteImage
import fyi.rube.platform.ui.SectionHeader
import fyi.rube.platform.ui.Tones
import fyi.rube.platform.ui.rememberHaptics
import kotlinx.coroutines.launch

@Composable
internal fun MatchesList(room: RoomContext, code: String, roomState: RoomState, refresh: suspend () -> Unit) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var byRecent by remember { mutableStateOf(false) }
    var open by remember { mutableStateOf<MatchFilm?>(null) }
    val sorted = if (byRecent) roomState.matches.sortedByDescending { it.lastLikedAt } else roomState.matches

    // A null film withdraws the vote — the server wants the key present and null.
    fun vote(ratingKey: String?) {
        haptics.tick()
        scope.launch {
            try {
                room.client.call(PortalApi.matchVote, Portal.MatchVoteInput(code, ratingKey))
            } catch (_: ApiError) {
            }
            refresh()
        }
    }

    LazyColumn(Modifier.fillMaxSize()) {
        item { SectionHeader("Here") }
        items(roomState.members, key = { "m${it.id}" }) { member ->
            ListItem(
                leadingContent = {
                    Box(
                        Modifier.size(10.dp).background(
                            if (member.online) Tones.success else MaterialTheme.colorScheme.outlineVariant,
                            CircleShape,
                        ),
                    )
                },
                headlineContent = {
                    Text(member.name + when {
                        member.me -> " (you)"
                        member.guest -> " (guest)"
                        else -> ""
                    })
                },
                trailingContent = { Text("${member.swiped}/${roomState.deckSize}") },
            )
        }
        if (roomState.matches.isEmpty()) {
            item {
                EmptyState(
                    Icons.Outlined.HeartBroken,
                    "No matches yet",
                    "A film shows up here once more than one person likes it, and goes to the top when everyone does.",
                )
            }
        } else {
            item {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(16.dp)) {
                    SegmentedButton(selected = !byRecent, onClick = { byRecent = false }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Most liked") }
                    SegmentedButton(selected = byRecent, onClick = { byRecent = true }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("Recent") }
                }
                Text(
                    "${roomState.unanimousCount} everyone agreed on, from ${roomState.swipedCount} films seen",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            for ((title, films) in listOf("Everyone liked" to sorted.filter { it.unanimous }, "Some liked" to sorted.filter { !it.unanimous })) {
                if (films.isEmpty()) continue
                item { SectionHeader("$title · ${films.size}") }
                items(films, key = { it.ratingKey }) { film ->
                    val voters = roomState.votes.firstOrNull { it.ratingKey == film.ratingKey }?.voters.orEmpty()
                    val mine = roomState.myVote == film.ratingKey
                    Row(
                        Modifier.fillMaxWidth().clickable { open = film }.padding(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RemoteImage(room.poster(film.poster), Modifier.size(width = 56.dp, height = 84.dp), corner = 6.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(film.title, style = MaterialTheme.typography.titleMedium)
                            Text(film.likedBy.joinToString(", "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            FilterChip(
                                selected = mine,
                                onClick = { vote(if (mine) null else film.ratingKey) },
                                label = { Text((if (mine) "Your pick" else "Watch this") + if (voters.isEmpty()) "" else " · ${voters.size}") },
                                leadingIcon = if (mine) ({ Icon(Icons.Filled.Check, contentDescription = null) }) else null,
                                modifier = Modifier.testTag("vote-${film.ratingKey}"),
                            )
                        }
                    }
                }
            }
        }
    }

    open?.let { film -> FilmDetailSheet(film, room.poster(film.poster), roomState.plexServerId) { open = null } }
}

@Composable
private fun FilmDetailSheet(film: MatchFilm, poster: String?, serverId: String?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                RemoteImage(poster, Modifier.size(width = 120.dp, height = 180.dp), corner = 10.dp)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(film.title, style = MaterialTheme.typography.headlineSmall)
                    Text(MatchText.filmMeta(film.year, film.rating, film.durationMs, film.contentRating), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (film.genres.isNotEmpty()) Text(film.genres.joinToString(", "), style = MaterialTheme.typography.bodyMedium)
                }
            }
            Text("Liked by ${film.likedBy.joinToString(", ")}${if (film.unanimous) " — everyone." else "."}")
            if (serverId != null) {
                Button(onClick = { Links.openExternally(context, MatchText.plexLink(serverId, film.ratingKey)) }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.PlayCircle, contentDescription = null)
                    Text("Open in Plex", Modifier.padding(start = 8.dp))
                }
            }
            Box(Modifier.size(16.dp))
        }
    }
}
