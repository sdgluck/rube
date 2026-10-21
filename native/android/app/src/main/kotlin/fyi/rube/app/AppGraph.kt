// Everything that outlives a screen — the two connections, the lock, the
// appearance, the sign-in in progress, links waiting to be opened — built once
// here and handed down, so there is one of each and screens only ever read it.
//
// The graph can be rebuilt (`-TBResetState` in a debug build), but the two
// stores under it can't: DataStore refuses a second instance on the same file,
// so the Application owns those and every graph shares them.
package fyi.rube.app

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import fyi.rube.api.ConnectLink
import fyi.rube.api.DeepLink
import fyi.rube.api.MatchLink
import fyi.rube.platform.AppLock
import fyi.rube.platform.AppSettings
import fyi.rube.platform.ConnectionStore
import fyi.rube.platform.Images
import fyi.rube.platform.KeyValueStore
import fyi.rube.platform.KeystoreSecretStore
import fyi.rube.platform.SecretStore
import fyi.rube.platform.SharedPrefsStore
import fyi.rube.platform.ui.ShellState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

class AppGraph(secrets: SecretStore, prefs: KeyValueStore) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val store = ConnectionStore(secrets, prefs, allowPlexTvOverride = DevFlags.isDebug)
    val lock = AppLock(prefs)
    val settings = AppSettings(prefs)
    val shell = ShellState()
    val links = LinkRouter()
    val signIn = SignInCoordinator(store, scope)
}

/**
 * Links the app was opened with, waiting for the root to act on them. Parsed
 * here and judged there: a connect link only ever fills in a confirm screen.
 */
class LinkRouter {
    var connect by mutableStateOf<ConnectRequest?>(null)

    /** Resolved by the root, which knows whether there's a session for it. */
    var pendingMatch by mutableStateOf<MatchLink?>(null)
    var error by mutableStateOf<String?>(null)

    fun open(raw: String) {
        when (val link = DeepLink.parse(raw, allowPlexTvOverride = DevFlags.isDebug)) {
            is DeepLink.Connect -> connect = ConnectRequest(link.link)
            is DeepLink.Match -> pendingMatch = link.link
            null -> error = "The app doesn't understand that link."
        }
    }
}

/** A connect link to confirm. The id makes a second scan of the same code a fresh screen. */
data class ConnectRequest(val link: ConnectLink, val id: Long = System.nanoTime())

class RubeApplication : Application() {
    private lateinit var secrets: SecretStore
    private lateinit var settings: KeyValueStore

    /** Compose state, so a reset swaps the whole UI onto the new graph. */
    var graph by mutableStateOf<AppGraph?>(null)
        private set

    override fun onCreate() {
        super.onCreate()
        secrets = KeystoreSecretStore(this)
        settings = SharedPrefsStore(this)
        graph = AppGraph(secrets, settings)
        Images.install(this) { graph?.store?.current?.admin }
        // The lock counts time away from the whole app, not from one screen:
        // a Custom Tab or the share sheet on top isn't "away".
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                graph?.lock?.didEnterBackground()
            }

            override fun onStart(owner: LifecycleOwner) {
                graph?.lock?.willEnterForeground()
            }
        })
    }

    /** Start from a fresh install. Debug builds only — see [DevFlags]. */
    fun reset() {
        if (!DevFlags.isDebug) return
        graph?.scope?.cancel()
        secrets.clear()
        settings.clear()
        graph = AppGraph(secrets, settings)
    }
}
