// What the Tastes form sends to `preferences.set`.
//
// Only the sections the form shows. The server merges what it's sent over
// what it has stored, so a hidden section is left out rather than sent empty:
// the user's earlier answer survives, and is back when the admin turns the
// section on again. Mirrors `save()` in `apps/portal/src/tabs/PreferencesForm.tsx`.
package dev.tinkerbell.api

import dev.tinkerbell.model.Portal
import dev.tinkerbell.model.WireJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

typealias Preferences = Portal.PreferencesGetOutput.Preferences

object TastesPayload {
    /**
     * Which preference keys each `tastes.*` switch governs —
     * `TASTES_PREFERENCE_KEYS` in `packages/contracts/src/portal-components.ts`.
     */
    fun shownKeys(c: Portal.ComponentsOutput): List<String> = buildList {
        if (c.tastesGenres) add("genres")
        if (c.tastesMoods) add("moods")
        if (c.tastesNeverRecommend) add("excludedTitles")
        if (c.tastesRatingFloor) add("ratingFloor")
        if (c.tastesRowCount) add("rowCount")
        if (c.tastesWatchedBias) add("watchedBias")
        if (c.tastesStrictHate) add("strictHate")
        if (c.tastesDigest) add("digest")
    }

    fun make(preferences: Preferences, components: Portal.ComponentsOutput): Map<String, JsonElement> {
        var p = preferences
        // Cleared alongside the subscription: keeping an address for someone
        // who just unsubscribed is what makes people distrust the button.
        if (p.digest.frequency == Portal.PreferencesGetOutput.Preferences.Digest.Frequency.NEVER) p = p.copy(digest = p.digest.copy(email = ""))
        val all = WireJson.encoder.encodeToJsonElement(Preferences.serializer(), p).jsonObject
        val out = LinkedHashMap<String, JsonElement>()
        for (key in shownKeys(components)) all[key]?.let { out[key] = it }
        // "Any" is sent as 0 rather than left out. Absent means "unchanged" to
        // the server's merge, so leaving it out could never clear a floor once
        // set; 0 is in range and reads as no floor everywhere it is used.
        if (components.tastesRatingFloor && p.ratingFloor == null) out["ratingFloor"] = JsonPrimitive(0)
        return out
    }

    /** The digest wants an address to send to; saving without one used to subscribe silently and send nothing. */
    fun digestNeedsEmail(p: Preferences, components: Portal.ComponentsOutput): Boolean =
        components.tastesDigest && p.digest.frequency != Portal.PreferencesGetOutput.Preferences.Digest.Frequency.NEVER && p.digest.email.isBlank()
}
