// The PIN flow against a stub plex.tv: the headers plex.tv requires, the auth
// URL the server would also build, and the poll's three ways out — a token,
// the tab being closed, and the coroutine being cancelled. From
// `PlexSignInTests.swift`.
package fyi.rube.api

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger
import kotlin.time.Duration.Companion.milliseconds

class PlexSignInTest {
    private fun plex(s: Stub) = PlexTv(clientId = "client-1", override = s.origin)
    private val fast = PlexPinPoller.fast()

    private suspend fun signInError(block: suspend () -> Any?): PlexSignInError {
        try {
            block()
        } catch (e: PlexSignInError) {
            return e
        }
        fail("expected a PlexSignInError")
        throw IllegalStateException()
    }

    @Test
    fun creatingAPinSendsTheHeadersPlexWants() = stub({ json("""{"id":1001,"code":"abcd1234"}""", 201) }) { s ->
        assertEquals(PlexPin(1001, "abcd1234"), plex(s).createPin())
        val req = s.requests.single()
        assertEquals("POST", req.method)
        assertEquals("/api/v2/pins", req.url.encodedPath)
        assertEquals("strong=true", req.url.encodedQuery)
        assertEquals("client-1", req.headers["X-Plex-Client-Identifier"])
        assertEquals("Rube", req.headers["X-Plex-Product"])
        assertEquals("application/json", req.headers["Accept"])
    }

    @Test
    fun theRealAuthUrlMatchesTheServers() {
        val url = PlexTv(clientId = "c id").authUrl("xy z")
        assertEquals("https://app.plex.tv/auth#?clientID=c+id&code=xy+z&context%5Bdevice%5D%5Bproduct%5D=Rube", url)
        assertFalse(url.contains("forwardUrl"))
    }

    @Test
    fun aDevelopmentPlexTvHasItsOwnAuthPage() {
        assertEquals("http://127.0.0.1:39313/auth?code=abc", PlexTv(clientId = "c", override = "http://127.0.0.1:39313").authUrl("abc"))
    }

    @Test
    fun pollingReturnsTheTokenOnceApproved() {
        val polls = AtomicInteger()
        stub({ req ->
            assertEquals("/api/v2/pins/7", req.url.encodedPath)
            assertEquals("client-1", req.headers["X-Plex-Client-Identifier"])
            json(if (polls.incrementAndGet() < 3) """{"id":7,"authToken":null}""" else """{"id":7,"authToken":"plex-tok"}""")
        }) { s ->
            assertEquals("plex-tok", fast.waitForToken(PlexPin(7, "c"), plex(s), SignInSheetState()))
            assertEquals(3, polls.get())
        }
    }

    @Test
    fun closingTheTabStopsThePollAfterAGraceCheck() = stub({ json("""{"id":7,"authToken":null}""") }) { s ->
        val sheet = SignInSheetState().apply { markClosed() }
        assertEquals(PlexSignInError.Cancelled, signInError { fast.waitForToken(PlexPin(7, "c"), plex(s), sheet) })
        assertEquals(fast.checksAfterClose, s.requests.size)
    }

    @Test
    fun anApprovalThatLandsAsTheTabClosesStillCounts() = stub({ json("""{"id":7,"authToken":"late"}""") }) { s ->
        val sheet = SignInSheetState().apply { markClosed() }
        assertEquals("late", fast.waitForToken(PlexPin(7, "c"), plex(s), sheet))
    }

    @Test
    fun cancellingTheCoroutineCancelsThePoll() = stub({ json("""{"id":7,"authToken":null}""") }) { s ->
        val slow = PlexPinPoller(interval = 50.milliseconds)
        val job = kotlinx.coroutines.coroutineScope {
            val poll = async { slow.waitForToken(PlexPin(7, "c"), plex(s), SignInSheetState()) }
            delay(120)
            poll.cancel()
            poll
        }
        assertTrue(job.isCancelled)
        try {
            job.await()
            fail("expected cancellation")
        } catch (_: CancellationException) {
        }
    }

    @Test
    fun aForgottenPinHasExpired() = stub({ json("""{"errors":[]}""", 404) }) { s ->
        assertEquals(PlexSignInError.Expired, signInError { fast.waitForToken(PlexPin(7, "c"), plex(s), SignInSheetState()) })
    }

    @Test
    fun aBlipIsToleratedButAnOutageIsNot() {
        val polls = AtomicInteger()
        stub({ if (polls.incrementAndGet() == 1) json("{}", 503) else json("""{"id":7,"authToken":"ok"}""") }) { s ->
            assertEquals("ok", fast.waitForToken(PlexPin(7, "c"), plex(s), SignInSheetState()))
        }
        stub({ json("{}", 503) }) { s ->
            assertTrue(signInError { fast.waitForToken(PlexPin(7, "c"), plex(s), SignInSheetState()) } is PlexSignInError.PlexUnavailable)
            assertEquals(fast.toleratedFailures + 1, s.requests.size)
        }
    }

    @Test
    fun runningOutOfTimeIsExpiry() = stub({ json("""{"id":7,"authToken":null}""") }) { s ->
        val short = PlexPinPoller.fast(limit = 30.milliseconds)
        assertEquals(PlexSignInError.Expired, signInError { short.waitForToken(PlexPin(7, "c"), plex(s), SignInSheetState()) })
    }

    @Test
    fun headlessApprovalAsksTheMockAsThatAccount() = stub({ json("ok") }) { s ->
        plex(s).approveHeadlessly("abc", "101")
        val req = s.requests.single()
        assertEquals("/auth", req.url.encodedPath)
        assertEquals("code=abc&as=101", req.url.encodedQuery)
    }

    @Test
    fun headlessApprovalNeedsADevelopmentPlexTv() = kotlinx.coroutines.runBlocking {
        assertTrue(signInError { PlexTv(clientId = "c").approveHeadlessly("abc", "1") } is PlexSignInError.PlexUnavailable)
    }

    // Exchange

    @Test
    fun theAdminExchangeReadsOkOpenAndRefused() {
        fun c(s: Stub) = TrpcClient(s.origin, Credential.Bearer("stale"))
        stub({ json("""{"result":{"data":{"status":"ok","username":"sam","token":"t"}}}""") }) { s ->
            assertEquals(ExchangeOutcome.SignedIn("sam", "t"), SignInExchange.admin(c(s), "p"))
            val req = s.requests.single()
            // An exchange never presents an old session alongside the Plex token.
            assertNull(req.headers["Authorization"])
            val body = Json.parseToJsonElement(req.body!!.utf8()).jsonObject
            assertEquals(setOf("plexToken"), body.keys)
            assertEquals("p", body["plexToken"]!!.jsonPrimitive.content)
        }
        stub({ json("""{"result":{"data":{"status":"open"}}}""") }) { s ->
            assertEquals(ExchangeOutcome.Open, SignInExchange.admin(c(s), "p"))
        }
        stub({
            json("""{"error":{"message":"ava isn't an admin here.","code":-32003,"data":{"code":"FORBIDDEN","httpStatus":403}}}""", 403)
        }) { s ->
            assertEquals(ExchangeOutcome.Refused("ava isn't an admin here."), SignInExchange.admin(c(s), "p"))
        }
    }

    @Test
    fun thePortalExchangeReadsItsSession() = stub({ json("""{"result":{"data":{"status":"ok","username":"ava","token":"pt"}}}""") }) { s ->
        assertEquals(ExchangeOutcome.SignedIn("ava", "pt"), SignInExchange.portal(TrpcClient(s.origin), "p"))
        assertEquals("/api/trpc/auth.exchange", s.requests.single().url.encodedPath)
    }
}
