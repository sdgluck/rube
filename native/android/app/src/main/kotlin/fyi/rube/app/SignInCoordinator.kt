// Sign in with Plex, run by the app: create a PIN, show plex.tv's approval
// page in a Custom Tab, poll the PIN, then exchange the Plex token with each
// server that needs a session.
//
// The tab never calls back — there is no `forwardUrl` — so the app brings
// itself forward once the poll has a token, which closes the tab. Android has
// no "the tab was closed" callback either, so the activity reports coming back
// to the app while a tab was open; the poll then gives the approval a grace
// check or two (tapping Allow and pressing Back is one motion) before calling
// it cancelled. The Plex token lives in this function's locals and nowhere
// else: never stored, gone once the exchanges return.
package fyi.rube.app

import fyi.rube.api.ExchangeOutcome
import fyi.rube.api.PlexPinPoller
import fyi.rube.api.PlexSignInError
import fyi.rube.api.PlexTv
import fyi.rube.api.ServerProduct
import fyi.rube.api.SignInExchange
import fyi.rube.api.SignInSheetState
import fyi.rube.platform.ConnectionStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the coordinator needs from the activity on screen. */
interface SignInPresenter {
    fun openAuthPage(url: String)

    /** Back to the app after approval — which closes the tab above it. */
    fun bringToFront()
}

class SignInCoordinator(private val store: ConnectionStore, private val scope: CoroutineScope) {
    enum class Phase { IDLE, WAITING_FOR_PLEX, FINISHING }

    private val _phase = MutableStateFlow(Phase.IDLE)
    val phase: StateFlow<Phase> = _phase.asStateFlow()

    /** What to tell the person once it's over: refusals and failures, per server. */
    private val _messages = MutableStateFlow<List<String>>(emptyList())
    val messages: StateFlow<List<String>> = _messages.asStateFlow()

    @Volatile var presenter: SignInPresenter? = null

    private var sheet: SignInSheetState? = null
    private var tabOpen = false
    private var leftForTab = false

    fun onActivityPaused() {
        if (tabOpen) leftForTab = true
    }

    fun onActivityResumed() {
        if (tabOpen && leftForTab) sheet?.markClosed()
    }

    fun start(roles: List<ServerProduct>? = null) {
        if (_phase.value != Phase.IDLE) return
        scope.launch { signIn(roles) }
    }

    suspend fun signIn(requested: List<ServerProduct>? = null) {
        if (_phase.value != Phase.IDLE) return
        val roles = requested ?: store.current.rolesNeedingSession
        if (roles.isEmpty()) return
        _messages.value = emptyList()
        _phase.value = Phase.WAITING_FOR_PLEX
        try {
            val plexToken = waitForPlex() ?: return
            _phase.value = Phase.FINISHING
            val messages = mutableListOf<String>()
            for (role in roles) {
                val client = store.client(role) ?: continue
                val outcome = if (role == ServerProduct.PORTAL) SignInExchange.portal(client, plexToken) else SignInExchange.admin(client, plexToken)
                when (outcome) {
                    is ExchangeOutcome.SignedIn -> store.setSession(role, outcome.token)
                    ExchangeOutcome.Open -> store.setSession(role, null, openAuth = true)
                    is ExchangeOutcome.Refused -> messages += "${role.label}: ${outcome.message}"
                    is ExchangeOutcome.Failed -> messages += "${role.label}: ${outcome.error.message}"
                }
            }
            _messages.value = messages
        } finally {
            _phase.value = Phase.IDLE
        }
    }

    /** The Plex token, or null when the person backed out (nothing to say) or it failed (said in messages). */
    private suspend fun waitForPlex(): String? {
        val plex = PlexTv(clientId = store.plexClientId, override = store.current.plexTvOverride)
        val sheet = SignInSheetState().also { this.sheet = it }
        try {
            val pin = plex.createPin()
            val headless = DevFlags.signInAs
            if (headless != null && plex.override != null) {
                // Tests: approve on the mock plex.tv, no browser.
                scope.launch {
                    try {
                        plex.approveHeadlessly(pin.code, headless)
                    } catch (_: PlexSignInError) {
                    }
                }
            } else {
                tabOpen = true
                leftForTab = false
                presenter?.openAuthPage(plex.authUrl(pin.code))
            }
            val token = PlexPinPoller().waitForToken(pin, plex, sheet)
            if (tabOpen) presenter?.bringToFront()
            return token
        } catch (e: PlexSignInError.Cancelled) {
            return null
        } catch (e: CancellationException) {
            throw e
        } catch (e: PlexSignInError) {
            _messages.value = listOf(e.message)
            return null
        } finally {
            tabOpen = false
            leftForTab = false
            this.sheet = null
        }
    }
}
