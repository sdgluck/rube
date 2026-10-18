// The app's half of the tRPC wire protocol: plain JSON, no transformer, no
// batching — so a query is `GET /api/trpc/<path>?input=<json>` and a mutation
// is `POST` with the JSON as its body. The Kotlin twin of `TRPCClient.swift`.
//
// Hand-rolled rather than a generic HTTP layer because the envelope is the
// whole contract: `{"result":{"data":…}}` or `{"error":{…,"data":{"code"}}}`,
// and a void procedure answers `{"result":{}}` with no `data` at all. Getting
// that last one wrong turns every "dismiss" into a decode failure.
package dev.tinkerbell.api

import dev.tinkerbell.model.Endpoint
import dev.tinkerbell.model.NoInput
import dev.tinkerbell.model.NoOutput
import dev.tinkerbell.model.WireJson
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** What a request presents. A movie-match guest has no session, only a token for one room. */
sealed interface Credential {
    data object None : Credential
    data class Bearer(val token: String) : Credential
    data class MatchGuest(val token: String) : Credential
}

class TrpcClient(
    /** The server's origin, no trailing slash. */
    val baseUrl: String,
    val credential: Credential = Credential.None,
    val timeoutMs: Long = 20_000,
    private val http: OkHttpClient = Http.client,
    /**
     * Called when the server says the session is gone, before the error is
     * thrown, so the owner drops the token and returns to sign-in once —
     * rather than every screen that happened to be loading deciding to.
     */
    private val onUnauthorized: (suspend () -> Unit)? = null,
) {
    fun with(credential: Credential): TrpcClient = TrpcClient(baseUrl, credential, timeoutMs, http, onUnauthorized)

    suspend fun <O> call(endpoint: Endpoint<NoInput, O>): O = call(endpoint, NoInput)

    suspend fun <I, O> call(endpoint: Endpoint<I, O>, input: I): O {
        val request = try {
            TrpcRequest.make(baseUrl, endpoint, input, credential)
        } catch (e: SerializationException) {
            throw ApiError.BadRequest("The app couldn't encode that request.")
        } catch (e: IllegalArgumentException) {
            throw ApiError.BadRequest("That server address can't be used.")
        }
        val (status, body) = try {
            http.newCall(request).also { it.timeout().timeout(timeoutMs, TimeUnit.MILLISECONDS) }.await()
        } catch (e: IOException) {
            throw ApiError.fromTransport(e)
        }
        try {
            return TrpcEnvelope.decode(endpoint.output, body, status)
        } catch (e: ApiError.Unauthorized) {
            onUnauthorized?.invoke()
            throw e
        }
    }
}

/** One OkHttp client for every server: shared pool, no cookie jar (the default), no cache. */
object Http {
    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            // Per call instead (`Call.timeout()`); these are the backstops.
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}

/** Status and body, read off the network thread and cancelled with the coroutine. */
internal suspend fun Call.await(): Pair<Int, String> = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (!cont.isCancelled) cont.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            val result = try {
                response.use { it.code to it.body.string() }
            } catch (e: IOException) {
                if (!cont.isCancelled) cont.resumeWithException(e)
                return
            }
            cont.resume(result)
        }
    })
}

/** Building the request, separate from sending it so tests can read it. */
object TrpcRequest {
    private val json = "application/json".toMediaType()

    /**
     * RFC 3986 unreserved characters only. The server reads `?input=` with
     * URLSearchParams, which turns a bare `+` into a space — so a search for
     * "C++" would arrive as "C  " if `+` went through as-is.
     */
    fun encodeQueryValue(value: String): String {
        val out = StringBuilder()
        for (byte in value.toByteArray(Charsets.UTF_8)) {
            val c = byte.toInt() and 0xff
            val ch = c.toChar()
            if (ch in 'A'..'Z' || ch in 'a'..'z' || ch in '0'..'9' || ch == '-' || ch == '.' || ch == '_' || ch == '~') {
                out.append(ch)
            } else {
                out.append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 0xf])
            }
        }
        return out.toString()
    }

    fun <I, O> make(baseUrl: String, endpoint: Endpoint<I, O>, input: I, credential: Credential): Request {
        val body = if (input === NoInput) null else WireJson.encoder.encodeToString(endpoint.input, input)
        var url = baseUrl.trimEnd('/') + "/api/trpc/" + endpoint.path
        if (endpoint.kind == Endpoint.Kind.QUERY && body != null) url += "?input=" + encodeQueryValue(body)
        val builder = Request.Builder().url(url).header("Accept", "application/json")
        if (endpoint.kind == Endpoint.Kind.QUERY) {
            builder.get()
        } else {
            // OkHttp wants a body on every POST; an empty one is tRPC's "no input".
            builder.post((body ?: "").toRequestBody(if (body == null) null else json))
        }
        when (credential) {
            Credential.None -> Unit
            is Credential.Bearer -> builder.header("Authorization", "Bearer ${credential.token}")
            is Credential.MatchGuest -> builder.header("X-Match-Guest", credential.token)
        }
        return builder.build()
    }
}

/** Reading the envelope. Pure, so every shape the server sends is a test. */
object TrpcEnvelope {
    fun <O> decode(output: KSerializer<O>, body: String, status: Int): O {
        val root = try {
            WireJson.decoder.parseToJsonElement(body)
        } catch (e: SerializationException) {
            null
        }
        val error = (root as? JsonObject)?.get("error") as? JsonObject
        if (error != null) {
            val data = error["data"] as? JsonObject
            throw ApiError.fromTrpc(
                code = (data?.get("code") as? JsonPrimitive)?.contentOrNull,
                status = (data?.get("httpStatus") as? JsonPrimitive)?.intOrNull ?: status,
                message = (error["message"] as? JsonPrimitive)?.contentOrNull ?: "",
            )
        }
        // A proxy's error page, or a server too old to have the route.
        if (status !in 200..299) throw ApiError.fromTrpc(code = null, status = status, message = "")
        @Suppress("UNCHECKED_CAST")
        if (output.descriptor.serialName == NoOutput.serializer().descriptor.serialName) return NoOutput as O
        val result = (root as? JsonObject)?.get("result") as? JsonObject
            ?: throw ApiError.Decoding("missing result")
        val data: JsonElement = result["data"] ?: run {
            // `{"result":{}}`: tRPC's spelling of a procedure that returned
            // nothing. For a nullable output that is null, not a failure.
            @Suppress("UNCHECKED_CAST")
            if (output.descriptor.isNullable) return null as O
            throw ApiError.Decoding("result.data is missing")
        }
        return try {
            WireJson.decoder.decodeFromJsonElement(output, data)
        } catch (e: SerializationException) {
            throw ApiError.Decoding(e.message ?: e.toString())
        } catch (e: IllegalArgumentException) {
            throw ApiError.Decoding(e.message ?: e.toString())
        }
    }
}
