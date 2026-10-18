// Turning what somebody typed into a server address, and deciding whether the
// server at it is one this app can talk to. A port of
// `packages/native-client/src/server-url.ts` by way of `ServerAddress.swift`;
// the golden vectors are in `ServerAddressTest`.
//
// People type `192.168.1.10:3000`, `tinkerbell.example.com/` or paste a URL
// with a path from their address bar. The probe tries each candidate until one
// answers `auth.server`. Without a scheme, HTTPS goes first — a name that
// serves both should use the encrypted one — and plain HTTP second, because a
// LAN address with a port is usually exactly that.
package dev.tinkerbell.api

import dev.tinkerbell.model.WireJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

enum class ServerProduct(val raw: String) {
    PORTAL("tinkerbell-portal"),
    ADMIN("tinkerbell-admin"),
    ;

    /** How the person knows it: the two halves of the app. */
    val label: String get() = if (this == PORTAL) "Portal" else "Admin"

    companion object {
        fun fromRaw(raw: String?): ServerProduct? = entries.firstOrNull { it.raw == raw }
    }
}

object ServerAddress {
    private val schemePrefix = Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE)

    fun candidates(input: String): List<String> {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return emptyList()
        val attempts = if (schemePrefix.containsMatchIn(trimmed)) listOf(trimmed) else listOf("https://$trimmed", "http://$trimmed")
        // Only the origin. A pasted `/settings/api` path is where the user was,
        // not where the API is — and Tinkerbell under a reverse-proxy sub-path
        // isn't something the server supports either.
        return attempts.mapNotNull(::origin).distinct()
    }

    /**
     * `scheme://host[:port]`, lowercased, default port dropped — the same
     * string a browser's `URL.origin` gives, so the two ends compare equal.
     */
    fun origin(raw: String): String? {
        val url = raw.trim().toHttpUrlOrNull() ?: return null
        if (url.host.isEmpty()) return null
        return originOf(url)
    }

    internal fun originOf(url: HttpUrl): String {
        val host = if (url.host.contains(':')) "[${url.host}]" else url.host
        val port = if (url.port == HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}"
        return "${url.scheme}://$host$port"
    }

    /** Numeric compare of `x.y.z`; anything after a `-` is ignored. */
    fun compareVersions(a: String, b: String): Int {
        fun parse(v: String) = v.substringBefore('-').split('.').map { part -> part.takeWhile { it.isDigit() }.toIntOrNull() ?: 0 }
        val pa = parse(a)
        val pb = parse(b)
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val diff = (pa.getOrNull(i) ?: 0) - (pb.getOrNull(i) ?: 0)
            if (diff != 0) return if (diff > 0) 1 else -1
        }
        return 0
    }

    /**
     * The oldest server this build can drive. `auth.server` arrived with the
     * first native apps, so any server that answers it is at least this; the
     * capability check is what actually gates sign-in.
     */
    const val MINIMUM_SERVER_VERSION = "0.35.0"

    /**
     * Judge one candidate's `auth.server` answer — the raw body, so a server
     * that isn't Tinkerbell at all is judged rather than failing to decode.
     */
    fun judge(origin: String, body: String, want: ServerProduct): ServerCheck {
        val json = try {
            WireJson.decoder.parseToJsonElement(body)
        } catch (e: Exception) {
            return ServerCheck.Failed(ProbeFailure.NotTinkerbell)
        }
        return judge(origin, json, want)
    }

    fun judge(origin: String, json: JsonElement, want: ServerProduct): ServerCheck {
        val data = ((json as? JsonObject)?.get("result") as? JsonObject)?.get("data") as? JsonObject
            ?: return ServerCheck.Failed(ProbeFailure.NotTinkerbell)
        val productRaw = data.string("product") ?: return ServerCheck.Failed(ProbeFailure.NotTinkerbell)
        val version = data.string("version") ?: return ServerCheck.Failed(ProbeFailure.NotTinkerbell)
        val product = ServerProduct.fromRaw(productRaw) ?: return ServerCheck.Failed(ProbeFailure.NotTinkerbell)
        if (product != want) return ServerCheck.Failed(ProbeFailure.WrongApp(product))
        if (compareVersions(version, MINIMUM_SERVER_VERSION) < 0) return ServerCheck.Failed(ProbeFailure.TooOld(version))
        val capabilities = (data["capabilities"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()
        // Asked, not inferred from the version: a server says what it can do.
        if ("exchange" !in capabilities) return ServerCheck.Failed(ProbeFailure.NeedsUpdate(version))
        return ServerCheck.Ok(
            ServerInfo(
                origin = origin,
                product = product,
                version = version,
                capabilities = capabilities,
                authRequired = (data["authRequired"] as? JsonPrimitive)?.booleanOrNull,
                portalUrl = data.string("portalUrl")?.ifEmpty { null },
            ),
        )
    }

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    // Where an address points

    /**
     * This device's own address. A phone given `localhost` reaches itself, not
     * the server — the commonest copy-paste from a desktop browser.
     */
    fun isLoopback(address: String): Boolean {
        val host = host(address) ?: return false
        return host == "localhost" || host.endsWith(".localhost") || host == "::1" ||
            host.startsWith("127.") || host == "0.0.0.0"
    }

    /**
     * On the local network (or loopback), where plain HTTP is the norm and not
     * worth a warning. Tailscale's `100.64/10` and `*.ts.net` count: that
     * traffic is already inside WireGuard.
     */
    fun isLocalNetwork(address: String): Boolean {
        if (isLoopback(address)) return true
        val host = host(address) ?: return false
        if (!host.contains('.') && !host.contains(':')) return true
        if (listOf(".local", ".lan", ".home", ".home.arpa", ".internal", ".localdomain", ".ts.net").any { host.endsWith(it) }) return true
        if (host.contains(':')) return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")
        val parts = host.split('.').mapNotNull { it.toIntOrNull() }
        if (parts.size != 4) return false
        val (a, b) = parts
        return a == 10 || (a == 192 && b == 168) || (a == 169 && b == 254) ||
            (a == 172 && b in 16..31) || (a == 100 && b in 64..127)
    }

    /** Plain HTTP somewhere other than the LAN: the session and, at sign-in, the Plex token cross the internet readable. */
    fun isUnencryptedRemote(address: String): Boolean {
        val url = address.trim().toHttpUrlOrNull() ?: return false
        return url.scheme == "http" && !isLocalNetwork(address)
    }

    internal fun host(address: String): String? = address.trim().toHttpUrlOrNull()?.host?.lowercase()?.trim('[', ']')
}

/** What a server said about itself, once it has passed. */
data class ServerInfo(
    val origin: String,
    val product: ServerProduct,
    val version: String,
    val capabilities: List<String>,
    /** Admin only: false when admin sign-in is switched off on the server. */
    val authRequired: Boolean? = null,
    /**
     * Admin only: the portal's public address, when the admin has set one —
     * offered for the portal slot so nobody types it twice.
     */
    val portalUrl: String? = null,
)

sealed interface ServerCheck {
    val info: ServerInfo?

    data class Ok(override val info: ServerInfo) : ServerCheck
    data class Failed(val failure: ProbeFailure) : ServerCheck {
        override val info: ServerInfo? get() = null
    }
}

sealed interface ProbeFailure {
    data object NotAnAddress : ProbeFailure
    data class Unreachable(val detail: String? = null) : ProbeFailure
    data object NotTinkerbell : ProbeFailure
    data class WrongApp(val found: ServerProduct) : ProbeFailure
    data class TooOld(val version: String) : ProbeFailure
    data class NeedsUpdate(val version: String) : ProbeFailure

    /** Said for the slot the address was typed into, because "wrong app" only makes sense knowing which one was wanted. */
    fun message(want: ServerProduct): String = when (this) {
        NotAnAddress -> "That isn't a web address."
        is Unreachable -> listOfNotNull("Nothing answered at that address.", detail).joinToString(" ")
        NotTinkerbell -> "Something answered, but it isn't Tinkerbell."
        is WrongApp ->
            if (found == ServerProduct.ADMIN) {
                "That's the admin address. Add it as the Admin server instead — the Portal has its own address (Settings → Portal → Address)."
            } else {
                "That's the portal address. Add it as the Portal server — the Admin server has its own address (Settings → Mobile app)."
            }
        is TooOld -> "This server is running Tinkerbell $version, which is too old for the app. Update the server and try again."
        is NeedsUpdate -> "This server (Tinkerbell $version) needs updating before the app can sign in to it."
    }

    /**
     * The probe keeps the most useful failure across candidates: "that's the
     * portal" beats the https attempt's "unreachable" on an http-only server.
     */
    val rank: Int
        get() = when (this) {
            NotAnAddress -> 0
            is Unreachable -> 1
            else -> 2
        }
}
