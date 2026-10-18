// The app's (up to) two servers, and everything that lives with them.
//
// One observable state so the root can switch on it: no portal and no admin is
// the connect screen, an address without a session is sign-in, and a session
// the server rejects is cleared here — once, by the client's `onUnauthorized`
// — which puts that half of the app back to sign-in without every screen
// having to decide to. The Kotlin twin of `ConnectionStore.swift`.
package dev.tinkerbell.platform

import dev.tinkerbell.api.ServerConnection
import dev.tinkerbell.api.ServerProduct
import dev.tinkerbell.api.TrpcClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.UUID

data class Connections(
    val portal: ServerConnection? = null,
    val admin: ServerConnection? = null,
    /** Debug builds only: a development plex.tv from a connect link. */
    val plexTvOverride: String? = null,
) {
    operator fun get(role: ServerProduct): ServerConnection? = if (role == ServerProduct.PORTAL) portal else admin
    val isEmpty: Boolean get() = portal == null && admin == null
    val anySignedIn: Boolean get() = portal?.isSignedIn == true || admin?.isSignedIn == true

    /** Every connected server without a session. */
    val rolesNeedingSession: List<ServerProduct>
        get() = ServerProduct.entries.filter { this[it] != null && this[it]?.isSignedIn != true }
}

class ConnectionStore(
    private val secrets: SecretStore,
    private val settings: KeyValueStore,
    /** The build's debug flag: only then is a development plex.tv remembered. */
    private val allowPlexTvOverride: Boolean,
) {
    private val _state = MutableStateFlow(Connections())
    val state: StateFlow<Connections> = _state.asStateFlow()
    val current: Connections get() = _state.value

    init {
        _state.value = Connections(
            portal = load(ServerProduct.PORTAL),
            admin = load(ServerProduct.ADMIN),
            plexTvOverride = if (allowPlexTvOverride) settings.string(PLEX_TV) else null,
        )
    }

    private fun urlKey(role: ServerProduct) = if (role == ServerProduct.PORTAL) PORTAL_URL else ADMIN_URL
    private fun sessionKey(role: ServerProduct) = "session.${role.raw}"

    private fun load(role: ServerProduct): ServerConnection? {
        val url = settings.string(urlKey(role)) ?: return null
        return ServerConnection(
            role = role,
            baseUrl = url,
            sessionToken = secrets.get(sessionKey(role)),
            openAuth = role == ServerProduct.ADMIN && settings.bool(ADMIN_OPEN),
        )
    }

    private fun assign(role: ServerProduct, connection: ServerConnection?) = _state.update {
        if (role == ServerProduct.PORTAL) it.copy(portal = connection) else it.copy(admin = connection)
    }

    /**
     * Point a slot at a server. A different address drops that slot's
     * session: a token is only meaningful to the server that issued it, and
     * presenting it to another hands that server a live token for the first.
     */
    fun setServer(role: ServerProduct, origin: String) {
        if (current[role]?.baseUrl == origin) return
        secrets.set(sessionKey(role), null)
        if (role == ServerProduct.ADMIN) settings.setBool(ADMIN_OPEN, false)
        settings.setString(urlKey(role), origin)
        assign(role, ServerConnection(role, origin))
    }

    fun setSession(role: ServerProduct, token: String?, openAuth: Boolean = false) {
        val connection = current[role] ?: return
        secrets.set(sessionKey(role), token)
        val open = role == ServerProduct.ADMIN && openAuth
        if (role == ServerProduct.ADMIN) settings.setBool(ADMIN_OPEN, open)
        assign(role, connection.copy(sessionToken = token, openAuth = open))
    }

    /**
     * Only if it is still the token that failed. A sign-in that finished while
     * an old request was in flight must not be undone by its 401.
     */
    fun clearSession(role: ServerProduct, ifToken: String?) {
        val connection = current[role] ?: return
        if (connection.sessionToken != ifToken) return
        // An `open` admin that now says UNAUTHORIZED has had sign-in switched
        // on: back to sign-in, like any other expired session.
        setSession(role, null, openAuth = false)
    }

    fun remove(role: ServerProduct) {
        secrets.set(sessionKey(role), null)
        settings.setString(urlKey(role), null)
        if (role == ServerProduct.ADMIN) settings.setString(ADMIN_OPEN, null)
        assign(role, null)
    }

    fun setPlexTvOverride(url: String?) {
        if (!allowPlexTvOverride) return
        settings.setString(PLEX_TV, url)
        _state.update { it.copy(plexTvOverride = url) }
    }

    /** A client for that slot, wired so a rejected session clears itself. */
    fun client(role: ServerProduct, timeoutMs: Long = 20_000): TrpcClient? {
        val connection = current[role] ?: return null
        val token = connection.sessionToken
        return TrpcClient(connection.baseUrl, connection.credential, timeoutMs) { clearSession(role, token) }
    }

    // Per-install and per-room secrets

    /**
     * Plex identifies a device by this, and only redeems a PIN for the id that
     * created it. Made once per install; never leaves the device.
     */
    val plexClientId: String
        get() = secrets.get(PLEX_CLIENT_ID) ?: UUID.randomUUID().toString().lowercase().also { secrets.set(PLEX_CLIENT_ID, it) }

    /** A movie-match guest's token for one room, which is all a guest has. */
    fun guestToken(server: String, code: String): String? = secrets.get(guestKey(server, code))

    fun setGuestToken(token: String?, server: String, code: String) = secrets.set(guestKey(server, code), token)

    private fun guestKey(server: String, code: String) = "guest.$server.$code"

    private companion object {
        const val PORTAL_URL = "tb.portal.url"
        const val ADMIN_URL = "tb.admin.url"
        const val ADMIN_OPEN = "tb.admin.open"
        const val PLEX_TV = "tb.debug.plexTv"
        const val PLEX_CLIENT_ID = "plex.clientId"
    }
}
