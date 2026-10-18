// Swipe actions on a list row — the Android shape of iOS's `swipeActions`.
//
// Material's SwipeToDismissBox is built for removing a row; here a swipe runs
// an action and the row springs back, because none of these swipes (keep,
// protect, dismiss a problem) take the row away by themselves — the list's
// next load decides that. A haptic tick marks the point past which letting go
// will act, so a half-swipe is never a surprise.
package dev.tinkerbell.platform.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

data class SwipeAction(
    val label: String,
    val icon: ImageVector,
    val container: Color,
    val content: Color,
    val onSwipe: () -> Unit,
)

@Composable
fun SwipeActionsRow(
    modifier: Modifier = Modifier,
    start: SwipeAction? = null,
    end: SwipeAction? = null,
    content: @Composable () -> Unit,
) {
    if (start == null && end == null) {
        content()
        return
    }
    val state = rememberSwipeToDismissBoxState()
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    LaunchedEffect(state.targetValue) {
        if (state.targetValue != SwipeToDismissBoxValue.Settled) haptics.threshold()
    }
    SwipeToDismissBox(
        state = state,
        modifier = modifier,
        enableDismissFromStartToEnd = start != null,
        enableDismissFromEndToStart = end != null,
        onDismiss = { value ->
            val action = if (value == SwipeToDismissBoxValue.StartToEnd) start else end
            action?.onSwipe?.invoke()
            scope.launch { state.reset() }
        },
        backgroundContent = {
            val action = when (state.dismissDirection) {
                SwipeToDismissBoxValue.StartToEnd -> start
                SwipeToDismissBoxValue.EndToStart -> end
                SwipeToDismissBoxValue.Settled -> null
            }
            Box(
                Modifier.fillMaxSize().background(action?.container ?: Color.Transparent).padding(horizontal = 24.dp),
                contentAlignment = if (state.dismissDirection == SwipeToDismissBoxValue.StartToEnd) Alignment.CenterStart else Alignment.CenterEnd,
            ) {
                if (action != null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(action.icon, contentDescription = null, tint = action.content)
                        Text(action.label, color = action.content, style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        },
    ) {
        Surface(color = MaterialTheme.colorScheme.surface) { content() }
    }
}
