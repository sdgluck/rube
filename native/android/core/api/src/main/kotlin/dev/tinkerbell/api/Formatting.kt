// Small pieces of copy the web derives from data, ported so the app says the
// same thing: a room's filters as pills, a film's one-line meta, the Plex
// deep link. From `packages/contracts/src/match.ts` and
// `apps/portal/src/match/film.ts`, by way of `Formatting.swift`.
package dev.tinkerbell.api

import dev.tinkerbell.model.MatchFilters
import java.util.Base64
import java.util.Locale
import kotlin.math.roundToLong

object MatchText {
    /** "Comedy, Drama +1 · Under 2h · 2015 on". */
    fun pills(f: MatchFilters): List<String> {
        val pills = mutableListOf<String>()
        val genres = f.genres.orEmpty()
        if (genres.isNotEmpty()) {
            pills += if (genres.size <= 2) genres.joinToString(", ") else genres.take(2).joinToString(", ") + " +${genres.size - 2}"
        }
        val max = f.maxMinutes
        if (max != null && max > 0) {
            val total = max.toInt()
            val h = total / 60
            val m = total % 60
            pills += "Under " + if (h > 0) "${h}h" + (if (m > 0) " ${m}m" else "") else "${m}m"
        }
        val minYear = f.minYear?.toInt()
        val maxYear = f.maxYear?.toInt()
        when {
            minYear != null && maxYear != null && minYear > 0 && maxYear > 0 -> pills += "$minYear–$maxYear"
            minYear != null && minYear > 0 -> pills += "$minYear on"
            maxYear != null && maxYear > 0 -> pills += "Before ${maxYear + 1}"
        }
        f.minRating?.let { pills += "Rated ${number(it)}+" }
        f.maxRating?.let { pills += "Rated under ${number(it)}" }
        return pills
    }

    fun runtime(ms: Double?): String? {
        if (ms == null || ms <= 0) return null
        val mins = (ms / 60_000).roundToLong()
        val h = mins / 60
        return if (h > 0) "${h}h ${mins % 60}m" else "${mins}m"
    }

    /** "1999 · 7.8 · 2h 16m · R", skipping whatever the library doesn't know. */
    fun filmMeta(year: Long?, rating: Double?, durationMs: Double?, contentRating: String?): String = listOfNotNull(
        year?.toString(),
        rating?.takeIf { it > 0 }?.let { String.format(Locale.US, "%.1f", it) },
        runtime(durationMs),
        contentRating?.ifEmpty { null },
    ).joinToString(" · ")

    /** Opens the film in Plex — the app if installed, app.plex.tv otherwise. */
    fun plexLink(serverId: String, ratingKey: String): String {
        val key = "/library/metadata/$ratingKey"
        val encoded = buildString {
            for (byte in key.toByteArray(Charsets.UTF_8)) {
                val c = byte.toInt() and 0xff
                val ch = c.toChar()
                if (ch.isLetterOrDigit() && c < 0x80 || ch in "-_.!~*'()") append(ch) else append(String.format(Locale.US, "%%%02X", c))
            }
        }
        return "https://app.plex.tv/desktop/#!/server/$serverId/details?key=$encoded"
    }

    private fun number(d: Double): String = if (d == Math.rint(d)) d.toLong().toString() else d.toString()
}

object Durations {
    /** "3h 20m", "45m", "2d 4h" — watch time at a glance. */
    fun short(ms: Double): String {
        val minutes = (ms / 60_000).toLong()
        if (minutes < 60) return "${minutes}m"
        val hours = minutes / 60
        if (hours < 48) return "${hours}h ${minutes % 60}m"
        return "${hours / 24}d ${hours % 24}h"
    }
}

/**
 * `data:image/png;base64,…` — what the portal's branding background is when
 * the admin uploaded one rather than linking it.
 */
object DataUrl {
    fun decode(raw: String): ByteArray? {
        if (!raw.startsWith("data:")) return null
        val comma = raw.indexOf(',')
        if (comma < 0) return null
        val header = raw.substring(5, comma)
        val payload = raw.substring(comma + 1)
        if (header.endsWith(";base64")) {
            return try {
                // The MIME decoder skips characters outside the alphabet, as
                // `.ignoreUnknownCharacters` does on iOS.
                Base64.getMimeDecoder().decode(payload)
            } catch (e: IllegalArgumentException) {
                null
            }
        }
        return try {
            java.net.URLDecoder.decode(payload.replace("+", "%2B"), "UTF-8").toByteArray(Charsets.UTF_8)
        } catch (e: IllegalArgumentException) {
            null
        }
    }
}
