// The app's links, parsed into what they ask for — and nothing more.
//
// - `tinkerbell://connect?admin=<url>&portal=<url>` — what a Settings QR code
//   holds. Either half may be missing: the portal's own page only shares the
//   portal address.
// - `tinkerbell://match?server=<portal>&code=<CODE>&invite=<SECRET>` — a movie
//   match room. The web's invite, `<portal>/#match/CODE/SECRET`, means the same
//   and is accepted when pasted.
//
// Any app on the phone can open these, and anyone can print a QR code, so a
// link is only ever a suggestion: connect fills in a confirm screen that
// probes each address, and never replaces a connection by itself.
package dev.tinkerbell.api

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

sealed interface DeepLink {
    data class Connect(val link: ConnectLink) : DeepLink
    data class Match(val link: MatchLink) : DeepLink

    companion object {
        const val SCHEME = "tinkerbell"
        private val schemeRegex = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):")

        /**
         * [allowPlexTvOverride] is the build's debug flag, passed in rather than
         * read here so both sides of it are tested. In a release build a link
         * naming its own plex.tv would be a way to steer sign-in to a fake one.
         */
        fun parse(raw: String, allowPlexTvOverride: Boolean): DeepLink? {
            val trimmed = raw.trim()
            val scheme = schemeRegex.find(trimmed)?.groupValues?.get(1)?.lowercase() ?: return null
            if (scheme == "http" || scheme == "https") return parseWebInvite(trimmed)?.let(::Match)
            if (scheme != SCHEME) return null
            if (trimmed.any { it.isWhitespace() }) return null

            // `tinkerbell://connect?…` has `connect` as its host; tolerate
            // `tinkerbell:connect?…` and `tinkerbell:///connect` too.
            val rest = trimmed.substring(scheme.length + 1).substringBefore('#')
            val route = rest.substringBefore('?').trim('/').lowercase()
            val query = parseQuery(if (rest.contains('?')) rest.substringAfter('?') else "") ?: return null

            return when (route) {
                "connect" -> {
                    val admin = query["admin"]?.let(ServerAddress::origin)
                    val portal = query["portal"]?.let(ServerAddress::origin)
                    if (admin == null && portal == null) return null
                    val plexTv = if (allowPlexTvOverride) query["plexTv"]?.let(ServerAddress::origin) else null
                    Connect(ConnectLink(admin = admin, portal = portal, plexTv = plexTv))
                }
                "match" -> {
                    val server = query["server"]?.let(ServerAddress::origin) ?: return null
                    val code = query["code"]?.let(MatchCode::normalise) ?: return null
                    Match(MatchLink(server = server, code = code, invite = query["invite"]?.ifEmpty { null }))
                }
                else -> null
            }
        }

        /**
         * `https://portal.example/#match/CODE/SECRET`, the link the web
         * portal's share sheet sends. The secret rides in the fragment there
         * because a fragment never reaches a server log; here it is just data.
         */
        fun parseWebInvite(raw: String): MatchLink? {
            val trimmed = raw.trim()
            val url = trimmed.toHttpUrlOrNull() ?: return null
            val server = ServerAddress.origin(trimmed) ?: return null
            val fragment = url.fragment ?: return null
            val parts = fragment.split('/')
            if (parts.firstOrNull() != "match" || parts.size < 2) return null
            val code = MatchCode.normalise(parts[1]) ?: return null
            val invite = parts.getOrNull(2)?.ifEmpty { null }
            return MatchLink(server = server, code = code, invite = invite)
        }

        /** The link a connect QR code holds. */
        fun connectUrl(admin: String?, portal: String?): String {
            val items = listOfNotNull(
                admin?.let { "admin=" + TrpcRequest.encodeQueryValue(it) },
                portal?.let { "portal=" + TrpcRequest.encodeQueryValue(it) },
            )
            return "$SCHEME://connect" + if (items.isEmpty()) "" else "?" + items.joinToString("&")
        }

        /** The app's own link to a room, for handing to the router. */
        fun matchUrl(link: MatchLink): String = "$SCHEME://match?server=" + TrpcRequest.encodeQueryValue(link.server) +
            "&code=" + link.code + (link.invite?.let { "&invite=" + TrpcRequest.encodeQueryValue(it) } ?: "")

        /**
         * Query items as URLComponents reads them: percent-decoded, `+` left
         * alone, the first of a repeated name winning, a name with no `=`
         * dropped. Null when the escaping is malformed — a link that broken is
         * refused whole rather than half-read.
         */
        private fun parseQuery(query: String): Map<String, String>? {
            val out = LinkedHashMap<String, String>()
            if (query.isEmpty()) return out
            for (pair in query.split('&')) {
                if (!pair.contains('=')) continue
                val name = percentDecode(pair.substringBefore('=')) ?: return null
                val value = percentDecode(pair.substringAfter('=')) ?: return null
                out.putIfAbsent(name, value)
            }
            return out
        }

        private fun percentDecode(s: String): String? {
            if (!s.contains('%')) return s
            val bytes = java.io.ByteArrayOutputStream()
            var i = 0
            while (i < s.length) {
                val c = s[i]
                if (c == '%') {
                    if (i + 3 > s.length) return null
                    val hex = s.substring(i + 1, i + 3)
                    if (!hex.all { it in '0'..'9' || it.lowercaseChar() in 'a'..'f' }) return null
                    bytes.write(hex.toInt(16))
                    i += 3
                } else {
                    bytes.write(c.toString().toByteArray(Charsets.UTF_8))
                    i += 1
                }
            }
            return bytes.toString(Charsets.UTF_8.name())
        }
    }
}

data class ConnectLink(
    val admin: String? = null,
    val portal: String? = null,
    /** A development plex.tv. Only survives parsing in a debug build. */
    val plexTv: String? = null,
)

data class MatchLink(
    /** The portal's origin. */
    val server: String,
    val code: String,
    val invite: String? = null,
)

object MatchCode {
    /** No 0/O or 1/I: codes are read aloud across a sofa. */
    const val ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    const val LENGTH = 4

    /** Uppercased and checked; null for anything that can't be a room. */
    fun normalise(raw: String): String? {
        val upper = raw.uppercase()
        return if (upper.length == LENGTH && upper.all { it in ALPHABET }) upper else null
    }

    /** What a code field keeps of a keystroke: the alphabet, uppercased, capped. */
    fun filterTyping(raw: String): String = raw.uppercase().filter { it in ALPHABET }.take(LENGTH)
}
