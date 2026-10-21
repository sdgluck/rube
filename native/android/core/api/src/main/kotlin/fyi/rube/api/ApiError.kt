// What can go wrong talking to a Rube server, sorted by what the app
// does about it rather than by HTTP status. The Kotlin twin of `APIError.swift`.
//
// tRPC puts its own code in `error.data.code`; that string is the contract,
// not the status line. Every screen switches on these cases, so a new server
// code lands in `Server` and shows its message instead of crashing a `when`.
package fyi.rube.api

import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

sealed class ApiError : Exception() {
    /** The session is gone or was never there. That half goes back to sign-in. */
    data class Unauthorized(val text: String) : ApiError()

    /** 412: the server answered, but something it needs (Plex, an *Arr) isn't set up. */
    data class NotConfigured(val text: String) : ApiError()

    /**
     * Not allowed — also what the portal says when the admin has switched a
     * component off, which screens treat as "hide this", not as an error.
     */
    data class Forbidden(val text: String) : ApiError()

    data class NotFound(val text: String) : ApiError()

    data class BadRequest(val text: String) : ApiError()

    data class TooManyRequests(val text: String) : ApiError()

    /** Any other tRPC error, kept with its code so it can still be shown. */
    data class Server(val code: String, val status: Int, val text: String) : ApiError()

    /** Never reached a server that answered: offline, DNS, TLS, timeout. */
    data class Transport(val text: String) : ApiError()

    /** The server answered something this build can't read. [detail] is for logs. */
    data class Decoding(val detail: String) : ApiError()

    /** The call was cancelled underneath us. Never shown. */
    data object Cancelled : ApiError()

    /**
     * Text for a person. The server's own message where it has one, because it
     * is written for exactly that ("Sign in with Plex first.").
     */
    override val message: String
        get() = when (this) {
            is Unauthorized -> text.ifEmpty { "Your session has ended. Sign in again." }
            is NotConfigured -> text.ifEmpty { "This server isn't set up for that yet." }
            is Forbidden -> text.ifEmpty { "You aren't allowed to do that here." }
            is NotFound -> text.ifEmpty { "That isn't there any more." }
            is BadRequest -> text.ifEmpty { "The server didn't accept that." }
            is TooManyRequests -> text.ifEmpty { "Too many attempts. Wait a minute and try again." }
            is Server -> text.ifEmpty { "Something went wrong on the server." }
            is Transport -> text
            is Decoding -> "This server sent something the app couldn't read. Make sure the app and the server are both up to date."
            Cancelled -> "Cancelled."
        }

    /** A short headline to go above [message]. */
    val title: String
        get() = when (this) {
            is Unauthorized -> "Signed out"
            is NotConfigured -> "Not set up yet"
            is Forbidden -> "Not allowed"
            is NotFound -> "Not found"
            is BadRequest -> "Couldn't do that"
            is TooManyRequests -> "Slow down"
            is Server -> "Server error"
            is Transport -> "Can't reach the server"
            is Decoding -> "Unexpected answer"
            Cancelled -> "Cancelled"
        }

    companion object {
        /**
         * Map tRPC's `error.data.code`. The status is the fallback for a proxy
         * in front of the server answering with its own body.
         */
        fun fromTrpc(code: String?, status: Int, message: String): ApiError = when (code) {
            "UNAUTHORIZED" -> Unauthorized(message)
            "PRECONDITION_FAILED" -> NotConfigured(message)
            "FORBIDDEN" -> Forbidden(message)
            "NOT_FOUND" -> NotFound(message)
            "BAD_REQUEST", "PARSE_ERROR", "UNPROCESSABLE_CONTENT" -> BadRequest(message)
            "TOO_MANY_REQUESTS" -> TooManyRequests(message)
            null -> when (status) {
                401 -> Unauthorized(message)
                403 -> Forbidden(message)
                404 -> NotFound(message)
                412 -> NotConfigured(message)
                429 -> TooManyRequests(message)
                else -> Server("HTTP_$status", status, message)
            }
            else -> Server(code, status, message)
        }

        /** OkHttp's failures, in words. A timeout and "no route" read differently on hotel Wi-Fi. */
        fun fromTransport(error: Throwable): ApiError = when (error) {
            is ApiError -> error
            is SocketTimeoutException -> Transport("The server took too long to answer.")
            // OkHttp's call timeout, and `Call.cancel()`, both surface as this.
            is InterruptedIOException ->
                if (error.message == "timeout") Transport("The server took too long to answer.") else Cancelled
            is UnknownHostException -> Transport("That address doesn't resolve to anything.")
            is ConnectException -> Transport("Nothing is answering at that address.")
            is NoRouteToHostException -> Transport("You're offline.")
            is SSLException -> Transport("The server's certificate couldn't be verified.")
            is IOException -> Transport(error.message?.takeIf { it.isNotBlank() } ?: "The connection failed.")
            else -> Transport(error.message ?: error.toString())
        }

        /** Any throwable as an ApiError, for code that catches broadly. */
        fun from(error: Throwable): ApiError = if (error is ApiError) error else fromTransport(error)
    }
}
