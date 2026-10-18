// Sign in with Plex, run by the app itself.
//
// The app creates a plex.tv PIN, shows plex.tv's approval page in a Custom
// Tab, and polls the PIN until plex.tv attaches a token to it. That token is
// then handed to each server's `auth.exchange`, which checks it with plex.tv
// independently and answers with a session of its own. The Plex token is never
// stored: it exists between the poll and the last exchange, and then it is
// dropped.
//
// Mirrors `clients/plex/src/auth.ts` (headers, the auth URL without a
// `forwardUrl`) so the server and the app ask plex.tv the same way.
package dev.tinkerbell.api

import dev.tinkerbell.model.WireJson
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeSource

@Serializable
data class PlexPin(val id: Long, val code: String)

sealed class PlexSignInError : Exception() {
    /** The person closed the tab without approving. */
    data object Cancelled : PlexSignInError()

    /** Fifteen minutes passed, or plex.tv forgot the PIN. */
    data object Expired : PlexSignInError()

    /** plex.tv itself couldn't be reached or answered nonsense. */
    data class PlexUnavailable(val detail: String) : PlexSignInError()

    override val message: String
        get() = when (this) {
            Cancelled -> "Sign-in was cancelled."
            Expired -> "The sign-in expired. Try again."
            is PlexUnavailable -> "Couldn't reach plex.tv. $detail"
        }
}

class PlexTv(
    val clientId: String,
    /**
     * A development stand-in for plex.tv (the dev server's mock). Only a debug
     * build ever sets it — see `DeepLink.parse(allowPlexTvOverride)`.
     */
    val override: String? = null,
    private val http: OkHttpClient = Http.client,
) {
    private val apiBase: String get() = (override?.trimEnd('/') ?: "https://plex.tv") + "/api/v2"

    private fun request(url: String) = Request.Builder()
        .url(url)
        .header("X-Plex-Client-Identifier", clientId)
        .header("X-Plex-Product", PRODUCT)
        .header("Accept", "application/json")

    /**
     * `strong=true`: a long code that only this client id can redeem, rather
     * than the four-character one meant for typing on a TV.
     */
    suspend fun createPin(): PlexPin {
        val (status, body) = send(request("$apiBase/pins?strong=true").post(ByteArray(0).toRequestBody(null)).build())
        if (status !in 200..299) throw PlexSignInError.PlexUnavailable("It answered $status.")
        return try {
            WireJson.decoder.decodeFromString(PlexPin.serializer(), body)
        } catch (e: Exception) {
            throw PlexSignInError.PlexUnavailable("It answered $status.")
        }
    }

    @Serializable
    private data class PinBody(val authToken: String? = null)

    /** The PIN's token once approved, null while it is still waiting. */
    suspend fun checkPin(id: Long): String? {
        val (status, body) = send(request("$apiBase/pins/$id").get().build())
        // plex.tv forgets a PIN when it expires; a 404 is that, not an outage.
        if (status == 404) throw PlexSignInError.Expired
        if (status !in 200..299) throw PlexSignInError.PlexUnavailable("It answered $status.")
        val pin = try {
            WireJson.decoder.decodeFromString(PinBody.serializer(), body)
        } catch (e: Exception) {
            throw PlexSignInError.PlexUnavailable("It answered $status.")
        }
        return pin.authToken?.ifEmpty { null }
    }

    /**
     * The approval page. No `forwardUrl`: the app brings itself back once the
     * poll succeeds, so there is nowhere to return to.
     */
    fun authUrl(code: String): String {
        override?.let { return it.trimEnd('/') + "/auth?code=" + formEncode(code) }
        val query = listOf("clientID" to clientId, "code" to code, "context[device][product]" to PRODUCT)
            .joinToString("&") { (k, v) -> "${formEncode(k)}=${formEncode(v)}" }
        return "https://app.plex.tv/auth#?$query"
    }

    /**
     * For UI tests against the dev server's mock: approve the PIN as a given
     * account without a browser. The mock's `/auth?as=` does exactly what
     * tapping a name on its page does. Never reaches the real plex.tv — it
     * needs an override to have anywhere to go.
     */
    suspend fun approveHeadlessly(code: String, accountId: String) {
        val base = override?.trimEnd('/') ?: throw PlexSignInError.PlexUnavailable("No development plex.tv is set.")
        val (status, _) = send(Request.Builder().url("$base/auth?code=${formEncode(code)}&as=${formEncode(accountId)}").build())
        if (status !in 200..299) throw PlexSignInError.PlexUnavailable("The mock answered $status.")
    }

    private suspend fun send(request: Request): Pair<Int, String> = try {
        http.newCall(request).also { it.timeout().timeout(15, TimeUnit.SECONDS) }.await()
    } catch (e: IOException) {
        throw PlexSignInError.PlexUnavailable(ApiError.fromTransport(e).message)
    }

    companion object {
        const val PRODUCT = "Tinkerbell"

        /**
         * `application/x-www-form-urlencoded`, as URLSearchParams writes it —
         * what the server's `buildPlexAuthUrl` produces, so both open the same page.
         */
        fun formEncode(s: String): String {
            val out = StringBuilder()
            for (byte in s.toByteArray(Charsets.UTF_8)) {
                val c = byte.toInt() and 0xff
                val ch = c.toChar()
                when {
                    ch in 'A'..'Z' || ch in 'a'..'z' || ch in '0'..'9' || ch == '-' || ch == '.' || ch == '_' || ch == '*' -> out.append(ch)
                    ch == ' ' -> out.append('+')
                    else -> out.append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 0xf])
                }
            }
            return out.toString()
        }
    }
}

/**
 * Whether the person has come back from the Custom Tab. Android gives no
 * callback when a tab is closed, so "the app resumed while we were waiting"
 * stands in for it: set from the activity's lifecycle, read by the poll.
 */
class SignInSheetState {
    private val closed = AtomicBoolean(false)
    fun markClosed() = closed.set(true)
    fun reopen() = closed.set(false)
    val isClosed: Boolean get() = closed.get()
}

class PlexPinPoller(
    val interval: Duration = 2.seconds,
    /** plex.tv keeps a PIN for fifteen minutes. */
    val limit: Duration = 15.minutes,
    /**
     * Polls after the tab closes. Tapping "Allow" and pressing Back is one
     * motion, and the approval can land a beat after the app resumes.
     */
    val checksAfterClose: Int = 2,
    /** A blip on a phone's network shouldn't throw away a half-done sign-in; this many in a row should. */
    val toleratedFailures: Int = 5,
) {
    suspend fun waitForToken(pin: PlexPin, plex: PlexTv, sheet: SignInSheetState): String {
        val deadline = TimeSource.Monotonic.markNow() + limit
        var afterClose = 0
        var failures = 0
        while (deadline.hasNotPassedNow()) {
            delay(interval)
            val closed = sheet.isClosed
            try {
                plex.checkPin(pin.id)?.let { return it }
                failures = 0
            } catch (e: PlexSignInError.PlexUnavailable) {
                failures += 1
                if (failures > toleratedFailures) throw e
            }
            if (closed) {
                afterClose += 1
                if (afterClose >= checksAfterClose) throw PlexSignInError.Cancelled
            }
        }
        throw PlexSignInError.Expired
    }

    companion object {
        /** For tests: everything the same but fast. */
        fun fast(limit: Duration = 5.seconds) = PlexPinPoller(interval = 5.milliseconds, limit = limit)
    }
}
