// What the Tastes form sends: only the sections shown, and the two values
// that need saying explicitly to survive the server's merge. From
// `TastesPayloadTests.swift`.
package dev.tinkerbell.api

import dev.tinkerbell.model.Portal
import dev.tinkerbell.model.WireJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TastesPayloadTest {
    private val prefsJson =
        """{"genres":{"loved":["Drama"],"liked":[],"hated":["Horror"]},"people":{"lovedActors":[],"lovedDirectors":[],"avoided":[]},"eras":{"lovedDecades":[]},"watchedBias":"new_to_me","moods":["Cosy"],"excludedTitles":["Cats"],"excludedCollections":[],"strictHate":true,"digest":{"frequency":"never","email":"old@example.com"}}"""

    private fun components(digest: Boolean = true, moods: Boolean = true): Portal.ComponentsOutput = WireJson.decoder.decodeFromString(
        Portal.ComponentsOutput.serializer(),
        """{"action.keep":true,"action.notForMe":true,"tab.collections":true,"tab.leaving":true,"tab.match":true,"tab.tastes":true,"tastes.digest":$digest,"tastes.genres":true,"tastes.moods":$moods,"tastes.neverRecommend":true,"tastes.ratingFloor":true,"tastes.rowCount":true,"tastes.strictHate":true,"tastes.watchedBias":true}""",
    )

    private val prefs = WireJson.decoder.decodeFromString(Preferences.serializer(), prefsJson)

    @Test
    fun onlyShownSectionsAreSent() {
        val out = TastesPayload.make(prefs, components(moods = false))
        assertNull(out["moods"])
        assertNull("fields the form doesn't show are never sent", out["people"])
        assertEquals(JsonPrimitive("new_to_me"), out["watchedBias"])
        assertEquals(JsonArray(listOf(JsonPrimitive("Cats"))), out["excludedTitles"])
    }

    @Test
    fun anyRatingIsSentAsZeroSoItClears() {
        assertEquals(JsonPrimitive(0), TastesPayload.make(prefs, components())["ratingFloor"])
    }

    @Test
    fun unsubscribingClearsTheAddress() {
        val digest = TastesPayload.make(prefs, components())["digest"]!!.jsonObject
        assertEquals(JsonPrimitive(""), digest["email"])
    }

    @Test
    fun aDigestWithoutAnAddressIsHeldBack() {
        val p = prefs.copy(digest = prefs.digest.copy(frequency = Portal.PreferencesGetOutput.Preferences.Digest.Frequency.WEEKLY, email = " "))
        assertTrue(TastesPayload.digestNeedsEmail(p, components()))
        assertFalse(TastesPayload.digestNeedsEmail(p, components(digest = false)))
    }

    @Test
    fun aRowCountLeftOnAutoIsNotSent() {
        assertFalse(TastesPayload.make(prefs, components()).containsKey("rowCount"))
    }
}
