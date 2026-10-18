// The states every screen that fetches is in, and the stock views for them.
// One place, because the web learned the hard way that "the request failed"
// and "you have nothing" must never be the same screen — an unreachable
// server used to render as an empty list.
package dev.tinkerbell.platform.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.tinkerbell.api.ApiError
import kotlin.coroutines.cancellation.CancellationException

sealed interface LoadState<out T> {
    data object Loading : LoadState<Nothing>
    data class Loaded<T>(val value: T) : LoadState<T>
    data class Failed(val error: ApiError) : LoadState<Nothing>
}

val <T> LoadState<T>.value: T? get() = (this as? LoadState.Loaded<T>)?.value
val <T> LoadState<T>.error: ApiError? get() = (this as? LoadState.Failed)?.error

/**
 * Run a fetch into a state. A refresh that fails offline keeps what's already
 * on screen — pulling to refresh on a train shouldn't blank the list — and a
 * cancelled one (the screen went away) changes nothing.
 */
suspend fun <T> LoadState<T>.next(fetch: suspend () -> T): LoadState<T> = try {
    LoadState.Loaded(fetch())
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    val error = ApiError.from(e)
    when {
        error is ApiError.Cancelled -> this
        value != null && error is ApiError.Transport -> this
        else -> LoadState.Failed(error)
    }
}

/** The loading / error / content switch, with retry wired to the same fetch. */
@Composable
fun <T> LoadStateView(state: LoadState<T>, onRetry: () -> Unit, modifier: Modifier = Modifier, content: @Composable (T) -> Unit) {
    when (state) {
        LoadState.Loading -> Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        is LoadState.Failed -> ErrorState(state.error, onRetry, modifier)
        is LoadState.Loaded -> content(state.value)
    }
}

fun ApiError.icon(): ImageVector = when (this) {
    is ApiError.Transport -> Icons.Outlined.WifiOff
    is ApiError.NotConfigured -> Icons.Outlined.Build
    is ApiError.Forbidden, is ApiError.Unauthorized -> Icons.Outlined.Lock
    is ApiError.NotFound -> Icons.Outlined.SearchOff
    else -> Icons.Outlined.ErrorOutline
}

@Composable
fun ErrorState(error: ApiError, onRetry: (() -> Unit)?, modifier: Modifier = Modifier) {
    EmptyState(error.icon(), error.title, error.message, modifier, actionLabel = onRetry?.let { "Try again" }, onAction = onRetry)
}

/** The stock "nothing here" — an icon, a line, a sentence and maybe a button. */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String? = null,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Box(modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(title, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
            if (message != null) {
                Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            }
            if (actionLabel != null && onAction != null) FilledTonalButton(onClick = onAction) { Text(actionLabel) }
        }
    }
}
