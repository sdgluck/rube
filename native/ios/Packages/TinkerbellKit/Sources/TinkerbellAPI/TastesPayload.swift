// What the Tastes form sends to `preferences.set`.
//
// Only the sections the form shows. The server merges what it's sent over
// what it has stored, so a hidden section is left out rather than sent empty:
// the user's earlier answer survives, and is back when the admin turns the
// section on again. Mirrors `save()` in `apps/portal/src/tabs/PreferencesForm.tsx`.

import Foundation
import TinkerbellModels

public enum TastesPayload {
    public typealias Preferences = Portal.PreferencesGetOutput.Preferences

    /// Which preference keys each `tastes.*` switch governs —
    /// `TASTES_PREFERENCE_KEYS` in `packages/contracts/src/portal-components.ts`.
    static func shownKeys(_ c: Portal.ComponentsOutput) -> [String] {
        var keys: [String] = []
        if c.tastesGenres { keys.append("genres") }
        if c.tastesMoods { keys.append("moods") }
        if c.tastesNeverRecommend { keys.append("excludedTitles") }
        if c.tastesRatingFloor { keys.append("ratingFloor") }
        if c.tastesRowCount { keys.append("rowCount") }
        if c.tastesWatchedBias { keys.append("watchedBias") }
        if c.tastesStrictHate { keys.append("strictHate") }
        if c.tastesDigest { keys.append("digest") }
        return keys
    }

    public static func make(_ preferences: Preferences, components: Portal.ComponentsOutput) throws -> [String: JSONValue] {
        var p = preferences
        // Cleared alongside the subscription: keeping an address for someone
        // who just unsubscribed is what makes people distrust the button.
        if p.digest.frequency == .never { p.digest.email = "" }
        let all = try JSONDecoder().decode([String: JSONValue].self, from: JSONEncoder().encode(p))
        var out: [String: JSONValue] = [:]
        for key in shownKeys(components) {
            if let value = all[key] { out[key] = value }
        }
        // "Any" is sent as 0 rather than left out. Absent means "unchanged" to
        // the server's merge, so leaving it out could never clear a floor once
        // set; 0 is in range and reads as no floor everywhere it is used.
        if components.tastesRatingFloor && p.ratingFloor == nil { out["ratingFloor"] = .number(0) }
        return out
    }

    /// The digest wants an address to send to; saving without one used to
    /// subscribe silently and send nothing.
    public static func digestNeedsEmail(_ p: Preferences, components: Portal.ComponentsOutput) -> Bool {
        components.tastesDigest && p.digest.frequency != .never && p.digest.email.trimmingCharacters(in: .whitespaces).isEmpty
    }
}
