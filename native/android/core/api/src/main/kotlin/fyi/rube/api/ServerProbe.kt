// Ask a typed-in address whether it is a Rube the app can use, before
// anything is saved and — more to the point — before it is handed a Plex token
// at sign-in. A connect link can come from anywhere; this is the check that
// the address on it is the kind of server it claims to be.
//
// A plain GET of `auth.server` rather than the tRPC client: the answer is
// judged from the raw body, so "a router's login page" is "not Rube"
// rather than a decode error.
package fyi.rube.api

import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

class ServerProbe(
    private val http: OkHttpClient = Http.client,
    private val timeoutMs: Long = TIMEOUT_MS,
) {
    suspend fun probe(input: String, want: ServerProduct): ServerCheck {
        val candidates = ServerAddress.candidates(input)
        if (candidates.isEmpty()) return ServerCheck.Failed(ProbeFailure.NotAnAddress)
        var best: ProbeFailure = ProbeFailure.Unreachable()
        for (origin in candidates) {
            val request = try {
                Request.Builder().url("$origin/api/trpc/auth.server").header("Accept", "application/json").build()
            } catch (e: IllegalArgumentException) {
                continue
            }
            val body = try {
                http.newCall(request).also { it.timeout().timeout(timeoutMs, TimeUnit.MILLISECONDS) }.await().second
            } catch (e: IOException) {
                if (best == ProbeFailure.Unreachable()) best = ProbeFailure.Unreachable(ApiError.fromTransport(e).message)
                continue
            }
            when (val check = ServerAddress.judge(origin, body, want)) {
                is ServerCheck.Ok -> return check
                is ServerCheck.Failed -> if (check.failure.rank >= best.rank) best = check.failure
            }
        }
        return ServerCheck.Failed(best)
    }

    companion object {
        const val TIMEOUT_MS = 8_000L
    }
}
