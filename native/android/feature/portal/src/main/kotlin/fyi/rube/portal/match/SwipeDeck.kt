// The cards. One shared order per room (the server's), dealt in pages of what
// this member hasn't seen; swiping is optimistic, so the next card is there
// before the server has answered, and a swipe the server refused is put back
// — a swipe the room never heard about didn't happen. From
// `apps/portal/src/match/SwipeDeck.tsx`, with a drag gesture for the pointer
// events and a haptic for the thump.
package fyi.rube.portal.match

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import fyi.rube.api.ApiError
import fyi.rube.api.MatchText
import fyi.rube.model.Portal
import fyi.rube.model.PortalApi
import fyi.rube.platform.ui.EmptyState
import fyi.rube.platform.ui.RemoteImage
import fyi.rube.platform.ui.Tones
import fyi.rube.platform.ui.rememberHaptics
import kotlinx.coroutines.launch
import kotlin.math.abs

internal typealias Film = Portal.MatchDeckOutput.Film

private const val PAGE = 20L

/** Fetch the next page when this few cards are left in hand. */
private const val LOW_WATER = 5

@Composable
internal fun SwipeDeck(
    room: RoomContext,
    code: String,
    roomState: RoomState,
    onMatched: (String) -> Unit,
    refresh: suspend () -> Unit,
    /** Asks the room to reset, which confirms first and rebuilds this deck. */
    startOver: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val context = LocalContext.current
    val density = LocalDensity.current
    val cards = remember { mutableStateListOf<Film>() }
    var remaining by remember { mutableStateOf<Long?>(null) }
    var last by remember { mutableStateOf<Pair<Film, Boolean>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var dealing by remember { mutableStateOf(false) }
    var flinging by remember { mutableStateOf(false) }
    val offsetX = remember { Animatable(0f) }
    val offsetY = remember { Animatable(0f) }
    // How far a card travels before it counts as a swipe, not a wobble.
    val threshold = with(density) { 110.dp.toPx() }
    var pastThreshold by remember { mutableStateOf(false) }

    suspend fun deal() {
        if (dealing) return
        dealing = true
        try {
            val held = cards.map { it.ratingKey }
            val page = room.client.call(PortalApi.matchDeck, Portal.MatchDeckInput(code, held, PAGE))
            val have = held.toSet()
            cards.addAll(page.films.filter { it.ratingKey !in have })
            remaining = page.remaining - page.films.size
            error = null
        } catch (e: ApiError) {
            if (e !is ApiError.Cancelled) error = e.message
        } finally {
            dealing = false
        }
    }

    fun commit(film: Film, liked: Boolean) {
        cards.removeAll { it.ratingKey == film.ratingKey }
        last = film to liked
        scope.launch {
            offsetX.snapTo(0f)
            offsetY.snapTo(0f)
            flinging = false
            try {
                val result = room.client.call(PortalApi.matchSwipe, Portal.MatchSwipeInput(code, film.ratingKey, liked))
                if (result.matched) onMatched(film.ratingKey)
                refresh()
            } catch (e: ApiError) {
                cards.add(0, film)
                last = null
                error = e.message
            }
        }
    }

    fun swipe(liked: Boolean) {
        val film = cards.firstOrNull() ?: return
        if (flinging) return
        flinging = true
        if (liked) haptics.confirm() else haptics.reject()
        scope.launch {
            launch { offsetY.animateTo(offsetY.value + 120f, tween(250)) }
            offsetX.animateTo(if (liked) 2200f else -2200f, tween(250))
            commit(film, liked)
        }
    }

    fun undo() {
        val (film, _) = last ?: return
        last = null
        cards.removeAll { it.ratingKey == film.ratingKey }
        cards.add(0, film)
        haptics.tick()
        scope.launch {
            try {
                room.client.call(PortalApi.matchUndo, Portal.MatchUndoInput(code, film.ratingKey))
                refresh()
            } catch (e: ApiError) {
                error = e.message
            }
        }
    }

    LaunchedEffect(Unit) { if (remaining == null) deal() }
    LaunchedEffect(cards.size) {
        if (cards.size < LOW_WATER && (remaining ?: 1) > 0) deal()
        // Fetch ahead — the next cards in a deck — so a swipe never reveals a blank one.
        val loader = SingletonImageLoader.get(context)
        for (film in cards.drop(1).take(3)) {
            room.poster(film.poster)?.let { loader.enqueue(ImageRequest.Builder(context).data(it).build()) }
        }
    }

    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.weight(1f).fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
            if (cards.isEmpty()) {
                if (remaining == 0L) {
                    EmptyState(
                        Icons.Outlined.Verified,
                        "That's every film in this room.",
                        "See what everyone agreed on, or go round again.",
                        actionLabel = "Start over",
                        onAction = startOver,
                    )
                } else {
                    Box(
                        Modifier.aspectRatio(2f / 3f, matchHeightConstraintsFirst = true).clip(RoundedCornerShape(24.dp))
                            .background(MaterialTheme.colorScheme.surfaceContainerHigh),
                        contentAlignment = Alignment.Center,
                    ) { CircularProgressIndicator() }
                }
            }
            if (cards.size > 1) {
                FilmCard(cards[1], room.poster(cards[1].poster), likeAmount = 0f, modifier = Modifier.scale(0.95f))
            }
            cards.firstOrNull()?.let { top ->
                androidx.compose.runtime.key(top.ratingKey) {
                    FilmCard(
                        film = top,
                        poster = room.poster(top.poster),
                        likeAmount = offsetX.value / threshold,
                        modifier = Modifier
                            .testTag("swipe-card")
                            .semantics {
                                contentDescription = top.title
                                customActions = listOf(
                                    CustomAccessibilityAction("Like") { swipe(true); true },
                                    CustomAccessibilityAction("Skip") { swipe(false); true },
                                )
                            }
                            .graphicsLayer {
                                translationX = offsetX.value
                                translationY = offsetY.value
                                rotationZ = offsetX.value / 40f
                            }
                            .pointerInput(top.ratingKey) {
                                val velocity = VelocityTracker()
                                detectDragGestures(
                                    onDragStart = { velocity.resetTracking() },
                                    onDrag = { change, amount ->
                                        if (flinging) return@detectDragGestures
                                        change.consume()
                                        velocity.addPosition(change.uptimeMillis, change.position)
                                        scope.launch {
                                            offsetX.snapTo(offsetX.value + amount.x)
                                            offsetY.snapTo(offsetY.value + amount.y)
                                        }
                                        val past = abs(offsetX.value) > threshold
                                        if (past && !pastThreshold) haptics.threshold()
                                        pastThreshold = past
                                    },
                                    onDragEnd = {
                                        if (flinging) return@detectDragGestures
                                        pastThreshold = false
                                        val travel = offsetX.value
                                        val fling = velocity.calculateVelocity().x
                                        if (abs(travel) > threshold || (abs(travel) > threshold / 3 && abs(fling) > 1500f)) {
                                            swipe(liked = travel > 0)
                                        } else {
                                            scope.launch { offsetX.animateTo(0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy)) }
                                            scope.launch { offsetY.animateTo(0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy)) }
                                        }
                                    },
                                    onDragCancel = {
                                        pastThreshold = false
                                        scope.launch { offsetX.animateTo(0f); offsetY.animateTo(0f) }
                                    },
                                )
                            },
                    )
                }
            }
        }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }

        Row(horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.CenterVertically) {
            FilledTonalIconButton(
                onClick = { swipe(false) },
                enabled = cards.isNotEmpty() && !flinging,
                modifier = Modifier.size(72.dp).testTag("nope"),
                colors = IconButtonDefaults.filledTonalIconButtonColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer,
                ),
            ) { Icon(Icons.Filled.Close, contentDescription = "Skip", modifier = Modifier.size(32.dp)) }
            OutlinedIconButton(onClick = { undo() }, enabled = last != null, modifier = Modifier.size(52.dp).testTag("undo")) {
                Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = "Undo")
            }
            FilledIconButton(
                onClick = { swipe(true) },
                enabled = cards.isNotEmpty() && !flinging,
                modifier = Modifier.size(72.dp).testTag("like"),
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = Tones.like, contentColor = Color.White),
            ) { Icon(Icons.Filled.Favorite, contentDescription = "Like", modifier = Modifier.size(32.dp)) }
        }
        Text(
            "${roomState.me.liked} liked · ${roomState.me.swiped} of ${roomState.deckSize} films",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 12.dp).testTag("deck-progress"),
        )
    }
}

@Composable
private fun FilmCard(film: Film, poster: String?, likeAmount: Float, modifier: Modifier = Modifier) {
    Box(
        modifier
            .aspectRatio(2f / 3f, matchHeightConstraintsFirst = true)
            .clip(RoundedCornerShape(24.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
    ) {
        RemoteImage(poster, Modifier.fillMaxSize(), corner = 0.dp) {
            Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
                Text(film.title, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center, modifier = Modifier.padding(24.dp))
            }
        }
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.85f))))
        Column(Modifier.align(Alignment.BottomStart).padding(20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(film.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Color.White)
            val meta = MatchText.filmMeta(film.year, film.rating, film.durationMs, film.contentRating)
            if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodyMedium, color = Color.White)
            if (film.genres.isNotEmpty()) {
                Text(film.genres.take(3).joinToString(" · "), style = MaterialTheme.typography.labelLarge, color = Color.White)
            }
            if (film.summary.isNotEmpty()) {
                Text(film.summary, style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.9f))
            }
        }
        Stamp("LIKE", Color(0xFF3DDC84), -12f, Modifier.align(Alignment.TopStart).graphicsLayer { alpha = likeAmount.coerceIn(0f, 1f) })
        Stamp("NOPE", Color(0xFFFF5449), 12f, Modifier.align(Alignment.TopEnd).graphicsLayer { alpha = (-likeAmount).coerceIn(0f, 1f) })
    }
}

@Composable
private fun Stamp(text: String, color: Color, angle: Float, modifier: Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.displaySmall,
        fontWeight = FontWeight.Black,
        color = color,
        modifier = modifier
            .padding(28.dp)
            .graphicsLayer { rotationZ = angle }
            .border(4.dp, color, RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp),
    )
}
