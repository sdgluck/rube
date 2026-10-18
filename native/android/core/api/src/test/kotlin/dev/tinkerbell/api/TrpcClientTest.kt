// The client against the wire format as the server actually sends it: GET vs
// POST, how `?input=` is encoded, the envelope, void and nullable outputs, and
// which tRPC code becomes which error. Ported from `TRPCClientTests.swift`.
package dev.tinkerbell.api

import dev.tinkerbell.model.Admin
import dev.tinkerbell.model.AdminApi
import dev.tinkerbell.model.NoOutput
import dev.tinkerbell.model.Portal
import dev.tinkerbell.model.PortalApi
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.URLDecoder
import java.util.concurrent.atomic.AtomicInteger

class TrpcClientTest {
    private fun client(s: Stub, credential: Credential = Credential.Bearer("tok"), onUnauthorized: (suspend () -> Unit)? = null) =
        TrpcClient(s.origin, credential, onUnauthorized = onUnauthorized)

    @Test
    fun aQueryWithNoInputIsABareGetWithTheBearer() = stub({ json("""{"result":{"data":{"userId":1,"username":"sam"}}}""") }) { s ->
        val me = client(s).call(PortalApi.me)
        assertEquals("sam", me.username)
        val req = s.requests.single()
        assertEquals("GET", req.method)
        assertEquals("/api/trpc/me", req.url.encodedPath)
        assertNull(req.url.encodedQuery)
        assertEquals("Bearer tok", req.headers["Authorization"])
        // The server refuses sign-in from anything that looks like a browser.
        assertNull(req.headers["Origin"])
        assertNull(req.headers["Sec-Fetch-Site"])
    }

    @Test
    fun aQueryInputIsPercentEncodedJsonThatSurvivesUrlSearchParams() = stub({ json("""{"result":{"data":["C++ Primer"]}}""") }) { s ->
        client(s).call(PortalApi.searchTitles, Portal.SearchTitlesInput(q = "C++ & co/x=1"))
        val raw = s.requests.single().target.substringAfter('?')
        assertTrue(raw.startsWith("input="))
        val value = raw.removePrefix("input=")
        // `+` must not go through bare: URLSearchParams reads it as a space.
        assertFalse(value.contains('+'))
        assertFalse(value.contains('&'))
        assertEquals("""{"q":"C++ & co/x=1"}""", URLDecoder.decode(value, "UTF-8"))
    }

    @Test
    fun aMutationPostsItsInputAsTheBody() = stub({ json("""{"result":{"data":{"ok":true}}}""") }) { s ->
        val out = client(s).call(PortalApi.voteKeep, Portal.VoteKeepInput(ratingKey = "42", keep = true))
        assertTrue(out.ok)
        val req = s.requests.single()
        assertEquals("POST", req.method)
        assertEquals("/api/trpc/voteKeep", req.url.encodedPath)
        assertNull(req.url.encodedQuery)
        assertTrue(req.headers["Content-Type"]!!.startsWith("application/json"))
        val body = Json.parseToJsonElement(req.body!!.utf8()).jsonObject
        assertEquals("42", body["ratingKey"]!!.jsonPrimitive.content)
        assertTrue(body["keep"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun aMutationWithNoInputSendsNoBody() = stub({ json("""{"result":{"data":{"synced":1,"removed":0,"invites":0}}}""") }) { s ->
        client(s).call(AdminApi.usersSync)
        val req = s.requests.single()
        assertEquals("POST", req.method)
        assertEquals(0L, req.bodySize)
    }

    @Test
    fun aVoidProcedureAnswersWithNoData() = stub({ json("""{"result":{}}""") }) { s ->
        assertEquals(NoOutput, client(s).call(PortalApi.matchLeave, Portal.MatchLeaveInput(code = "ABCD")))
    }

    @Test
    fun aNullableOutputDecodesNullAndMissingAsNull() {
        val answers = ArrayDeque(
            listOf(
                """{"result":{"data":null}}""",
                """{"result":{}}""",
                """{"result":{"data":{"runId":"r","jobId":"j","name":"Sync","startedAt":5}}}""",
            ),
        )
        stub({ json(synchronized(answers) { answers.removeFirst() }) }) { s ->
            val c = client(s)
            assertNull(c.call(AdminApi.jobsLastFailure))
            assertNull(c.call(AdminApi.jobsLastFailure))
            assertEquals("Sync", c.call(AdminApi.jobsLastFailure)?.name)
        }
    }

    @Test
    fun aMatchGuestSendsItsTokenInsteadOfABearer() = stub({ json("""{"result":{}}""") }) { s ->
        client(s, Credential.MatchGuest("g-1")).call(PortalApi.matchLeave, Portal.MatchLeaveInput(code = "ABCD"))
        val req = s.requests.single()
        assertEquals("g-1", req.headers["X-Match-Guest"])
        assertNull(req.headers["Authorization"])
    }

    @Test
    fun aRequiredNullInputReachesTheServerAsNull() = stub({ json("""{"result":{}}""") }) { s ->
        client(s).call(PortalApi.matchVote, Portal.MatchVoteInput(code = "ABCD", ratingKey = null))
        assertEquals("""{"code":"ABCD","ratingKey":null}""", s.requests.single().body!!.utf8())
    }

    private fun errorBody(code: String, status: Int, message: String = "nope") =
        """{"error":{"message":"$message","code":-32001,"data":{"code":"$code","httpStatus":$status,"path":"me"}}}"""

    @Test
    fun trpcErrorCodesMapToErrors() {
        val cases = listOf(
            Triple("UNAUTHORIZED", 401, ApiError.Unauthorized("nope")),
            Triple("PRECONDITION_FAILED", 412, ApiError.NotConfigured("nope")),
            Triple("FORBIDDEN", 403, ApiError.Forbidden("nope")),
            Triple("NOT_FOUND", 404, ApiError.NotFound("nope")),
            Triple("BAD_REQUEST", 400, ApiError.BadRequest("nope")),
            Triple("TOO_MANY_REQUESTS", 429, ApiError.TooManyRequests("nope")),
            Triple("INTERNAL_SERVER_ERROR", 500, ApiError.Server("INTERNAL_SERVER_ERROR", 500, "nope")),
        )
        for ((code, status, expected) in cases) {
            stub({ json(errorBody(code, status), status) }) { s ->
                assertEquals(code, expected, failure { client(s).call(PortalApi.me) })
            }
        }
    }

    @Test
    fun unauthorizedTellsTheOwnerBeforeThrowing() = stub({ json(errorBody("UNAUTHORIZED", 401), 401) }) { s ->
        val told = AtomicInteger()
        val c = client(s) { told.incrementAndGet() }
        assertEquals(ApiError.Unauthorized("nope"), failure { c.call(PortalApi.me) })
        assertEquals(1, told.get())
    }

    @Test
    fun anyOtherErrorDoesNotSignOut() = stub({ json(errorBody("FORBIDDEN", 403), 403) }) { s ->
        val told = AtomicInteger()
        val c = client(s) { told.incrementAndGet() }
        assertEquals(ApiError.Forbidden("nope"), failure { c.call(PortalApi.me) })
        assertEquals(0, told.get())
    }

    @Test
    fun aProxyErrorPageFallsBackToTheStatus() = stub({ json("<html>Bad gateway</html>", 502) }) { s ->
        assertEquals(ApiError.Server("HTTP_502", 502, ""), failure { client(s).call(PortalApi.me) })
    }

    @Test
    fun aShapeTheAppDoesNotKnowIsADecodingError() = stub({ json("""{"result":{"data":{"userId":"one"}}}""") }) { s ->
        val e = failure { client(s).call(PortalApi.me) }
        assertTrue("got $e", e is ApiError.Decoding)
        assertTrue((e as ApiError.Decoding).detail, e.detail.contains("userId"))
    }

    @Test
    fun aUnionOutputComesBackTyped() = stub({ json("""{"result":{"data":{"status":"open"}}}""") }) { s ->
        val out = client(s).call(AdminApi.authExchange, Admin.AuthExchangeInput(plexToken = "p"))
        assertTrue(out is Admin.AuthExchangeOutput.Open)
    }

    @Test
    fun nothingAnsweringIsATransportError() {
        // A port that was listening a moment ago and isn't now.
        val stub = Stub { json("{}") }
        val dead = stub.origin
        stub.close()
        val e = runBlocking { failure { TrpcClient(dead).call(PortalApi.me) } }
        assertTrue("got $e", e is ApiError.Transport)
    }

    @Test
    fun aSlowServerIsATimeoutNotAHang() = stub({ json("{}").newBuilder().headersDelay(2, java.util.concurrent.TimeUnit.SECONDS).build() }) { s ->
        val e = failure { TrpcClient(s.origin, timeoutMs = 200).call(PortalApi.me) }
        assertEquals(ApiError.Transport("The server took too long to answer."), e)
    }
}

suspend fun failure(block: suspend () -> Any?): ApiError {
    try {
        block()
    } catch (e: ApiError) {
        return e
    }
    fail("expected an ApiError")
    throw IllegalStateException()
}
