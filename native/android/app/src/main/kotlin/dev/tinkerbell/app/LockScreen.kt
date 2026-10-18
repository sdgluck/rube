// The lock, in front of everything else. It asks at once on appearing — the
// person opened the app to use it — and keeps an Unlock button for when they
// cancelled the prompt.
package dev.tinkerbell.app

import androidx.activity.compose.LocalActivity

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import dev.tinkerbell.platform.AppLock
import dev.tinkerbell.platform.BiometricAuthenticator
import kotlinx.coroutines.launch

@Composable
internal fun LockScreen(lock: AppLock) {
    val activity = LocalActivity.current as? FragmentActivity ?: return
    val scope = rememberCoroutineScope()
    // Back leaves the app rather than slipping past the lock.
    BackHandler { activity.moveTaskToBack(true) }
    LaunchedEffect(Unit) { lock.unlock(BiometricAuthenticator(activity)) }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically)) {
            Icon(Icons.Filled.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(48.dp))
            Text("Tinkerbell is locked", style = MaterialTheme.typography.headlineSmall)
            Button(onClick = { scope.launch { lock.unlock(BiometricAuthenticator(activity)) } }) {
                Icon(Icons.Outlined.Fingerprint, contentDescription = null)
                Text("Unlock", Modifier.padding(start = 8.dp))
            }
        }
    }
}

