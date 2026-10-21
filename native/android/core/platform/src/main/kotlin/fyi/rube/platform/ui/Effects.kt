// Polling, action errors and haptics — the three things nearly every screen
// does and would otherwise each do slightly differently.
package fyi.rube.platform.ui

import android.view.HapticFeedbackConstants
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import fyi.rube.api.ApiError
import kotlinx.coroutines.delay

/**
 * Runs [block] every [intervalMs] while the screen is on screen and the app is
 * in front — a backgrounded app polling a home server every few seconds is a
 * battery bill for nothing. Restarts when [key] changes.
 */
@Composable
fun Poll(intervalMs: Long, key: Any? = Unit, block: suspend () -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val current = rememberUpdatedState(block)
    LaunchedEffect(lifecycle, key) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                current.value()
                delay(intervalMs)
            }
        }
    }
}

/** An error from an action (not a load), shown as a stock alert until dismissed. */
@Composable
fun rememberActionError(): MutableState<ApiError?> = remember { mutableStateOf(null) }

@Composable
fun ActionErrorDialog(state: MutableState<ApiError?>) {
    val error = state.value ?: return
    AlertDialog(
        onDismissRequest = { state.value = null },
        title = { Text(error.title) },
        text = { Text(error.message) },
        confirmButton = { TextButton(onClick = { state.value = null }) { Text("OK") } },
    )
}

/** The view-level haptics Compose doesn't name: the thump of a swipe crossing its threshold. */
class Haptics(private val view: android.view.View) {
    fun confirm() = view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
    fun reject() = view.performHapticFeedback(HapticFeedbackConstants.REJECT)
    fun tick() = view.performHapticFeedback(HapticFeedbackConstants.SEGMENT_TICK)
    fun threshold() = view.performHapticFeedback(HapticFeedbackConstants.GESTURE_THRESHOLD_ACTIVATE)
    fun toggle(on: Boolean) = view.performHapticFeedback(if (on) HapticFeedbackConstants.TOGGLE_ON else HapticFeedbackConstants.TOGGLE_OFF)
}

@Composable
fun rememberHaptics(): Haptics {
    val view = LocalView.current
    return remember(view) { Haptics(view) }
}
