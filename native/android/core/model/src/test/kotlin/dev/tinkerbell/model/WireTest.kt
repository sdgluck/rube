// The generated models against JSON as the server actually sends it — the
// Kotlin twin of `TinkerbellModelsTests/WireTests.swift`.
//
// `codegen.test.ts` checks the generator wrote the right Kotlin; this checks
// that Kotlin reads and writes the right wire format, the half a source-text
// test can't see.
package dev.tinkerbell.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class WireTest {
    private fun <T> decode(serializer: KSerializer<T>, json: String): T = WireJson.decoder.decodeFromString(serializer, json)

    private fun <T> encode(serializer: KSerializer<T>, value: T) = WireJson.encoder.encodeToJsonElement(serializer, value).jsonObject

    @Test
    fun aListDecodesIntoItsItems() {
        val items = decode(
            ListSerializer(Portal.LeavingSoonItem.serializer()),
            """[{"ratingKey":"1","title":"Heat","runsRemaining":2,"voted":false}]""",
        )
        assertEquals("Heat", items.first().title)
        assertEquals(2L, items.first().runsRemaining)
    }

    @Test
    fun anEnumValueFromANewerServerStillDecodes() {
        assertEquals(Portal.PersonalizationStatusOutput.ENABLED, decode(Portal.PersonalizationStatusOutput.serializer(), "\"enabled\""))
        assertEquals(Portal.PersonalizationStatusOutput.UNKNOWN, decode(Portal.PersonalizationStatusOutput.serializer(), "\"paused\""))
    }

    @Test
    fun anUnknownEnumInsideAnObjectDoesNotFailTheObject() {
        val run = decode(
            RuleRunSummary.serializer(),
            """{"id":"r","ruleId":"x","phase":"preview","trigger":"webhook","jobRunId":null,"status":"ok","progress":1,"message":"",
               "collectionCount":null,"itemCount":3,"error":null,"startedAt":1,"updatedAt":2,"finishedAt":null,"hasFunnel":false,"ruleName":"R"}""",
        )
        assertEquals(RuleRunPhase.UNKNOWN, run.phase)
        assertEquals(RuleRunTrigger.UNKNOWN, run.trigger)
        assertEquals(3L, run.itemCount)
    }

    @Test
    fun aUnionDecodesByItsDiscriminator() {
        val ok = decode(Admin.AuthExchangeOutput.serializer(), """{"status":"ok","username":"sam","token":"t"}""")
        assertTrue("expected Ok, got $ok", ok is Admin.AuthExchangeOutput.Ok)
        assertEquals("t", (ok as Admin.AuthExchangeOutput.Ok).value.token)

        val open = decode(Admin.AuthExchangeOutput.serializer(), """{"status":"open"}""")
        assertTrue("expected Open, got $open", open is Admin.AuthExchangeOutput.Open)
    }

    @Test
    fun aBooleanDiscriminatorWorksToo() {
        val refused = decode(Admin.ProblemsRescanOutput.serializer(), """{"ok":false,"reason":"already-running"}""")
        assertTrue("expected OkFalse, got $refused", refused is Admin.ProblemsRescanOutput.OkFalse)
        assertEquals(
            Admin.ProblemsRescanOutput.OkFalseValue.Reason.ALREADY_RUNNING,
            (refused as Admin.ProblemsRescanOutput.OkFalse).value.reason,
        )
        val started = decode(Admin.ProblemsRescanOutput.serializer(), """{"ok":true,"runId":"r1"}""")
        assertEquals("r1", (started as Admin.ProblemsRescanOutput.OkTrue).value.runId)
    }

    @Test
    fun anUnknownUnionTagIsAnError() {
        try {
            decode(Admin.AuthExchangeOutput.serializer(), """{"status":"maybe"}""")
            fail("expected a SerializationException")
        } catch (_: SerializationException) {
        }
    }

    @Test
    fun aRequiredNullableInputIsSentAsNull() {
        // `match.vote` with no film is "withdraw my vote" — the key must be there.
        val body = encode(Portal.MatchVoteInput.serializer(), Portal.MatchVoteInput(code = "ABCD", ratingKey = null))
        assertTrue(body.containsKey("ratingKey"))
        assertEquals(JsonNull, body["ratingKey"])
    }

    @Test
    fun anOptionalInputIsLeftOut() {
        val body = encode(Portal.MatchJoinInput.serializer(), Portal.MatchJoinInput(code = "ABCD"))
        assertFalse(body.containsKey("invite"))
        assertEquals(setOf("code"), body.keys)
    }

    @Test
    fun aMissingNullableOutputFieldReadsAsNull() {
        // zod `.nullable()` with no default in Kotlin: absent on the wire is null, not an error.
        val stats = decode(Admin.StatsOpsOutput.serializer(), """{"failedJobs24h":0,"uptimeSec":5}""")
        assertEquals(null, stats.lastFailure)
        assertEquals(null, stats.lastSyncAt)
    }

    @Test
    fun dottedKeysDecode() {
        val json = """{"action.keep":true,"action.notForMe":false,"tab.collections":true,"tab.leaving":true,"tab.match":false,"tab.tastes":true,"tastes.digest":false,"tastes.genres":true,"tastes.moods":true,"tastes.neverRecommend":true,"tastes.ratingFloor":true,"tastes.rowCount":true,"tastes.strictHate":true,"tastes.watchedBias":true,"tab.future":true}"""
        val components = decode(Portal.ComponentsOutput.serializer(), json)
        assertFalse(components.tabMatch)
        assertTrue(components.actionKeep)
        assertFalse(components.actionNotForMe)
    }

    @Test
    fun theEndpointsKnowTheirKind() {
        assertEquals(Endpoint.Kind.QUERY, PortalApi.matchState.kind)
        assertEquals(Endpoint.Kind.MUTATION, PortalApi.matchVote.kind)
        assertEquals("match.guest.join", PortalApi.matchGuestJoin.path)
        assertEquals(NoInput.serializer(), AdminApi.usersSync.input)
    }
}
