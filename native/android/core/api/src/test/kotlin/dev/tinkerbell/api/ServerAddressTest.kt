// Golden vectors from `packages/native-client/src/pure.test.ts` (the
// serverCandidates / judgeServerInfo cases), plus what the native app adds:
// the `exchange` capability, the admin's extra fields, and where an address
// points. From `ServerAddressTests.swift`.
package dev.tinkerbell.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerAddressTest {
    @Test
    fun triesHttpsThenHttpWhenNoSchemeWasTyped() {
        assertEquals(listOf("https://192.168.1.10:3000", "http://192.168.1.10:3000"), ServerAddress.candidates(" 192.168.1.10:3000 "))
    }

    @Test
    fun keepsAnExplicitSchemeAndDropsThePath() {
        assertEquals(listOf("http://tb.lan:3000"), ServerAddress.candidates("http://tb.lan:3000/settings/api"))
    }

    @Test
    fun refusesAnythingThatIsNotHttp() {
        assertEquals(emptyList<String>(), ServerAddress.candidates("javascript:alert(1)"))
        assertEquals(emptyList<String>(), ServerAddress.candidates("ftp://tb.lan"))
        assertEquals(emptyList<String>(), ServerAddress.candidates(""))
    }

    @Test
    fun anOriginIsWhatABrowserWouldCallIt() {
        assertEquals("https://tb.example.com", ServerAddress.origin("HTTPS://TB.Example.com:443/x?y#z"))
        assertEquals("http://tb.example.com", ServerAddress.origin("http://tb.example.com:80"))
        assertEquals("http://[::1]:3000", ServerAddress.origin("http://[::1]:3000/"))
    }

    private fun info(product: String, version: String, capabilities: List<String>? = listOf("exchange"), extra: String = ""): String {
        val caps = capabilities?.let { list -> ",\"capabilities\":[" + list.joinToString(",") { "\"$it\"" } + "]" } ?: ""
        return """{"result":{"data":{"product":"$product","version":"$version"$caps$extra}}}"""
    }

    @Test
    fun acceptsTheRightAppAtASupportedVersion() {
        val check = ServerAddress.judge("https://x", info("tinkerbell-admin", ServerAddress.MINIMUM_SERVER_VERSION), ServerProduct.ADMIN)
        assertEquals("https://x", check.info?.origin)
        assertEquals(ServerAddress.MINIMUM_SERVER_VERSION, check.info?.version)
    }

    @Test
    fun saysWhenThePortalAddressWasGivenForTheAdmin() {
        assertEquals(
            ServerCheck.Failed(ProbeFailure.WrongApp(ServerProduct.PORTAL)),
            ServerAddress.judge("https://x", info("tinkerbell-portal", "9.0.0"), ServerProduct.ADMIN),
        )
        assertEquals(
            ServerCheck.Failed(ProbeFailure.WrongApp(ServerProduct.ADMIN)),
            ServerAddress.judge("https://x", info("tinkerbell-admin", "9.0.0"), ServerProduct.PORTAL),
        )
    }

    @Test
    fun theWrongAppMessagesNameTheOtherSlot() {
        assertTrue(ProbeFailure.WrongApp(ServerProduct.ADMIN).message(ServerProduct.PORTAL).startsWith("That's the admin address."))
        assertTrue(ProbeFailure.WrongApp(ServerProduct.PORTAL).message(ServerProduct.ADMIN).startsWith("That's the portal address."))
    }

    @Test
    fun refusesAServerOlderThanTheAppSupports() {
        assertEquals(ServerCheck.Failed(ProbeFailure.TooOld("0.1.0")), ServerAddress.judge("https://x", info("tinkerbell-admin", "0.1.0"), ServerProduct.ADMIN))
    }

    @Test
    fun anythingElseIsNotTinkerbell() {
        val not = ServerCheck.Failed(ProbeFailure.NotTinkerbell)
        assertEquals(not, ServerAddress.judge("https://x", """{"hello":"world"}""", ServerProduct.ADMIN))
        assertEquals(not, ServerAddress.judge("https://x", "<html>", ServerProduct.ADMIN))
        assertEquals(not, ServerAddress.judge("https://x", info("plex-media-server", "1.0.0"), ServerProduct.ADMIN))
    }

    @Test
    fun aServerWithoutExchangeNeedsUpdating() {
        val want = ServerCheck.Failed(ProbeFailure.NeedsUpdate("0.40.0"))
        assertEquals(want, ServerAddress.judge("https://x", info("tinkerbell-portal", "0.40.0", capabilities = null), ServerProduct.PORTAL))
        assertEquals(want, ServerAddress.judge("https://x", info("tinkerbell-portal", "0.40.0", capabilities = emptyList()), ServerProduct.PORTAL))
    }

    @Test
    fun theAdminSaysWhetherSignInIsOnAndWhereThePortalIs() {
        val server = ServerAddress.judge(
            "http://x",
            info("tinkerbell-admin", "0.43.0", extra = ""","authRequired":false,"portalUrl":"http://192.168.1.2:3100""""),
            ServerProduct.ADMIN,
        ).info
        assertEquals(false, server?.authRequired)
        assertEquals("http://192.168.1.2:3100", server?.portalUrl)
        val none = ServerAddress.judge("http://x", info("tinkerbell-admin", "0.43.0", extra = ""","authRequired":true,"portalUrl":null"""), ServerProduct.ADMIN).info
        assertNull(none?.portalUrl)
        assertEquals(true, none?.authRequired)
    }

    @Test
    fun compareVersionsIsNumericNotLexical() {
        assertEquals(1, ServerAddress.compareVersions("0.10.0", "0.9.9"))
        assertEquals(0, ServerAddress.compareVersions("1.0.0-beta", "1.0.0"))
        assertEquals(-1, ServerAddress.compareVersions("0.35.0", "0.36.0"))
    }

    @Test
    fun loopbackIsThePhoneItself() {
        for (address in listOf("http://localhost:3000", "http://127.0.0.1:39311", "http://[::1]:3000", "http://app.localhost", "http://0.0.0.0:3000")) {
            assertTrue(address, ServerAddress.isLoopback(address))
        }
        assertFalse(ServerAddress.isLoopback("http://192.168.1.10:3000"))
        // The emulator's way to the host machine is not the phone itself.
        assertFalse(ServerAddress.isLoopback("http://10.0.2.2:39311"))
    }

    @Test
    fun plainHttpIsOnlyWorthAWarningOffTheLan() {
        for (address in listOf(
            "http://192.168.1.10:3000", "http://10.0.0.2", "http://172.20.1.1", "http://nas.local:3000",
            "http://tinkerbell:3000", "http://box.tail1234.ts.net", "http://100.100.1.1",
        )) {
            assertFalse(address, ServerAddress.isUnencryptedRemote(address))
        }
        assertTrue(ServerAddress.isUnencryptedRemote("http://tinkerbell.example.com"))
        assertTrue(ServerAddress.isUnencryptedRemote("http://203.0.113.9:3000"))
        assertFalse(ServerAddress.isUnencryptedRemote("https://tinkerbell.example.com"))
    }

    // The probe over the wire

    @Test
    fun theProbeFallsBackToHttpAndJudgesTheAnswer() = stub({
        json("""{"result":{"data":{"product":"tinkerbell-portal","version":"0.43.0","capabilities":["exchange"]}}}""")
    }) { s ->
        // No scheme typed: https first (which a plain-HTTP server can't speak), then http.
        val hostPort = s.origin.removePrefix("http://")
        val check = ServerProbe().probe(hostPort, ServerProduct.PORTAL)
        assertEquals(s.origin, check.info?.origin)
        assertEquals("/api/trpc/auth.server", s.requests.last().url.encodedPath)
    }

    @Test
    fun theProbeKeepsTheMostUsefulFailure() = stub({
        json("""{"result":{"data":{"product":"tinkerbell-admin","version":"0.43.0","capabilities":["exchange"]}}}""")
    }) { s ->
        val check = ServerProbe().probe(s.origin.removePrefix("http://"), ServerProduct.PORTAL)
        assertEquals(ServerCheck.Failed(ProbeFailure.WrongApp(ServerProduct.ADMIN)), check)
    }

    @Test
    fun theProbeSaysWhenNothingAnswered() = stub({ json("{}").newBuilder().headersDelay(2, java.util.concurrent.TimeUnit.SECONDS).build() }) { s ->
        val check = ServerProbe(timeoutMs = 200).probe(s.origin, ServerProduct.PORTAL)
        assertEquals(ServerCheck.Failed(ProbeFailure.Unreachable("The server took too long to answer.")), check)
    }

    @Test
    fun anEmptyAddressIsNotAnAddress() = kotlinx.coroutines.runBlocking {
        assertEquals(ServerCheck.Failed(ProbeFailure.NotAnAddress), ServerProbe().probe("  ", ServerProduct.PORTAL))
    }
}
