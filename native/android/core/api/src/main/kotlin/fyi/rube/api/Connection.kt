// One server the app talks to, and the URLs built from it.
//
// The portal and the admin are separate HTTP servers — often different ports,
// sometimes different hosts — with separate sessions, so the app holds up to
// two of these and never lets one's token near the other's address.
package fyi.rube.api

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

data class ServerConnection(
    val role: ServerProduct,
    /** The origin, no trailing slash. */
    val baseUrl: String,
    /**
     * Null until signed in — and stays null for an admin server with sign-in
     * switched off (`open`), where there is nothing to present.
     */
    val sessionToken: String? = null,
    /**
     * The admin answered `open` at sign-in: no session, anyone who can reach
     * it can administer it. Remembered so the warning outlives the launch.
     */
    val openAuth: Boolean = false,
) {
    val isSignedIn: Boolean get() = sessionToken != null || openAuth

    val credential: Credential get() = sessionToken?.let { Credential.Bearer(it) } ?: Credential.None

    val displayHost: String
        get() = baseUrl.toHttpUrlOrNull()?.let { url ->
            if (url.port == okhttp3.HttpUrl.defaultPort(url.scheme)) url.host else "${url.host}:${url.port}"
        } ?: baseUrl

    /** Plain HTTP across the internet: worth a quiet warning on its row. */
    val isUnencryptedRemote: Boolean get() = ServerAddress.isUnencryptedRemote(baseUrl)

    /** Stops the session showing up in logs and crash reports. */
    override fun toString(): String = "ServerConnection($role, $baseUrl, signedIn=$isSignedIn, openAuth=$openAuth)"
}

object AdminUrls {
    /**
     * The admin's image proxy. It authenticates like any other admin route, so
     * the image loader sends the bearer with it — and only with it.
     */
    fun plexImage(base: String, path: String?): String? {
        if (path.isNullOrEmpty()) return null
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        return base.trimEnd('/') + "/api/plex-image?path=" + TrpcRequest.encodeQueryValue(path)
    }

    /** A screen of the web admin, for everything the app leaves to it. `path` is the SPA route, appended as-is. */
    fun web(base: String, path: String): String = base.trimEnd('/') + (if (path.startsWith("/")) path else "/$path")
}

object PortalUrls {
    /**
     * Match posters are paths the server signed; they work from any client
     * with no header, so they're plain GETs on the portal origin.
     */
    fun poster(base: String, path: String?): String? {
        if (path.isNullOrEmpty()) return null
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        return base.trimEnd('/') + (if (path.startsWith("/")) path else "/$path")
    }
}
