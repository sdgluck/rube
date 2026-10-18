// A real HTTP server per test (MockWebServer), standing in for a Tinkerbell
// or plex.tv. Real sockets rather than an interceptor, so URL encoding, which
// method a call went out as and what the body held are checked as the server
// would see them — the places a stub that agrees with the code can't catch.
package dev.tinkerbell.api

import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.Headers.Companion.headersOf
import java.util.concurrent.CopyOnWriteArrayList

fun json(body: String, status: Int = 200) = MockResponse(status, headersOf("Content-Type", "application/json"), body)

/** A server answering from [handler], with every request it saw. */
class Stub(handler: (RecordedRequest) -> MockResponse) : AutoCloseable {
    val server = MockWebServer()
    val requests = CopyOnWriteArrayList<RecordedRequest>()

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                return handler(request)
            }
        }
        server.start()
    }

    /** `http://127.0.0.1:<port>` — an origin, as the app stores it. */
    val origin: String get() = server.url("/").toString().trimEnd('/')

    override fun close() = server.close()
}

fun <T> stub(handler: (RecordedRequest) -> MockResponse, block: suspend (Stub) -> T): T =
    Stub(handler).use { runBlocking { block(it) } }
